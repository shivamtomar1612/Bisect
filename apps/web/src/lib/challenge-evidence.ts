import {
  createExecutionStateProof,
  type TraceCommitmentArtifact,
  verifyExecutionStateProof,
} from "@bisect/sdk";
import { computeLeafHash, computeNodeHash, parseStateJson } from "@bisect/vm";
import type { Hex } from "viem";
import { toContractProof } from "../components/program-studio-utils";

export function initialChallengeProof(trace: TraceCommitmentArtifact) {
  const proof = createExecutionStateProof({ trace, stateIndex: 0 });
  if (
    !verifyExecutionStateProof({
      proof,
      program: trace.programHex,
      publicInput: trace.publicInput,
      transitionCount: trace.transitionCount,
      expectedRoot: trace.traceRoot,
    })
  )
    throw new Error("The independently generated initial proof failed verification.");
  return toContractProof(proof);
}

export function traceChildren(
  trace: TraceCommitmentArtifact,
  baseIndex: number,
  height: number,
  expectedNode: Hex,
) {
  if (
    !Number.isInteger(height) ||
    height < 1 ||
    height > 12 ||
    !Number.isInteger(baseIndex) ||
    baseIndex < 0 ||
    baseIndex % 2 ** height !== 0 ||
    baseIndex + 2 ** height > trace.states.length
  )
    throw new Error("The on-chain bisection interval is malformed.");
  let level = trace.states.map((state, index) =>
    computeLeafHash(trace.executionContextHash, index, parseStateJson(state)),
  );
  for (let depth = 0; depth < height - 1; depth++) {
    const next: Hex[] = [];
    for (let index = 0; index < level.length; index += 2)
      next.push(computeNodeHash(level[index] as Hex, level[index + 1] as Hex));
    level = next;
  }
  const position = baseIndex / 2 ** (height - 1);
  const left = level[position];
  const right = level[position + 1];
  if (!left || !right || computeNodeHash(left, right).toLowerCase() !== expectedNode.toLowerCase())
    throw new Error("The local trace does not open the authenticated on-chain subtree.");
  return { left, right };
}

export function terminalChallengeProof(trace: TraceCommitmentArtifact, differentIndex: number) {
  if (
    !Number.isInteger(differentIndex) ||
    differentIndex < 1 ||
    differentIndex > trace.transitionCount
  )
    throw new Error("The on-chain disagreement index is outside the trace.");
  const previous = createExecutionStateProof({ trace, stateIndex: differentIndex - 1 });
  const next = createExecutionStateProof({ trace, stateIndex: differentIndex });
  const expectation = {
    program: trace.programHex,
    publicInput: trace.publicInput,
    transitionCount: trace.transitionCount,
    expectedRoot: trace.traceRoot,
  };
  if (
    !verifyExecutionStateProof({ proof: previous, ...expectation }) ||
    !verifyExecutionStateProof({ proof: next, ...expectation })
  )
    throw new Error("The terminal inclusion proofs failed local verification.");
  const predecessor = toContractProof(previous);
  const successor = toContractProof(next);
  const input = trace.publicInput.map((value) => BigInt(value));
  if (input.length !== 8) throw new Error("The trace public input is malformed.");
  return {
    program: trace.programHex,
    publicInput: input as [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint],
    transitionCount: trace.transitionCount,
    traceRoot: trace.traceRoot,
    stateIndex: differentIndex - 1,
    predecessor: predecessor.state,
    predecessorSiblings: predecessor.siblings,
    claimedSuccessor: successor.state,
    successorSiblings: successor.siblings,
  };
}
