import {
  APPROVED_BUDGETS,
  computeContextHash,
  computeInputHash,
  computeLeafHash,
  computeNodeHash,
  computeProgramHash,
  computeStateHash,
  type ExecutionBudget,
  encodePublicInputAbi,
  type Program,
  parseProgram,
  parsePublicInput,
  parseStateJson,
  programToHex,
  requireBudget,
  type SerializedState,
  type State,
  serializeCanonicalJson,
  serializeState,
  serializeStateAbi,
  traceProgram,
} from "@bisect/vm";
import type { Hex } from "viem";

export const TRACE_COMMITMENT_SCHEMA = "bisect.trace-commitment.v1" as const;
export const STATE_PROOF_SCHEMA = "bisect.state-proof.v1" as const;

export type ProgramSource = Program | Uint8Array | string;

export interface TraceCommitmentArtifact {
  readonly schema: typeof TRACE_COMMITMENT_SCHEMA;
  readonly protocolVersion: 1;
  readonly vmVersion: 1;
  readonly encodingVersion: 1;
  readonly programHex: `0x${string}`;
  readonly publicInput: readonly string[];
  readonly publicInputAbiEncoded: Hex;
  readonly transitionCount: ExecutionBudget;
  readonly leafCount: number;
  readonly programHash: Hex;
  readonly inputHash: Hex;
  readonly executionContextHash: Hex;
  readonly traceRoot: Hex;
  readonly haltIndex: number | null;
  readonly haltedWithinBudget: boolean;
  readonly states: readonly SerializedState[];
}

export interface StateCommitment {
  readonly stateIndex: number;
  readonly stateAbiEncoded: Hex;
  readonly stateHash: Hex;
  readonly leafHash: Hex;
}

export interface StateProofArtifact {
  readonly schema: typeof STATE_PROOF_SCHEMA;
  readonly protocolVersion: 1;
  readonly vmVersion: 1;
  readonly encodingVersion: 1;
  readonly programHex: `0x${string}`;
  readonly publicInput: readonly string[];
  readonly publicInputAbiEncoded: Hex;
  readonly transitionCount: ExecutionBudget;
  readonly leafCount: number;
  readonly programHash: Hex;
  readonly inputHash: Hex;
  readonly executionContextHash: Hex;
  readonly traceRoot: Hex;
  readonly stateIndex: number;
  readonly state: SerializedState;
  readonly stateAbiEncoded: Hex;
  readonly stateHash: Hex;
  readonly leafHash: Hex;
  readonly siblingsBottomUp: readonly Hex[];
}

export interface StateProofExpectation {
  readonly program: ProgramSource;
  readonly publicInput: unknown;
  readonly transitionCount: number;
  readonly expectedRoot: Hex;
}

export type MerkleErrorCode =
  | "INVALID_CONTEXT_HASH"
  | "INVALID_STATE_INDEX"
  | "INVALID_TRACE_ARTIFACT"
  | "INVALID_PROOF_ARTIFACT"
  | "TRACE_ROOT_MISMATCH";

export class MerkleError extends Error {
  readonly code: MerkleErrorCode;

  constructor(code: MerkleErrorCode, message: string) {
    super(message);
    this.name = "MerkleError";
    this.code = code;
  }
}

const TRACE_KEYS = [
  "schema",
  "protocolVersion",
  "vmVersion",
  "encodingVersion",
  "programHex",
  "publicInput",
  "publicInputAbiEncoded",
  "transitionCount",
  "leafCount",
  "programHash",
  "inputHash",
  "executionContextHash",
  "traceRoot",
  "haltIndex",
  "haltedWithinBudget",
  "states",
] as const;

const PROOF_KEYS = [
  "schema",
  "protocolVersion",
  "vmVersion",
  "encodingVersion",
  "programHex",
  "publicInput",
  "publicInputAbiEncoded",
  "transitionCount",
  "leafCount",
  "programHash",
  "inputHash",
  "executionContextHash",
  "traceRoot",
  "stateIndex",
  "state",
  "stateAbiEncoded",
  "stateHash",
  "leafHash",
  "siblingsBottomUp",
] as const;

