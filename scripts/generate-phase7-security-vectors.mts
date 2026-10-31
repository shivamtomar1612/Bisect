import { mkdir, writeFile } from "node:fs/promises";
import { createTraceCommitment } from "../packages/merkle/dist/index.js";
import {
  computeLeafHash,
  computeNodeHash,
  computeTraceRoot,
  createMerkleProof,
  createState,
  parseStateJson,
  type State,
  serializeStateAbi,
} from "../packages/vm/dist/index.js";

const program = "0x010000050100002a09000000";
const publicInput = ["0", "0", "0", "0", "0", "0", "0", "0"] as const;
const transitionCount = 63;
const canonical = createTraceCommitment(program, publicInput, transitionCount);
const canonicalTrace = canonical.states.map(parseStateJson);
const mismatchIndices = [1, 2, 3, 7, 8, 15, 16, 31, 32, 47, 62, 63] as const;

function treeLevels(contextHash: `0x${string}`, states: readonly State[]) {
  let level = states.map((state, index) => computeLeafHash(contextHash, index, state));
  const levels = [level];
  while (level.length > 1) {
    const next: `0x${string}`[] = [];
    for (let position = 0; position < level.length; position += 2) {
      const left = level[position];
      const right = level[position + 1];
      if (left === undefined || right === undefined) {
        throw new Error("Incomplete ordered Merkle pair.");
      }
      next.push(computeNodeHash(left, right));
    }
    levels.push(next);
    level = next;
  }
  return levels;
}

function stateProof(states: readonly State[], index: number) {
  const state = states[index];
  if (state === undefined) throw new Error(`Missing trace state ${index}.`);
  return {
    stateAbiEncoded: serializeStateAbi(state),
    siblingsBottomUp: createMerkleProof(canonical.executionContextHash, states, index),
  };
}

function transitionProof(states: readonly State[], root: `0x${string}`, index: number) {
  if (index < 0 || index >= transitionCount) {
    throw new Error(`Invalid predecessor index ${index}.`);
  }
  return {
    program,
    publicInputAbiEncoded: canonical.publicInputAbiEncoded,
    transitionCount,
    traceRoot: root,
    stateIndex: index,
    predecessor: stateProof(states, index),
    claimedSuccessor: stateProof(states, index + 1),
  };
}

function makeRounds(prover: readonly State[], challenger: readonly State[]) {
  const proverLevels = treeLevels(canonical.executionContextHash, prover);
  const challengerLevels = treeLevels(canonical.executionContextHash, challenger);
  const rounds = [];
  let baseIndex = 0;
  let height = Math.log2(prover.length);
  while (height > 0) {
    const childLevel = height - 1;
    const childPosition = baseIndex >> childLevel;
    const proverLeft = proverLevels[childLevel]?.[childPosition];
    const proverRight = proverLevels[childLevel]?.[childPosition + 1];
    const challengerLeft = challengerLevels[childLevel]?.[childPosition];
    const challengerRight = challengerLevels[childLevel]?.[childPosition + 1];
    if (
      proverLeft === undefined ||
      proverRight === undefined ||
      challengerLeft === undefined ||
      challengerRight === undefined
    ) {
      throw new Error("Missing child subtree commitment.");
    }
    rounds.push({
      proverChildren: [proverLeft, proverRight],
      challengerChildren: [challengerLeft, challengerRight],
    });
    if (proverLeft !== challengerLeft) {
      // Locked v1 selects the differing left child first.
    } else if (proverRight !== challengerRight) {
      baseIndex += 2 ** childLevel;
    } else {
      throw new Error("Differing parent hashes did not yield a differing child pair.");
    }
    height -= 1;
  }
  return { rounds, selectedIndex: baseIndex };
}

const intervalCases = mismatchIndices.map((index) => {
  const challengerTrace = [...canonicalTrace];
  const prior = challengerTrace[index];
  if (prior === undefined) throw new Error(`Missing state ${index}.`);
  challengerTrace[index] = createState(prior.pc, prior.halted, [
    ...prior.registers.slice(0, 7),
    BigInt(10_000 + index),
  ]);
  const challengerRoot = computeTraceRoot(canonical.executionContextHash, challengerTrace);
  const bisection = makeRounds(canonicalTrace, challengerTrace);
  if (bisection.selectedIndex !== index) {
    throw new Error(`Index ${index} selected as ${bisection.selectedIndex}.`);
  }
  return {
    expectedDifferentIndex: index,
    challengerRoot,
    initial: stateProof(challengerTrace, 0),
    challengerTerminalState: stateProof(challengerTrace, transitionCount),
    rounds: bisection.rounds,
    challengerTerminal: transitionProof(challengerTrace, challengerRoot, index - 1),
    proverTerminal: transitionProof(canonicalTrace, canonical.traceRoot, index - 1),
  };
});

const vectors = {
  schema: "bisect.phase7-security-v1",
  source: "TypeScript VM v1 and ordered Merkle package",
  program,
  publicInputAbiEncoded: canonical.publicInputAbiEncoded,
  transitionCount,
  canonicalTraceRoot: canonical.traceRoot,
  canonicalInitial: stateProof(canonicalTrace, 0),
  canonicalTerminal: stateProof(canonicalTrace, transitionCount),
  mismatchIndices,
  intervalCases,
};

const outputPath = new URL("../contracts/test/vectors/security-v1.json", import.meta.url);
await mkdir(new URL("../contracts/test/vectors/", import.meta.url), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(vectors, null, 2)}\n`, "utf8");
