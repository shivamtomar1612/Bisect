import { generateTraceCommitment } from "@bisect/sdk";
import { computeNodeHash, createExample } from "@bisect/vm";
import { describe, expect, it } from "vitest";
import {
  initialChallengeProof,
  terminalChallengeProof,
  traceChildren,
} from "../../apps/web/src/lib/challenge-evidence";

describe("challenger evidence", () => {
  const example = createExample("addition");
  const trace = generateTraceCommitment({
    program: example.program,
    publicInput: example.publicInput,
    transitionCount: 63,
  });

  it("opens the canonical initial state and root subtree", () => {
    const initial = initialChallengeProof(trace);
    expect(initial.state.pc).toBe(0);
    expect(initial.siblings).toHaveLength(6);
    const children = traceChildren(trace, 0, 6, trace.traceRoot);
    expect(computeNodeHash(children.left, children.right)).toBe(trace.traceRoot);
  });

  it("builds authenticated adjacent terminal states", () => {
    const proof = terminalChallengeProof(trace, 2);
    expect(proof.stateIndex).toBe(1);
    expect(proof.predecessorSiblings).toHaveLength(6);
    expect(proof.successorSiblings).toHaveLength(6);
    expect(proof.traceRoot).toBe(trace.traceRoot);
  });

  it("rejects forged subtrees and invalid disagreement indices", () => {
    expect(() => traceChildren(trace, 0, 6, `0x${"00".repeat(32)}`)).toThrow();
    expect(() => traceChildren(trace, 1, 6, trace.traceRoot)).toThrow();
    expect(() => terminalChallengeProof(trace, 0)).toThrow();
  });
});