const HASH_PATTERN = /^0x[0-9a-f]{64}$/;

/**
 * Execute the canonical v1 VM and independently build its ordered trace tree.
 * The VM's root is compared with this package's root as a consistency check.
 * V1 traces contain 64, 256, 1024, or 4096 leaves and have no padding.
 */
export function createTraceCommitment(
  programSource: ProgramSource,
  publicInputSource: unknown,
  transitionCountSource: number,
): TraceCommitmentArtifact {
  const program = canonicalProgram(programSource);
  const publicInput = parsePublicInput(publicInputSource);
  const transitionCount = requireBudget(transitionCountSource);
  const execution = traceProgram(program, publicInput, transitionCount);
  const treeRoot = orderedTreeRoot(execution.executionContextHash, execution.trace);

  if (!sameHash(treeRoot, execution.traceRoot)) {
    throw new MerkleError(
      "TRACE_ROOT_MISMATCH",
      "Merkle package root does not match the Phase 2 VM root.",
    );
  }

  const states = Object.freeze(execution.trace.map(serializeState));
  return Object.freeze({
    schema: TRACE_COMMITMENT_SCHEMA,
    protocolVersion: 1,
    vmVersion: 1,
    encodingVersion: 1,
    programHex: programToHex(program),
    publicInput: Object.freeze(publicInput.map((value) => value.toString(10))),
    publicInputAbiEncoded: encodePublicInputAbi(publicInput),
    transitionCount,
    leafCount: states.length,
    programHash: execution.programHash,
    inputHash: execution.inputHash,
    executionContextHash: execution.executionContextHash,
    traceRoot: treeRoot,
    haltIndex: execution.haltIndex,
    haltedWithinBudget: execution.haltIndex !== null,
    states,
  });
}

/** Generate the v1 root for a real VM execution trace. */
export function computeTraceRoot(
  programSource: ProgramSource,
  publicInputSource: unknown,
  transitionCountSource: number,
): Hex {
  return createTraceCommitment(programSource, publicInputSource, transitionCountSource).traceRoot;
}

/** Compute the canonical ABI state bytes, state hash, and context/index leaf. */
export function computeStateCommitment(
  executionContextHash: Hex,
  transitionCountSource: number,
  stateIndex: number,
  stateSource: State,
): StateCommitment {
  if (!isCanonicalHash(executionContextHash)) {
    throw new MerkleError("INVALID_CONTEXT_HASH", "Context hash must be lowercase bytes32 hex.");
  }
  const transitionCount = requireBudget(transitionCountSource);
  assertStateIndex(stateIndex, transitionCount);
  const state = parseStateJson(serializeState(stateSource));
  const stateHash = computeStateHash(state);
  return Object.freeze({
    stateIndex,
    stateAbiEncoded: serializeStateAbi(state),
    stateHash,
    leafHash: computeLeafHash(executionContextHash, stateIndex, state),
  });
}

