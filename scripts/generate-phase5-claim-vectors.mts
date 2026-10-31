import { mkdir, writeFile } from "node:fs/promises";
import { createStateProof, createTraceCommitment } from "../packages/merkle/dist/index.js";
import {
  computeTraceRoot,
  createMerkleProof,
  createState,
  parseStateJson,
  serializeStateAbi,
} from "../packages/vm/dist/index.js";

const program = "0x0100002a09000000";
const publicInput = ["0", "0", "0", "0", "0", "0", "0", "0"] as const;
const transitionCount = 63;
const artifact = createTraceCommitment(program, publicInput, transitionCount);
const initial = createStateProof(artifact, 0);
const terminal = createStateProof(artifact, transitionCount);

const sameOutputProgram = "0x010000050100002a09000000";
const sameOutputArtifact = createTraceCommitment(sameOutputProgram, publicInput, transitionCount);
const fraudulentTrace = sameOutputArtifact.states.map((state) => parseStateJson(state));
const canonicalIntermediate = fraudulentTrace[1];
if (canonicalIntermediate === undefined)
  throw new Error("Missing fraud vector intermediate state.");
fraudulentTrace[1] = createState(1, false, [9n, ...canonicalIntermediate.registers.slice(1)]);
const fraudulentIntermediate = fraudulentTrace[1];
const fraudulentRoot = computeTraceRoot(sameOutputArtifact.executionContextHash, fraudulentTrace);
const fraudulentInitial = fraudulentTrace[0];
const fraudulentTerminal = fraudulentTrace[transitionCount];
const honestTerminalJson = sameOutputArtifact.states[transitionCount];
if (
  fraudulentInitial === undefined ||
  fraudulentIntermediate === undefined ||
  fraudulentTerminal === undefined ||
  honestTerminalJson === undefined
) {
  throw new Error("Missing fraud vector endpoint state.");
}
if (
  fraudulentRoot === sameOutputArtifact.traceRoot ||
  serializeStateAbi(fraudulentTerminal) !== serializeStateAbi(parseStateJson(honestTerminalJson))
) {
  throw new Error("Same-output fraud vector failed its structural assertions.");
}
const fraudulentClaimedOutput = honestTerminalJson.registers[0];
if (fraudulentClaimedOutput === undefined) throw new Error("Missing fraud vector output.");

const vector = {
  schema: "bisect.claim-registry-v1",
  source: "TypeScript @bisect/vm + @bisect/merkle",
  program,
  publicInputAbiEncoded: artifact.publicInputAbiEncoded,
  transitionCount,
  traceRoot: artifact.traceRoot,
  claimedOutput: "42",
  contextHash: artifact.executionContextHash,
  initial: {
    stateAbiEncoded: initial.stateAbiEncoded,
    leafHash: initial.leafHash,
    siblingsBottomUp: initial.siblingsBottomUp,
  },
  terminal: {
    stateAbiEncoded: terminal.stateAbiEncoded,
    leafHash: terminal.leafHash,
    siblingsBottomUp: terminal.siblingsBottomUp,
  },
  sameOutputFraud: {
    program: sameOutputProgram,
    publicInputAbiEncoded: sameOutputArtifact.publicInputAbiEncoded,
    transitionCount,
    traceRoot: fraudulentRoot,
    honestTraceRoot: sameOutputArtifact.traceRoot,
    claimedOutput: fraudulentClaimedOutput,
    invalidTransitionIndex: 0,
    divergentStateIndex: 1,
    initial: {
      stateAbiEncoded: serializeStateAbi(fraudulentInitial),
      siblingsBottomUp: createMerkleProof(
        sameOutputArtifact.executionContextHash,
        fraudulentTrace,
        0,
      ),
    },
    intermediate: {
      stateAbiEncoded: serializeStateAbi(fraudulentIntermediate),
      siblingsBottomUp: createMerkleProof(
        sameOutputArtifact.executionContextHash,
        fraudulentTrace,
        1,
      ),
    },
    terminal: {
      stateAbiEncoded: serializeStateAbi(fraudulentTerminal),
      siblingsBottomUp: createMerkleProof(
        sameOutputArtifact.executionContextHash,
        fraudulentTrace,
        transitionCount,
      ),
    },
  },
};

await mkdir(new URL("../contracts/test/vectors/", import.meta.url), { recursive: true });
await writeFile(
  new URL("../contracts/test/vectors/claim-registry-v1.json", import.meta.url),
  `${JSON.stringify(vector, null, 2)}\n`,
  "utf8",
);
