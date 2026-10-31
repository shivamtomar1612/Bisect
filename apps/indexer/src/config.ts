import { getAddress, isAddress } from "viem";

export interface IndexerConfig {
  readonly rpcUrl: string;
  readonly chainId: number;
  readonly contractAddress: `0x${string}`;
  readonly deploymentBlock: bigint;
  readonly confirmations: bigint;
  readonly scanRange: bigint;
  readonly maxReorgDepth: bigint;
  readonly pollIntervalMs: number;
  readonly apiHost: string;
  readonly apiPort: number;
}

function required(env: NodeJS.ProcessEnv, key: string, fallback?: string): string {
  const value = env[key] ?? fallback;
  if (value === undefined || value.trim() === "") {
    throw new Error(`${key} must be configured.`);
  }
  return value.trim();
}

function parseUnsignedBigInt(key: string, value: string, maximum?: bigint): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error(`${key} must be a decimal integer.`);
  const parsed = BigInt(value);
  if (maximum !== undefined && parsed > maximum) throw new Error(`${key} exceeds its maximum.`);
  return parsed;
}

function parseInteger(key: string, value: string, minimum: number, maximum: number): number {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error(`${key} must be an integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${key} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

export function loadIndexerConfig(env: NodeJS.ProcessEnv = process.env): IndexerConfig {
  const rpcUrl = required(env, "INDEXER_RPC_URL");
  const rpc = new URL(rpcUrl);
  if (rpc.protocol !== "http:" && rpc.protocol !== "https:") {
    throw new Error("INDEXER_RPC_URL must use HTTP or HTTPS.");
  }
  const chainId = parseInteger(
    "INDEXER_CHAIN_ID",
    required(env, "INDEXER_CHAIN_ID"),
    1,
    2_147_483_647,
  );
  const rawAddress = required(env, "INDEXER_CONTRACT_ADDRESS", env["CONTRACT_ADDRESS"]);
  if (!isAddress(rawAddress)) throw new Error("INDEXER_CONTRACT_ADDRESS must be an EVM address.");
  const contractAddress = getAddress(rawAddress);
  const deploymentBlock = parseUnsignedBigInt(
    "INDEXER_DEPLOYMENT_BLOCK",
    required(env, "INDEXER_DEPLOYMENT_BLOCK"),
    9_223_372_036_854_775_807n,
  );
  const confirmations = parseUnsignedBigInt(
    "INDEXER_CONFIRMATIONS",
    env["INDEXER_CONFIRMATIONS"] ?? "6",
    10_000n,
  );
  if (confirmations === 0n) throw new Error("INDEXER_CONFIRMATIONS must be greater than zero.");
  const scanRange = parseUnsignedBigInt(
    "INDEXER_SCAN_RANGE",
    env["INDEXER_SCAN_RANGE"] ?? "500",
    10_000n,
  );
  if (scanRange === 0n) throw new Error("INDEXER_SCAN_RANGE must be greater than zero.");
  const maxReorgDepth = parseUnsignedBigInt(
    "INDEXER_MAX_REORG_DEPTH",
    env["INDEXER_MAX_REORG_DEPTH"] ?? "128",
    1_000_000n,
  );
  if (maxReorgDepth === 0n) throw new Error("INDEXER_MAX_REORG_DEPTH must be greater than zero.");
  return {
    rpcUrl,
    chainId,
    contractAddress,
    deploymentBlock,
    confirmations,
    scanRange,
    maxReorgDepth,
    pollIntervalMs: parseInteger(
      "INDEXER_POLL_INTERVAL_MS",
      env["INDEXER_POLL_INTERVAL_MS"] ?? "4000",
      250,
      300_000,
    ),
    apiHost: env["INDEXER_API_HOST"] ?? "127.0.0.1",
    apiPort: parseInteger("INDEXER_API_PORT", env["INDEXER_API_PORT"] ?? "8787", 1, 65_535),
  };
}