/** Create a bottom-up, position-sensitive proof for any state in the trace. */
export function createStateProof(
  artifactSource: TraceCommitmentArtifact,
  stateIndex: number,
): StateProofArtifact {
  const artifact = validateTraceArtifact(artifactSource);
  assertStateIndex(stateIndex, artifact.transitionCount);
  const states = artifact.states.map((state) => parseStateJson(state));
  const levels = orderedTreeLevels(artifact.executionContextHash, states);
  const siblings: Hex[] = [];
  let position = stateIndex;

  for (let level = 0; level < levels.length - 1; level += 1) {
    const sibling = levels[level]?.[position ^ 1];
    if (sibling === undefined) {
      throw new MerkleError("INVALID_TRACE_ARTIFACT", "Merkle sibling is missing.");
    }
    siblings.push(sibling);
    position = Math.floor(position / 2);
  }

  const state = states[stateIndex];
  if (state === undefined) {
    throw new MerkleError("INVALID_STATE_INDEX", "State index is outside the trace.");
  }
  const stateCommitment = computeStateCommitment(
    artifact.executionContextHash,
    artifact.transitionCount,
    stateIndex,
    state,
  );

  return normalizeProofArtifact({
    schema: STATE_PROOF_SCHEMA,
    protocolVersion: 1,
    vmVersion: 1,
    encodingVersion: 1,
    programHex: artifact.programHex,
    publicInput: artifact.publicInput,
    publicInputAbiEncoded: artifact.publicInputAbiEncoded,
    transitionCount: artifact.transitionCount,
    leafCount: artifact.leafCount,
    programHash: artifact.programHash,
    inputHash: artifact.inputHash,
    executionContextHash: artifact.executionContextHash,
    traceRoot: artifact.traceRoot,
    stateIndex,
    state: serializeState(state),
    stateAbiEncoded: stateCommitment.stateAbiEncoded,
    stateHash: stateCommitment.stateHash,
    leafHash: stateCommitment.leafHash,
    siblingsBottomUp: Object.freeze(siblings),
  });
}

/**
 * Verify an inclusion proof against caller-supplied program, input, budget,
 * and root. Membership does not prove that every trace transition is valid.
 */
export function verifyStateProof(
  proofSource: unknown,
  expectation: StateProofExpectation,
): boolean {
  try {
    const proof = normalizeProofArtifact(proofSource);
    const program = canonicalProgram(expectation.program);
    const publicInput = parsePublicInput(expectation.publicInput);
    const transitionCount = requireBudget(expectation.transitionCount);
    if (!isCanonicalHash(expectation.expectedRoot)) return false;

    const programHex = programToHex(program);
    const programHash = computeProgramHash(program);
    const inputHash = computeInputHash(publicInput);
    const executionContextHash = computeContextHash(programHash, inputHash, transitionCount);

    if (
      proof.programHex !== programHex ||
      !sameValues(
        proof.publicInput,
        publicInput.map((value) => value.toString(10)),
      ) ||
      proof.publicInputAbiEncoded !== encodePublicInputAbi(publicInput) ||
      proof.transitionCount !== transitionCount ||
      proof.leafCount !== transitionCount + 1 ||
      !sameHash(proof.programHash, programHash) ||
      !sameHash(proof.inputHash, inputHash) ||
      !sameHash(proof.executionContextHash, executionContextHash) ||
      !sameHash(proof.traceRoot, expectation.expectedRoot)
    ) {
      return false;
    }

    return (
      reconstructRoot(
        proof.leafHash,
        proof.stateIndex,
        proof.siblingsBottomUp,
        transitionCount,
      ).toLowerCase() === expectation.expectedRoot.toLowerCase()
    );
  } catch {
    return false;
  }
}

/** Serialize a full bounded trace artifact using decimal-string uint64 values. */
export function serializeTraceCommitment(artifact: TraceCommitmentArtifact): string {
  return serializeCanonicalJson(artifact);
}

/** Parse canonical JSON and replay the VM to reject altered or mismatched traces. */
export function parseTraceCommitment(serialized: string): TraceCommitmentArtifact {
  const value = parseJson(serialized, "INVALID_TRACE_ARTIFACT");
  const artifact = validateTraceArtifact(value);
  if (serializeCanonicalJson(artifact) !== serialized) {
    throw new MerkleError("INVALID_TRACE_ARTIFACT", "Trace JSON is not in canonical form.");
  }
  return artifact;
}

/** Serialize a proof artifact; all uint64 state values remain decimal strings. */
export function serializeStateProof(proof: StateProofArtifact): string {
  return serializeCanonicalJson(normalizeProofArtifact(proof));
}

/** Parse canonical proof JSON and check its self-contained hashes and ordered path. */
export function parseStateProof(serialized: string): StateProofArtifact {
  const value = parseJson(serialized, "INVALID_PROOF_ARTIFACT");
  const proof = normalizeProofArtifact(value);
  if (serializeCanonicalJson(proof) !== serialized) {
    throw new MerkleError("INVALID_PROOF_ARTIFACT", "Proof JSON is not in canonical form.");
  }
  return proof;
}

