import {
  createTraceCommitment,
  createStateProof as merkleCreateStateProof,
  computeStateCommitment as merkleStateCommitment,
  verifyStateProof as merkleVerifyStateProof,
  type ProgramSource,
  parseStateProof,
  parseTraceCommitment,
  type StateCommitment,
  type StateProofArtifact,
  type StateProofExpectation,
  serializeStateProof,
  serializeTraceCommitment,
  type TraceCommitmentArtifact,
} from "@bisect/merkle";
import type { State } from "@bisect/vm";
import type { Hex } from "viem";

export type {
  ProgramSource,
  StateCommitment,
  StateProofArtifact,
  StateProofExpectation,
  TraceCommitmentArtifact,
} from "@bisect/merkle";

export interface GenerateTraceCommitmentRequest {
  readonly program: ProgramSource;
  readonly publicInput: unknown;
  readonly transitionCount: number;
}

export interface StateCommitmentRequest {
  readonly executionContextHash: Hex;
  readonly transitionCount: number;
  readonly stateIndex: number;
  readonly state: State;
}

export interface CreateStateProofRequest {
  readonly trace: TraceCommitmentArtifact;
  readonly stateIndex: number;
}

export interface VerifyStateProofRequest extends StateProofExpectation {
  readonly proof: unknown;
}

/** Execute the Phase 2 VM and return its canonical v1 trace commitment. */
export function generateTraceCommitment(
  request: GenerateTraceCommitmentRequest,
): TraceCommitmentArtifact {
  return createTraceCommitment(request.program, request.publicInput, request.transitionCount);
}

/** Generate the execution trace root without returning the trace artifact. */
export function generateTraceRoot(request: GenerateTraceCommitmentRequest): Hex {
  return generateTraceCommitment(request).traceRoot;
}

/** Bind canonical state bytes to the v1 execution context and exact trace index. */
export function commitExecutionState(request: StateCommitmentRequest): StateCommitment {
  return merkleStateCommitment(
    request.executionContextHash,
    request.transitionCount,
    request.stateIndex,
    request.state,
  );
}

/** Generate a bottom-up inclusion path for a trace state. */
export function createExecutionStateProof(request: CreateStateProofRequest): StateProofArtifact {
  return merkleCreateStateProof(request.trace, request.stateIndex);
}

/** Verify membership against caller-trusted program, input, budget, and root. */
export function verifyExecutionStateProof(request: VerifyStateProofRequest): boolean {
  return merkleVerifyStateProof(request.proof, request);
}

/** Export the complete trace with all uint64 registers represented as decimal strings. */
export function exportExecutionTrace(trace: TraceCommitmentArtifact): string {
  return serializeTraceCommitment(trace);
}

/** Parse, validate, and deterministically replay an exported trace artifact. */
export function importExecutionTrace(serialized: string): TraceCommitmentArtifact {
  return parseTraceCommitment(serialized);
}

/** Export a canonical proof artifact suitable for JSON storage or transport. */
export function exportExecutionStateProof(proof: StateProofArtifact): string {
  return serializeStateProof(proof);
}

/** Parse and self-check a canonical JSON inclusion proof artifact. */
export function importExecutionStateProof(serialized: string): StateProofArtifact {
  return parseStateProof(serialized);
}
