import { describe, expect, it } from "vitest";
import { createEducationalDemoReplay } from "../../apps/web/src/lib/dispute-demo";
import { replayDisputeTimeline } from "../../apps/web/src/lib/dispute-replay";

// Synthetic event envelopes test validation only; they are never displayed as chain activity.
const prover = `0x${"11".repeat(20)}`;
const challenger = `0x${"22".repeat(20)}`;
const registry = `0x${"33".repeat(20)}`;
const demo = createEducationalDemoReplay();

function fixture() {
  const events: Array<{
    eventName: string;
    payload: Record<string, unknown>;
    blockNumber: string;
    transactionHash: string;
    transactionIndex: number;
    logIndex: number;
  }> = [];
  function push(eventName: string, payload: Record<string, unknown>) {
    const n = events.length + 1;
    events.push({
      eventName,
      payload: { claimId: "1", gameNumber: "1", ...payload },
      blockNumber: String(n),
      transactionHash: `0x${n.toString(16).padStart(64, "0")}`,
      transactionIndex: 0,
      logIndex: 0,
    });
  }
  push("ChallengeStarted", {
    challengerRoot: demo.challengerRoot,
    initialHeight: 10,
    bondWei: "1000000000000000000",
  });
  for (const round of demo.rounds) {
    push("DisputeChildrenRevealed", {
      responder: prover,
      leftChild: round.proverChildren[0],
      rightChild: round.proverChildren[1],
    });
    push("DisputeChildrenRevealed", {
      responder: challenger,
      leftChild: round.challengerChildren[0],
      rightChild: round.challengerChildren[1],
    });
    push("BisectionLevelResolved", {
      subtreeBaseIndex: round.retained === "left" ? round.low : round.midpoint,
      subtreeHeight: 10 - round.round,
      proverNode: round.proverChildren[round.retained === "left" ? 0 : 1],
      challengerNode: round.challengerChildren[round.retained === "left" ? 0 : 1],
    });
  }
  push("TerminalEvidenceRevealed", { responder: challenger, differentIndex: 700 });
  push("TerminalEvidenceRevealed", { responder: prover, differentIndex: 700 });
  push("GameResolved", { outcome: 3, winner: challenger, differentIndex: 700 });
  push("GameBondCredited", {
    outcome: 3,
    beneficiary: challenger,
    amountWei: "2000000000000000000",
  });
  return {
    chainId: 31337,
    contractAddress: registry,
    claimId: "1",
    gameNumber: "1",
    proverRoot: demo.proverRoot,
    challengerRoot: demo.challengerRoot,
    transitionCount: 1023,
    expectedRounds: 10,
    status: "CHALLENGER_WON",
    outcome: 3,
    prover,
    challenger,
    proverBond: { amountWei: "1000000000000000000", status: "SLASHED" },
    challengerBond: { amountWei: "1000000000000000000", status: "RELEASED" },
    settlements: [{ amountWei: "2000000000000000000", beneficiary: { address: challenger } }],
    lag: { lagBlocks: "0" },
    truncated: false,
    events,
  };
}

describe("ordered bisection replay", () => {
  it("measures ten actual hash reductions for a 1,023-transition VM trace", () => {
    expect(demo.transitionCount).toBe(1023);
    expect(demo.rounds).toHaveLength(10);
    expect(demo.rounds.map((round) => round.remaining)).toEqual([
      512, 256, 128, 64, 32, 16, 8, 4, 2, 1,
    ]);
    expect(demo.finalIndex).toBe(700);
  });
  it("authenticates ordered children, interval boundaries and settlement", () => {
    const replay = replayDisputeTimeline(fixture(), { claimId: "1", gameNumber: "1" });
    expect(replay.complete).toBe(true);
    expect(replay.rounds).toHaveLength(10);
    expect(replay.finalIndex).toBe(700);
    expect(replay.winner).toBe(challenger);
    expect(replay.creditedWei).toBe("2000000000000000000");
  });
  it("rejects forged child commitments and wrong financial beneficiary", () => {
    const badHash = fixture();
    badHash.events[1]!.payload["leftChild"] = `0x${"00".repeat(32)}`;
    expect(() => replayDisputeTimeline(badHash)).toThrow(/authenticate/);
    const badPayout = fixture();
    badPayout.events.at(-1)!.payload["beneficiary"] = prover;
    expect(() => replayDisputeTimeline(badPayout)).toThrow(/beneficiary/);
    const wrongAmount = fixture();
    wrongAmount.events.at(-1)!.payload["amountWei"] = "1000000000000000000";
    expect(() => replayDisputeTimeline(wrongAmount)).toThrow(/bond policy/);
  });
  it("reports missing rounds and rejects out-of-order events", () => {
    const missing = fixture();
    missing.events.splice(4, 1);
    const replay = replayDisputeTimeline(missing);
    expect(replay.complete).toBe(false);
    expect(replay.rounds).toHaveLength(1);
    const unordered = fixture();
    const first = unordered.events[1]!;
    unordered.events[1] = unordered.events[2]!;
    unordered.events[2] = first;
    expect(() => replayDisputeTimeline(unordered)).toThrow(/out of order/);
  });
});