function canonicalProgram(source: ProgramSource): Program {
  if (typeof source === "string" || source instanceof Uint8Array) return parseProgram(source);
  return parseProgram(source.bytes);
}

function orderedTreeRoot(contextHash: Hex, trace: readonly State[]): Hex {
  const leafCount = trace.length;
  if (!isAllowedLeafCount(leafCount)) {
    throw new MerkleError(
      "INVALID_TRACE_ARTIFACT",
      "V1 trace must contain 64, 256, 1024, or 4096 states; padding is not permitted.",
    );
  }
  const root = orderedTreeLevels(contextHash, trace).at(-1)?.[0];
  if (root === undefined) {
    throw new MerkleError("INVALID_TRACE_ARTIFACT", "Ordered tree did not produce a root.");
  }
  return root;
}

function orderedTreeLevels(contextHash: Hex, trace: readonly State[]): Hex[][] {
  let level = trace.map((state, index) => computeLeafHash(contextHash, index, state));
  if (level.length === 0 || (level.length & (level.length - 1)) !== 0) {
    throw new MerkleError("INVALID_TRACE_ARTIFACT", "Trace leaf count must be a power of two.");
  }
  const levels = [level];
  while (level.length > 1) {
    const next: Hex[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index];
      const right = level[index + 1];
      if (left === undefined || right === undefined) {
        throw new MerkleError(
          "INVALID_TRACE_ARTIFACT",
          "Ordered tree contains an incomplete pair.",
        );
      }
      // v1 node hashing is noncommutative: preserve left/right position.
      next.push(computeNodeHash(left, right));
    }
    levels.push(next);
    level = next;
  }
  return levels;
}

function reconstructRoot(
  leafHash: Hex,
  stateIndex: number,
  siblingsBottomUp: readonly Hex[],
  transitionCount: ExecutionBudget,
): Hex {
  const expectedDepth = Math.log2(transitionCount + 1);
  if (siblingsBottomUp.length !== expectedDepth) {
    throw new MerkleError(
      "INVALID_PROOF_ARTIFACT",
      "Proof sibling count does not match the budget.",
    );
  }
  let root = leafHash;
  for (let level = 0; level < expectedDepth; level += 1) {
    const sibling = siblingsBottomUp[level];
    if (sibling === undefined) {
      throw new MerkleError("INVALID_PROOF_ARTIFACT", "Proof sibling path is truncated.");
    }
    root =
      ((stateIndex >> level) & 1) === 0
        ? computeNodeHash(root, sibling)
        : computeNodeHash(sibling, root);
  }
  return root;
}

function validateTraceArtifact(source: unknown): TraceCommitmentArtifact {
  if (!isTraceArtifact(source)) {
    throw new MerkleError("INVALID_TRACE_ARTIFACT", "Trace artifact has an invalid shape.");
  }
  const program = canonicalProgram(source.programHex);
  const publicInput = parsePublicInput(source.publicInput);
  const transitionCount = requireBudget(source.transitionCount);
  const expected = createTraceCommitment(program, publicInput, transitionCount);
  const normalizedSource = normalizeTraceFields(source);
  if (serializeCanonicalJson(expected) !== serializeCanonicalJson(normalizedSource)) {
    throw new MerkleError(
      "INVALID_TRACE_ARTIFACT",
      "Trace metadata or states do not match deterministic VM execution.",
    );
  }
  return expected;
}

