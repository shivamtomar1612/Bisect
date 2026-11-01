import { type FileHandle, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { type Address, type Hex, isAddress } from "viem";
import type { ChallengerConfig } from "./config.js";

export type ClaimAttemptStatus =
  | "reserved"
  | "submitted"
  | "confirmed"
  | "reverted"
  | "uncertain"
  | "skipped";

export interface ClaimAttempt {
  readonly status: ClaimAttemptStatus;
  readonly updatedAt: string;
  readonly reason?: string;
  readonly transactionHash?: Hex;
  readonly gameNumber?: string;
  readonly reservedWei?: string;
  readonly bondWei?: string;
}

export interface TrackedGame {
  readonly claimId: string;
  readonly gameNumber: string;
  readonly discoveredAt: string;
  readonly lastStatus?: string;
}

export interface PendingWrite {
  readonly claimId: string;
  readonly action: string;
  readonly status: "reserved" | "submitted" | "uncertain";
  readonly reservedWei: string;
  readonly bondWei: string;
  readonly updatedAt: string;
  readonly transactionHash?: Hex;
}

export interface ChallengerState {
  readonly schema: "bisect.challenger-state.v1";
  readonly chainId: number;
  readonly registryAddress: Address;
  cursorBlock: string | null;
  cursorHash: Hex | null;
  spentWei: string;
  reservedWei: string;
  pendingWrite?: PendingWrite | null;
  attemptedClaims: Record<string, ClaimAttempt>;
  games: Record<string, TrackedGame>;
}

export async function loadState(config: ChallengerConfig): Promise<ChallengerState> {
  const path = resolve(config.statePath);
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!isState(parsed))
      throw new Error("Challenger state file has an unsupported or invalid format.");
    if (
      parsed.chainId !== config.chainId ||
      parsed.registryAddress.toLowerCase() !== config.registryAddress.toLowerCase()
    ) {
      throw new Error(
        "Challenger state belongs to a different chain or registry; refusing to reuse it.",
      );
    }
    return parsed;
  } catch (error) {
    if (isMissingFile(error)) return createEmptyState(config);
    throw error;
  }
}

export async function saveState(config: ChallengerConfig, state: ChallengerState): Promise<void> {
  const path = resolve(config.statePath);
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, path);
}

export async function acquireProcessLock(config: ChallengerConfig): Promise<() => Promise<void>> {
  const path = `${resolve(config.statePath)}.lock`;
  await mkdir(dirname(path), { recursive: true });
  let handle: FileHandle;
  try {
    handle = await open(path, "wx", 0o600);
  } catch {
    throw new Error(`Another challenger may be running; lock file exists at ${path}.`);
  }
  await handle.writeFile(`${process.pid}\n`);
  return async () => {
    await handle.close();
    await rm(path, { force: true });
  };
}

export async function setControlFile(path: string, enabled: boolean): Promise<void> {
  const resolved = resolve(path);
  await mkdir(dirname(resolved), { recursive: true });
  if (enabled)
    await writeFile(resolved, `${new Date().toISOString()}\n`, { flag: "w", mode: 0o600 });
  else await rm(resolved, { force: true });
}

export function controlPaths(statePath: string): {
  readonly emergencyStop: string;
  readonly disabled: string;
} {
  const base = resolve(statePath);
  return {
    emergencyStop: `${base}.STOP`,
    disabled: `${base}.DISABLED`,
  };
}

function createEmptyState(config: ChallengerConfig): ChallengerState {
  return {
    schema: "bisect.challenger-state.v1",
    chainId: config.chainId,
    registryAddress: config.registryAddress,
    cursorBlock: null,
    cursorHash: null,
    spentWei: "0",
    reservedWei: "0",
    pendingWrite: null,
    attemptedClaims: {},
    games: {},
  };
}

function isState(value: unknown): value is ChallengerState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  if (
    !(
      state["schema"] === "bisect.challenger-state.v1" &&
      Number.isSafeInteger(state["chainId"]) &&
      typeof state["registryAddress"] === "string" &&
      isAddress(state["registryAddress"]) &&
      (state["cursorBlock"] === null ||
        (typeof state["cursorBlock"] === "string" &&
          /^(0|[1-9][0-9]*)$/.test(state["cursorBlock"]))) &&
      (state["cursorHash"] === null ||
        (typeof state["cursorHash"] === "string" &&
          /^0x[0-9a-fA-F]{64}$/.test(state["cursorHash"]))) &&
      typeof state["spentWei"] === "string" &&
      /^(0|[1-9][0-9]*)$/.test(state["spentWei"]) &&
      typeof state["reservedWei"] === "string" &&
      /^(0|[1-9][0-9]*)$/.test(state["reservedWei"]) &&
      (state["pendingWrite"] === undefined ||
        state["pendingWrite"] === null ||
        isPendingWrite(state["pendingWrite"])) &&
      isRecord(state["attemptedClaims"]) &&
      isRecord(state["games"])
    )
  )
    return false;
  return (
    Object.values(state["attemptedClaims"]).every(isAttempt) &&
    Object.values(state["games"]).every(isTrackedGame)
  );
}

function isPendingWrite(value: unknown): value is PendingWrite {
  return (
    isRecord(value) &&
    typeof value["claimId"] === "string" &&
    /^[1-9][0-9]*$/.test(value["claimId"]) &&
    typeof value["action"] === "string" &&
    ["reserved", "submitted", "uncertain"].includes(String(value["status"])) &&
    typeof value["reservedWei"] === "string" &&
    /^(0|[1-9][0-9]*)$/.test(value["reservedWei"]) &&
    typeof value["bondWei"] === "string" &&
    /^(0|[1-9][0-9]*)$/.test(value["bondWei"]) &&
    typeof value["updatedAt"] === "string" &&
    (value["transactionHash"] === undefined ||
      (typeof value["transactionHash"] === "string" &&
        /^0x[0-9a-fA-F]{64}$/.test(value["transactionHash"])))
  );
}

function isAttempt(value: unknown): value is ClaimAttempt {
  if (
    !isRecord(value) ||
    typeof value["status"] !== "string" ||
    typeof value["updatedAt"] !== "string"
  )
    return false;
  if (
    !["reserved", "submitted", "confirmed", "reverted", "uncertain", "skipped"].includes(
      value["status"],
    )
  )
    return false;
  return (
    optionalDecimal(value["gameNumber"]) &&
    optionalDecimal(value["reservedWei"]) &&
    optionalDecimal(value["bondWei"]) &&
    optionalString(value["reason"]) &&
    (value["transactionHash"] === undefined ||
      (typeof value["transactionHash"] === "string" &&
        /^0x[0-9a-fA-F]{64}$/.test(value["transactionHash"])))
  );
}

function isTrackedGame(value: unknown): value is TrackedGame {
  return (
    isRecord(value) &&
    typeof value["claimId"] === "string" &&
    /^[1-9][0-9]*$/.test(value["claimId"]) &&
    typeof value["gameNumber"] === "string" &&
    /^[1-9][0-9]*$/.test(value["gameNumber"]) &&
    typeof value["discoveredAt"] === "string" &&
    optionalString(value["lastStatus"])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalDecimal(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value));
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
