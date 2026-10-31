import { mkdir, writeFile } from "node:fs/promises";
import { createStateProof, createTraceCommitment } from "../packages/merkle/dist/index.js";

const smallProgram = "0x010100050300000109000000";
const smallInput = ["7", "0", "0", "0", "0", "0", "0", "0"];
const smallTrace = createTraceCommitment(smallProgram, smallInput, 63);
const sampledProofs = [0, 32, 63].map((index) => {
  const proof = createStateProof(smallTrace, index);
  return {
    index,
    state: proof.state,
    stateAbiEncoded: proof.stateAbiEncoded,
    stateHash: proof.stateHash,
    leafHash: proof.leafHash,
    siblingsBottomUp: proof.siblingsBottomUp,
    verifies: true,
  };
});

const maxProgram = "0x09000000";
const maxInput = ["0", "0", "0", "0", "0", "0", "0", "0"];
const maxTrace = createTraceCommitment(maxProgram, maxInput, 4095);
const maxProof = createStateProof(maxTrace, 4095);

const vectors = {
  specification: {
    protocolVersion: 1,
    vmVersion: 1,
    encodingVersion: 1,
    hash: "Ethereum Keccak-256",
    abi: "Solidity standard abi.encode",
    tree: "ordered binary; left/right position-sensitive; no padding",
    proofOrder: "bottom-up; sibling at level zero first",
  },
  standardBudget: {
    programHex: smallTrace.programHex,
    publicInput: smallTrace.publicInput,
    publicInputAbiEncoded: smallTrace.publicInputAbiEncoded,
    transitionCount: smallTrace.transitionCount,
    leafCount: smallTrace.leafCount,
    programHash: smallTrace.programHash,
    inputHash: smallTrace.inputHash,
    executionContextHash: smallTrace.executionContextHash,
    traceRoot: smallTrace.traceRoot,
    sampledProofs,
  },
  maximumBudget: {
    programHex: maxTrace.programHex,
    publicInput: maxTrace.publicInput,
    publicInputAbiEncoded: maxTrace.publicInputAbiEncoded,
    transitionCount: maxTrace.transitionCount,
    leafCount: maxTrace.leafCount,
    programHash: maxTrace.programHash,
    inputHash: maxTrace.inputHash,
    executionContextHash: maxTrace.executionContextHash,
    traceRoot: maxTrace.traceRoot,
    finalState: maxProof.state,
    finalStateAbiEncoded: maxProof.stateAbiEncoded,
    finalStateHash: maxProof.stateHash,
    finalLeafHash: maxProof.leafHash,
    finalSiblingsBottomUp: maxProof.siblingsBottomUp,
    verifies: true,
  },
  verificationExpectations: {
    originalProof: true,
    modifiedState: false,
    modifiedSibling: false,
    reversedSiblingOrder: false,
    wrongStateIndex: false,
    wrongProgram: false,
    wrongPublicInput: false,
    wrongTraceLength: false,
    wrongRoot: false,
    truncatedSiblingPath: false,
  },
};

const outputPath = new URL("../packages/merkle/fixtures/merkle-v1-vectors.json", import.meta.url);
async function main(): Promise<void> {
  await mkdir(new URL("../packages/merkle/fixtures/", import.meta.url), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(vectors, null, 2)}\n`, "utf8");
  process.stdout.write(`Wrote ${outputPath.pathname}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