function normalizeTraceFields(source: TraceCommitmentArtifact): TraceCommitmentArtifact {
  const states = source.states.map((state) => normalizeSerializedState(state));
  return Object.freeze({
    schema: source.schema,
    protocolVersion: source.protocolVersion,
    vmVersion: source.vmVersion,
    encodingVersion: source.encodingVersion,
    programHex: source.programHex,
    publicInput: Object.freeze([...source.publicInput]),
    publicInputAbiEncoded: source.publicInputAbiEncoded,
    transitionCount: source.transitionCount,
    leafCount: source.leafCount,
    programHash: source.programHash,
    inputHash: source.inputHash,
    executionContextHash: source.executionContextHash,
    traceRoot: source.traceRoot,
    haltIndex: source.haltIndex,
    haltedWithinBudget: source.haltedWithinBudget,
    states: Object.freeze(states),
  });
}

function normalizeProofArtifact(source: unknown): StateProofArtifact {
  if (!isProofArtifact(source)) {
    throw new MerkleError("INVALID_PROOF_ARTIFACT", "Proof artifact has an invalid shape.");
  }
  const program = canonicalProgram(source.programHex);
  const publicInput = parsePublicInput(source.publicInput);
  const transitionCount = requireBudget(source.transitionCount);
  assertStateIndex(source.stateIndex, transitionCount);

  const programHex = programToHex(program);
  const programHash = computeProgramHash(program);
  const inputHash = computeInputHash(publicInput);
  const executionContextHash = computeContextHash(programHash, inputHash, transitionCount);
  const state = parseStateJson(source.state);
  const stateAbiEncoded = serializeStateAbi(state);
  const stateHash = computeStateHash(state);
  const leafHash = computeLeafHash(executionContextHash, source.stateIndex, state);
  const siblings = Object.freeze([...source.siblingsBottomUp]);

  if (
    source.schema !== STATE_PROOF_SCHEMA ||
    source.protocolVersion !== 1 ||
    source.vmVersion !== 1 ||
    source.encodingVersion !== 1 ||
    source.programHex !== programHex ||
    !sameValues(
      source.publicInput,
      publicInput.map((value) => value.toString(10)),
    ) ||
    source.publicInputAbiEncoded !== encodePublicInputAbi(publicInput) ||
    source.leafCount !== transitionCount + 1 ||
    !sameHash(source.programHash, programHash) ||
    !sameHash(source.inputHash, inputHash) ||
    !sameHash(source.executionContextHash, executionContextHash) ||
    source.stateAbiEncoded !== stateAbiEncoded ||
    !sameHash(source.stateHash, stateHash) ||
    !sameHash(source.leafHash, leafHash) ||
    siblings.length !== Math.log2(transitionCount + 1) ||
    siblings.some((sibling) => !isCanonicalHash(sibling)) ||
    !sameHash(
      reconstructRoot(leafHash, source.stateIndex, siblings, transitionCount),
      source.traceRoot,
    )
  ) {
    throw new MerkleError(
      "INVALID_PROOF_ARTIFACT",
      "Proof fields, state commitment, context, or ordered siblings are inconsistent.",
    );
  }

  return Object.freeze({
    schema: STATE_PROOF_SCHEMA,
    protocolVersion: 1,
    vmVersion: 1,
    encodingVersion: 1,
    programHex,
    publicInput: Object.freeze(publicInput.map((value) => value.toString(10))),
    publicInputAbiEncoded: encodePublicInputAbi(publicInput),
    transitionCount,
    leafCount: transitionCount + 1,
    programHash,
    inputHash,
    executionContextHash,
    traceRoot: source.traceRoot,
    stateIndex: source.stateIndex,
    state: serializeState(state),
    stateAbiEncoded,
    stateHash,
    leafHash,
    siblingsBottomUp: siblings,
  });
}

