import { mkdir, writeFile } from "node:fs/promises";
import { createStateProof, createTraceCommitment } from "../packages/merkle/dist/index.js";

const program = "0x0100002a09000000";
const publicInput = ["0", "0", "0", "0", "0", "0", "0", "0"] as const;
const transitionCount = 63;
const artifact = createTraceCommitment(program, publicInput, transitionCount);
const initial = createStateProof(artifact, 0);
const terminal = createStateProof(artifact, transitionCount);

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
};

await mkdir(new URL("../contracts/test/vectors/", import.meta.url), { recursive: true });
await writeFile(
  new URL("../contracts/test/vectors/claim-registry-v1.json", import.meta.url),
  `${JSON.stringify(vector, null, 2)}\n`,
  "utf8",
);
