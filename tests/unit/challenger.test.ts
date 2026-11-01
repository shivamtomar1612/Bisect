import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateTraceCommitment } from "@bisect/sdk";
import { computeTraceRoot, createState, parseStateJson } from "@bisect/vm";
import { describe, expect, it } from "vitest";
import { loadChallengerConfig } from "../../apps/challenger/src/config.js";
import {
  buildInitialStateProof,
  buildTransitionProof,
  buildTreeLevels,
  evaluateClaimEvidence,
  getSubtreeChildren,
} from "../../apps/challenger/src/evidence.js";
import {
  controlPaths,
  loadState,
  saveState,
  setControlFile,
} from "../../apps/challenger/src/state-store.js";

const program = "0x010000050100002a09000000" as const;
const publicInput = [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n] as const;
const registryAddress = "0x0000000000000000000000000000000000000001" as const;

describe("Phase 15 challenger evidence", () => {
  it("ignores a valid honest trace", () => {
    const trace = generateTraceCommitment({ program, publicInput, transitionCount: 63 });
    const result = evaluateClaimEvidence({
      status: 1,
      prover: registryAddress,
      program,
      publicInput,
      transitionCount: 63,
      traceRoot: trace.traceRoot,
      claimedOutput: 42n,
      contextHash: trace.executionContextHash,
      challengeDeadline: 100n,
    });
    expect(result.kind).toBe("honest");
    if (result.kind === "honest") expect(result.outputMatches).toBe(true);
  });

  it("detects an invalid intermediate trace even when the final output is correct", () => {
    const trace = generateTraceCommitment({ program, publicInput, transitionCount: 63 });
    const states = trace.states.map(parseStateJson);
    const middle = states[1];
    if (middle === undefined) throw new Error("Missing intermediate test state.");
    const alteredRegisters = [...middle.registers];
    alteredRegisters[7] = 9n;
    states[1] = createState(middle.pc, middle.halted, alteredRegisters);
    const invalidRoot = computeTraceRoot(trace.executionContextHash, states);
    const result = evaluateClaimEvidence({
      status: 1,
      prover: registryAddress,
      program,
      publicInput,
      transitionCount: 63,
      traceRoot: invalidRoot,
      claimedOutput: 42n,
      contextHash: trace.executionContextHash,
      challengeDeadline: 100n,
    });
    expect(result.kind).toBe("suspicious");
    if (result.kind === "suspicious") expect(result.outputMatches).toBe(true);
  });

  it("rejects evidence from a mismatched program/input/budget context", () => {
    const trace = generateTraceCommitment({ program, publicInput, transitionCount: 63 });
    const result = evaluateClaimEvidence({
      status: 1,
      prover: registryAddress,
      program,
      publicInput,
      transitionCount: 63,
      traceRoot: `0x${"0".repeat(64)}`,
      claimedOutput: 42n,
      contextHash: `0x${"1".repeat(64)}`,
      challengeDeadline: 100n,
    });
    expect(result.kind).toBe("context-invalid");
    expect(trace.executionContextHash).not.toBe(`0x${"1".repeat(64)}`);
  });

  it("builds initial, adjacent-transition, and ordered subtree evidence", () => {
    const trace = generateTraceCommitment({ program, publicInput, transitionCount: 63 });
    expect(buildInitialStateProof(trace).siblings).toHaveLength(6);
    const proof = buildTransitionProof(trace, 1);
    expect(proof.stateIndex).toBe(0);
    expect(proof.predecessorSiblings).toHaveLength(6);
    expect(proof.successorSiblings).toHaveLength(6);
    const levels = buildTreeLevels(trace);
    expect(levels).toHaveLength(7);
    const [left, right] = getSubtreeChildren(levels, 0, 6);
    expect(left).not.toBe(right);
  });

  it("fails closed on malformed configuration and defaults to dry-run", () => {
    const config = loadChallengerConfig({
      BISECT_BOT_CHAIN_ID: "31337",
      BISECT_BOT_REGISTRY_ADDRESS: registryAddress,
    });
    expect(config.broadcastAuthorized).toBe(false);
    expect(config.maxTotalSpendWei).toBe(0n);
    expect(config.maxBondWei).toBe(0n);
    expect(config.maxGasPerTransactionWei).toBe(0n);
    expect(() =>
      loadChallengerConfig({
        BISECT_BOT_CHAIN_ID: "8453",
        BISECT_BOT_REGISTRY_ADDRESS: registryAddress,
      }),
    ).toThrow(/only local Anvil/);
    expect(() =>
      loadChallengerConfig({
        BISECT_BOT_CHAIN_ID: "84532",
        BISECT_BOT_REGISTRY_ADDRESS: registryAddress,
        BISECT_BOT_CONFIRMATIONS: "0",
      }),
    ).toThrow(/confirmations/);
    expect(() =>
      loadChallengerConfig({
        BISECT_BOT_CHAIN_ID: "31337",
        BISECT_BOT_REGISTRY_ADDRESS: registryAddress,
        BISECT_BOT_BROADCAST: "true",
        BISECT_BOT_USE_UNLOCKED_ACCOUNT: "true",
        BISECT_BOT_UNLOCKED_ADDRESS: registryAddress,
      }),
    ).toThrow(/positive total-spend/);
  });

  it("persists unresolved writes and emergency controls across reloads", async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "bisect-challenger-"));
    try {
      const config = {
        ...loadChallengerConfig({
          BISECT_BOT_CHAIN_ID: "31337",
          BISECT_BOT_REGISTRY_ADDRESS: registryAddress,
        }),
        statePath: join(temporaryDirectory, "state.json"),
        logPath: join(temporaryDirectory, "bot.jsonl"),
      };
      const state = await loadState(config);
      state.pendingWrite = {
        claimId: "7",
        action: "challenge",
        status: "submitted",
        reservedWei: "1000",
        bondWei: "900",
        updatedAt: "2026-11-01T00:00:00.000Z",
        transactionHash: `0x${"1".repeat(64)}`,
      };
      await saveState(config, state);
      expect((await loadState(config)).pendingWrite).toEqual(state.pendingWrite);

      const controls = controlPaths(config.statePath);
      await setControlFile(controls.emergencyStop, true);
      expect(await readFile(controls.emergencyStop, "utf8")).toContain("2026-");
      await setControlFile(controls.emergencyStop, false);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