function isTraceArtifact(value: unknown): value is TraceCommitmentArtifact {
  if (!isRecord(value) || !hasExactKeys(value, TRACE_KEYS)) return false;
  return (
    value["schema"] === TRACE_COMMITMENT_SCHEMA &&
    value["protocolVersion"] === 1 &&
    value["vmVersion"] === 1 &&
    value["encodingVersion"] === 1 &&
    typeof value["programHex"] === "string" &&
    isStringArray(value["publicInput"]) &&
    isCanonicalHexData(value["publicInputAbiEncoded"]) &&
    isExecutionBudget(value["transitionCount"]) &&
    typeof value["leafCount"] === "number" &&
    Number.isInteger(value["leafCount"]) &&
    isCanonicalHash(value["programHash"]) &&
    isCanonicalHash(value["inputHash"]) &&
    isCanonicalHash(value["executionContextHash"]) &&
    isCanonicalHash(value["traceRoot"]) &&
    (value["haltIndex"] === null ||
      (typeof value["haltIndex"] === "number" && Number.isInteger(value["haltIndex"]))) &&
    typeof value["haltedWithinBudget"] === "boolean" &&
    Array.isArray(value["states"]) &&
    value["states"].every(isSerializedState)
  );
}

function isProofArtifact(value: unknown): value is StateProofArtifact {
  if (!isRecord(value) || !hasExactKeys(value, PROOF_KEYS)) return false;
  return (
    value["schema"] === STATE_PROOF_SCHEMA &&
    value["protocolVersion"] === 1 &&
    value["vmVersion"] === 1 &&
    value["encodingVersion"] === 1 &&
    typeof value["programHex"] === "string" &&
    isStringArray(value["publicInput"]) &&
    isCanonicalHexData(value["publicInputAbiEncoded"]) &&
    isExecutionBudget(value["transitionCount"]) &&
    typeof value["leafCount"] === "number" &&
    Number.isInteger(value["leafCount"]) &&
    isCanonicalHash(value["programHash"]) &&
    isCanonicalHash(value["inputHash"]) &&
    isCanonicalHash(value["executionContextHash"]) &&
    isCanonicalHash(value["traceRoot"]) &&
    typeof value["stateIndex"] === "number" &&
    Number.isInteger(value["stateIndex"]) &&
    isSerializedState(value["state"]) &&
    isCanonicalHexData(value["stateAbiEncoded"]) &&
    isCanonicalHash(value["stateHash"]) &&
    isCanonicalHash(value["leafHash"]) &&
    Array.isArray(value["siblingsBottomUp"]) &&
    value["siblingsBottomUp"].every(isCanonicalHash)
  );
}

function isSerializedState(value: unknown): value is SerializedState {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["pc", "halted", "registers"]) ||
    typeof value["pc"] !== "number" ||
    !Number.isInteger(value["pc"]) ||
    typeof value["halted"] !== "boolean" ||
    !isStringArray(value["registers"]) ||
    value["registers"].length !== 8
  ) {
    return false;
  }
  try {
    const parsed = parseStateJson(value);
    const canonical = serializeState(parsed);
    return serializeCanonicalJson(canonical) === serializeCanonicalJson(value);
  } catch {
    return false;
  }
}

function normalizeSerializedState(state: SerializedState): SerializedState {
  return serializeState(parseStateJson(state));
}

function assertStateIndex(index: number, transitionCount: ExecutionBudget): void {
  if (!Number.isInteger(index) || index < 0 || index > transitionCount) {
    throw new MerkleError("INVALID_STATE_INDEX", `State index must be in 0..${transitionCount}.`);
  }
}

function isAllowedLeafCount(leafCount: number): boolean {
  return APPROVED_BUDGETS.some((budget) => budget + 1 === leafCount);
}

function isExecutionBudget(value: unknown): value is ExecutionBudget {
  return typeof value === "number" && APPROVED_BUDGETS.some((budget) => budget === value);
}

function isCanonicalHash(value: unknown): value is Hex {
  return typeof value === "string" && HASH_PATTERN.test(value);
}

function isCanonicalHexData(value: unknown): value is Hex {
  return typeof value === "string" && /^0x(?:[0-9a-f]{2})*$/.test(value);
}

function sameHash(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item): item is string => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function parseJson(
  value: string,
  code: "INVALID_TRACE_ARTIFACT" | "INVALID_PROOF_ARTIFACT",
): unknown {
  try {
    const parsed: unknown = JSON.parse(value) as unknown;
    return parsed;
  } catch {
    throw new MerkleError(code, "Artifact is not valid JSON.");
  }
}
