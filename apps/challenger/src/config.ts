import { type Address, type Hex, isAddress } from "viem";

export interface ChallengerConfig {
  readonly rpcUrl: string;
  readonly chainId: number;
  readonly registryAddress: Address;
  readonly deploymentBlock: bigint;
  readonly confirmations: number;
  readonly pollIntervalMs: number;
  readonly maxRetries: number;
  readonly maxTotalSpendWei: bigint;
  readonly maxBondWei: bigint;
  readonly maxGasPerTransactionWei: bigint;
  readonly statePath: string;
  readonly logPath: string;
  readonly signerAddress?: Address;
  readonly privateKey?: Hex;
  readonly unlockedAddress?: Address;
  readonly broadcastAuthorized: boolean;
}

const DEFAULT_RPC_URL = "http://127.0.0.1:8545";
const DEFAULT_STATE_PATH = ".bisect/challenger-state.json";
const DEFAULT_LOG_PATH = ".bisect/challenger.jsonl";

export function loadChallengerConfig(env: NodeJS.ProcessEnv = process.env): ChallengerConfig {
  const rpcUrl = env["BISECT_BOT_RPC_URL"] ?? DEFAULT_RPC_URL;
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rpcUrl);
  } catch {
    throw new Error("BISECT_BOT_RPC_URL must be a valid HTTP or HTTPS URL.");
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("BISECT_BOT_RPC_URL must use HTTP or HTTPS.");
  }

  const chainId = parseSafeInteger(
    env["BISECT_BOT_CHAIN_ID"] ?? "31337",
    "chain ID",
    1,
    2 ** 31 - 1,
  );
  if (chainId !== 31337 && chainId !== 84532) {
    throw new Error("The challenger supports only local Anvil (31337) and Base Sepolia (84532).");
  }

  const rawAddress = env["BISECT_BOT_REGISTRY_ADDRESS"];
  if (rawAddress === undefined || !isAddress(rawAddress)) {
    throw new Error("Set BISECT_BOT_REGISTRY_ADDRESS to the verified dispute registry address.");
  }

  const privateKey = env["BISECT_BOT_PRIVATE_KEY"];
  if (privateKey !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error("BISECT_BOT_PRIVATE_KEY must be a 32-byte hex key.");
  }

  const rawUnlockedAddress = env["BISECT_BOT_UNLOCKED_ADDRESS"];
  const useUnlocked = env["BISECT_BOT_USE_UNLOCKED_ACCOUNT"] === "true";
  if (useUnlocked && chainId !== 31337) {
    throw new Error("Unlocked JSON-RPC accounts are allowed only on local Anvil chain 31337.");
  }
  if (useUnlocked && (rawUnlockedAddress === undefined || !isAddress(rawUnlockedAddress))) {
    throw new Error("Local unlocked mode requires BISECT_BOT_UNLOCKED_ADDRESS.");
  }
  const configuredAddress = env["BISECT_BOT_ADDRESS"];
  if (configuredAddress !== undefined && !isAddress(configuredAddress)) {
    throw new Error("BISECT_BOT_ADDRESS must be a valid EVM address.");
  }
  if (
    rawUnlockedAddress !== undefined &&
    configuredAddress !== undefined &&
    rawUnlockedAddress.toLowerCase() !== configuredAddress.toLowerCase()
  ) {
    throw new Error("BISECT_BOT_ADDRESS must match BISECT_BOT_UNLOCKED_ADDRESS.");
  }

  const broadcastAuthorized = env["BISECT_BOT_BROADCAST"] === "true";
  if (broadcastAuthorized && privateKey === undefined && !useUnlocked) {
    throw new Error(
      "Broadcasting requires BISECT_BOT_PRIVATE_KEY or explicitly enabled local unlocked mode.",
    );
  }
  const config: ChallengerConfig = {
    rpcUrl,
    chainId,
    registryAddress: rawAddress as Address,
    deploymentBlock: parseBigInt(env["BISECT_BOT_DEPLOYMENT_BLOCK"] ?? "0", "deployment block"),
    confirmations: parseSafeInteger(
      env["BISECT_BOT_CONFIRMATIONS"] ?? (chainId === 31337 ? "1" : "6"),
      "confirmations",
      chainId === 31337 ? 0 : 1,
      100_000,
    ),
    pollIntervalMs: parseSafeInteger(
      env["BISECT_BOT_POLL_INTERVAL_MS"] ?? "3000",
      "poll interval",
      250,
      3_600_000,
    ),
    maxRetries: parseSafeInteger(env["BISECT_BOT_MAX_RETRIES"] ?? "3", "retry limit", 0, 10),
    maxTotalSpendWei: parseBigInt(env["BISECT_BOT_MAX_TOTAL_SPEND_WEI"] ?? "0", "total spend cap"),
    maxBondWei: parseBigInt(env["BISECT_BOT_MAX_BOND_WEI"] ?? "0", "per-dispute bond cap"),
    maxGasPerTransactionWei: parseBigInt(
      env["BISECT_BOT_MAX_GAS_PER_TX_WEI"] ?? "0",
      "per-transaction gas cap",
    ),
    statePath: env["BISECT_BOT_STATE_PATH"] ?? DEFAULT_STATE_PATH,
    logPath: env["BISECT_BOT_LOG_PATH"] ?? DEFAULT_LOG_PATH,
    ...(configuredAddress === undefined
      ? rawUnlockedAddress === undefined
        ? {}
        : { signerAddress: rawUnlockedAddress as Address }
      : { signerAddress: configuredAddress as Address }),
    ...(privateKey === undefined ? {} : { privateKey: privateKey as Hex }),
    ...(useUnlocked && rawUnlockedAddress !== undefined
      ? { unlockedAddress: rawUnlockedAddress as Address }
      : {}),
    broadcastAuthorized,
  };

  if (
    broadcastAuthorized &&
    (config.maxTotalSpendWei <= 0n ||
      config.maxBondWei <= 0n ||
      config.maxGasPerTransactionWei <= 0n)
  ) {
    throw new Error("Broadcasting requires positive total-spend, bond, and gas caps in wei.");
  }
  return Object.freeze(config);
}

export function parseBigInt(value: string, label: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error(`${label} must be a decimal integer.`);
  return BigInt(value);
}

function parseSafeInteger(value: string, label: string, minimum: number, maximum: number): number {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error(`${label} must be a decimal integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}
