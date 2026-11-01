import {
  createExecutionStateProof,
  generateTraceCommitment,
  type TraceCommitmentArtifact,
} from "@bisect/sdk";
import {
  computeLeafHash,
  computeNodeHash,
  computeTraceRoot,
  parsePublicInput,
  parseStateJson,
  type Registers,
  type State,
} from "@bisect/vm";
import type { Address, Hex } from "viem";

export interface ClaimEvidenceInput {
  readonly status: number;
  readonly prover: Address;
  readonly program: Hex;
  readonly publicInput: readonly bigint[];
  readonly transitionCount: number;
  readonly traceRoot: Hex;
  readonly claimedOutput: bigint;
  readonly contextHash: Hex;
  readonly challengeDeadline: bigint;
}

export type EvidenceResult =
  | {
      readonly kind: "honest";
      readonly trace: TraceCommitmentArtifact;
      readonly outputMatches: boolean;
    }
  | {
      readonly kind: "suspicious";
      readonly trace: TraceCommitmentArtifact;
      readonly outputMatches: boolean;
      readonly rootMatches: false;
    }
  | {
      readonly kind: "context-invalid";
      readonly trace: TraceCommitmentArtifact;
      readonly reason: string;
    };

/** Recompute the VM trace locally; only a context-matching root mismatch is challenge evidence. */
export function evaluateClaimEvidence(claim: ClaimEvidenceInput): EvidenceResult {
  const trace = generateTraceCommitment({
    program: claim.program,
    publicInput: claim.publicInput,
    transitionCount: claim.transitionCount,
  });
  if (!sameHash(trace.executionContextHash, claim.contextHash)) {
    return {
      kind: "context-invalid",
      trace,
      reason: "The on-chain claim context does not match the canonical program, input, and budget.",
    };
  }

  const rootMatches = sameHash(trace.traceRoot, claim.traceRoot);
  const output = trace.haltedWithinBudget
    ? BigInt(trace.states[trace.states.length - 1]?.registers[0] ?? "0")
    : null;
  const outputMatches = output !== null && output === claim.claimedOutput;
  if (rootMatches) return { kind: "honest", trace, outputMatches };
  return { kind: "suspicious", trace, outputMatches, rootMatches: false };
}

export interface InitialStateProof {
  readonly state: SolidityState;
  readonly siblings: readonly Hex[];
}

export interface SolidityState {
  readonly pc: number;
  readonly halted: boolean;
  readonly registers: Registers;
}

export interface SolidityTransitionProof {
  readonly program: Hex;
  readonly publicInput: Registers;
  readonly transitionCount: number;
  readonly traceRoot: Hex;
  readonly stateIndex: number;
  readonly predecessor: SolidityState;
  readonly predecessorSiblings: readonly Hex[];
  readonly claimedSuccessor: SolidityState;
  readonly successorSiblings: readonly Hex[];
}

export function buildInitialStateProof(trace: TraceCommitmentArtifact): InitialStateProof {
  const proof = createExecutionStateProof({ trace, stateIndex: 0 });
  return { state: toSolidityState(parseStateJson(proof.state)), siblings: proof.siblingsBottomUp };
}

export function buildTransitionProof(
  trace: TraceCommitmentArtifact,
  stateIndex: number,
): SolidityTransitionProof {
  if (!Number.isInteger(stateIndex) || stateIndex < 1 || stateIndex > trace.transitionCount) {
    throw new RangeError("Transition proof index must be in 1..transitionCount.");
  }
  const predecessorProof = createExecutionStateProof({ trace, stateIndex: stateIndex - 1 });
  const successorProof = createExecutionStateProof({ trace, stateIndex });
  return {
    program: trace.programHex,
    publicInput: parsePublicInput(trace.publicInput),
    transitionCount: trace.transitionCount,
    traceRoot: trace.traceRoot,
    stateIndex: stateIndex - 1,
    predecessor: toSolidityState(parseStateJson(predecessorProof.state)),
    predecessorSiblings: predecessorProof.siblingsBottomUp,
    claimedSuccessor: toSolidityState(parseStateJson(successorProof.state)),
    successorSiblings: successorProof.siblingsBottomUp,
  };
}

/** Return ordered child hashes for a subtree in the canonical trace. */
export function buildTreeLevels(trace: TraceCommitmentArtifact): readonly (readonly Hex[])[] {
  let level: Hex[] = trace.states.map((serialized, index) =>
    computeLeafHash(trace.executionContextHash, index, parseStateJson(serialized)),
  );
  const levels: Hex[][] = [level];
  while (level.length > 1) {
    const next: Hex[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index];
      const right = level[index + 1];
      if (left === undefined || right === undefined)
        throw new Error("Trace tree contains an incomplete node.");
      next.push(computeNodeHash(left, right));
    }
    levels.push(next);
    level = next;
  }
  const calculatedRoot = level[0];
  if (calculatedRoot === undefined || !sameHash(calculatedRoot, trace.traceRoot)) {
    throw new Error("Canonical trace states do not reproduce the commitment root.");
  }
  return Object.freeze(levels.map((treeLevel) => Object.freeze(treeLevel)));
}

export function getSubtreeChildren(
  levels: readonly (readonly Hex[])[],
  baseIndex: number,
  height: number,
): readonly [Hex, Hex] {
  if (!Number.isInteger(height) || height < 1 || height >= levels.length) {
    throw new RangeError("Subtree height is outside the committed trace tree.");
  }
  const children = levels[height - 1];
  if (children === undefined) throw new Error("Subtree child level is missing.");
  const position = Math.floor(baseIndex / 2 ** (height - 1));
  const left = children[position * 2];
  const right = children[position * 2 + 1];
  if (left === undefined || right === undefined) throw new Error("Subtree children are missing.");
  return [left, right];
}

export function outputMatchesClaim(trace: TraceCommitmentArtifact, claimedOutput: bigint): boolean {
  if (!trace.haltedWithinBudget) return false;
  const final = trace.states.at(-1);
  if (final === undefined) return false;
  return BigInt(final.registers[0] ?? "0") === claimedOutput;
}

export function canonicalTraceMatchesRoot(trace: TraceCommitmentArtifact, root: Hex): boolean {
  return sameHash(
    computeTraceRoot(trace.executionContextHash, trace.states.map(parseStateJson)),
    root,
  );
}

function toSolidityState(state: State): SolidityState {
  return Object.freeze({ pc: state.pc, halted: state.halted, registers: state.registers });
}

function sameHash(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
