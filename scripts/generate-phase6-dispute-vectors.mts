import { mkdir, writeFile } from "node:fs/promises";
import { createTraceCommitment } from "../packages/merkle/dist/index.js";
import {
  computeLeafHash,
  computeNodeHash,
  computeTraceRoot,
  createMerkleProof,
  createState,
  parseStateJson,
  serializeStateAbi,
} from "../packages/vm/dist/index.js";

const program = "0x010000050100002a09000000";
const publicInput = ["0", "0", "0", "0", "0", "0", "0", "0"] as const;
const transitionCount = 63;
const honestArtifact = createTraceCommitment(program, publicInput, transitionCount);
const honestStates = honestArtifact.states.map(parseStateJson);
const fraudulentStates = [...honestStates];
const canonicalState1 = fraudulentStates[1];
if (canonicalState1 === undefined) throw new Error("VM trace is missing state 1.");
fraudulentStates[1] = createState(canonicalState1.pc, canonicalState1.halted, [
  9n,
  ...canonicalState1.registers.slice(1),
]);
const fraudulentRoot = computeTraceRoot(honestArtifact.executionContextHash, fraudulentStates);
if (fraudulentRoot === honestArtifact.traceRoot) {
  throw new Error("Fraudulent intermediate state did not change the trace root.");
}

function levelsFor(states: typeof honestStates) {
  let level = states.map((state, index) =>
    computeLeafHash(honestArtifact.executionContextHash, index, state),
  );
  const levels = [level];
  while (level.length > 1) {
    const next = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index];
      const right = level[index + 1];
      if (left === undefined || right === undefined) throw new Error("Incomplete Merkle level.");
      next.push(computeNodeHash(left, right));
    }
    levels.push(next);
    level = next;
  }
  return levels;
}

function stateProof(states: typeof honestStates, index: number) {
  const state = states[index];
  if (state === undefined) throw new Error(`Missing state ${index}.`);
  return {
    stateAbiEncoded: serializeStateAbi(state),
    siblingsBottomUp: createMerkleProof(honestArtifact.executionContextHash, states, index),
  };
}

function transitionProof(states: typeof honestStates, root: string, predecessorIndex = 0) {
  const predecessor = states[predecessorIndex];
  const successor = states[predecessorIndex + 1];
  if (predecessor === undefined || successor === undefined) {
    throw new Error(`Missing adjacent states at index ${predecessorIndex}.`);
  }
  return {
    program,
    publicInputAbiEncoded: honestArtifact.publicInputAbiEncoded,
    transitionCount,
    traceRoot: root,
    stateIndex: predecessorIndex,
    predecessor: stateProof(states, predecessorIndex),
    claimedSuccessor: stateProof(states, predecessorIndex + 1),
  };
}

function bisectionRounds(proverStates: typeof honestStates, challengerStates: typeof honestStates) {
  const proverLevels = levelsFor(proverStates);
  const challengerLevels = levelsFor(challengerStates);
  let baseIndex = 0;
  let height = Math.log2(proverStates.length);
  const result = [];
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
      throw new Error("Trace tree is missing a bisection child.");
    }
    result.push({
      baseIndex,
      height,
      proverChildren: [proverLeft, proverRight],
      challengerChildren: [challengerLeft, challengerRight],
    });
    if (proverLeft !== challengerLeft) {
      // Locked v1 always selects the differing left subtree first.
    } else if (proverRight !== challengerRight) {
      baseIndex += 2 ** childLevel;
    } else {
      throw new Error("The supplied traces have no differing child at a differing parent.");
    }
    height -= 1;
  }
  return { expectedDifferentIndex: baseIndex, rounds: result };
}

const honestLevels = levelsFor(honestStates);
const fraudulentLevels = levelsFor(fraudulentStates);
const rounds = [];
let baseIndex = 0;
let height = Math.log2(transitionCount + 1);
while (height > 0) {
  const childLevel = height - 1;
  const childPosition = baseIndex >> childLevel;
  const honestLeft = honestLevels[childLevel]?.[childPosition];
  const honestRight = honestLevels[childLevel]?.[childPosition + 1];
  const fraudulentLeft = fraudulentLevels[childLevel]?.[childPosition];
  const fraudulentRight = fraudulentLevels[childLevel]?.[childPosition + 1];
  if (
    honestLeft === undefined ||
    honestRight === undefined ||
    fraudulentLeft === undefined ||
    fraudulentRight === undefined
  ) {
    throw new Error("Trace tree is missing a bisection child.");
  }
  rounds.push({
    baseIndex,
    height,
    proverChildren: [fraudulentLeft, fraudulentRight],
    challengerChildren: [honestLeft, honestRight],
  });
  if (fraudulentLeft !== honestLeft) {
    // V1 always selects the left subtree when its child commitments differ.
  } else {
    baseIndex += 2 ** childLevel;
  }
  height -= 1;
}
if (baseIndex !== 1)
  throw new Error(`Expected leftmost disagreement at state 1, got ${baseIndex}.`);

const differentOutputStates = [...honestStates];
const honestFinalState = differentOutputStates[transitionCount];
if (honestFinalState === undefined || !honestFinalState.halted) {
  throw new Error("Canonical halted final state is missing.");
}
differentOutputStates[transitionCount] = createState(honestFinalState.pc, true, [
  43n,
  ...honestFinalState.registers.slice(1),
]);
const differentOutputRoot = computeTraceRoot(
  honestArtifact.executionContextHash,
  differentOutputStates,
);
const differentOutputDispute = bisectionRounds(honestStates, differentOutputStates);
if (differentOutputDispute.expectedDifferentIndex !== transitionCount) {
  throw new Error(
    `Expected different-output trace to diverge at ${transitionCount}, got ${differentOutputDispute.expectedDifferentIndex}.`,
  );
}

const vector = {
  schema: "bisect.dispute-v1",
  source: "TypeScript @bisect/vm and @bisect/merkle-compatible ordered hashing",
  program,
  publicInputAbiEncoded: honestArtifact.publicInputAbiEncoded,
  transitionCount,
  claimedOutput: "42",
  executionContextHash: honestArtifact.executionContextHash,
  prover: {
    traceRoot: fraudulentRoot,
    initial: stateProof(fraudulentStates, 0),
    terminal: stateProof(fraudulentStates, transitionCount),
    terminalTransition: transitionProof(fraudulentStates, fraudulentRoot),
    lastTransition: transitionProof(honestStates, honestArtifact.traceRoot, transitionCount - 1),
  },
  challenger: {
    traceRoot: honestArtifact.traceRoot,
    initial: stateProof(honestStates, 0),
    terminal: stateProof(honestStates, transitionCount),
    terminalTransition: transitionProof(honestStates, honestArtifact.traceRoot),
  },
  expectedDifferentIndex: 1,
  rounds,
  differentOutput: {
    traceRoot: differentOutputRoot,
    claimedOutput: "43",
    initial: stateProof(differentOutputStates, 0),
    terminal: stateProof(differentOutputStates, transitionCount),
    terminalTransition: transitionProof(
      differentOutputStates,
      differentOutputRoot,
      transitionCount - 1,
    ),
    expectedDifferentIndex: differentOutputDispute.expectedDifferentIndex,
    rounds: differentOutputDispute.rounds,
  },
};

const target = new URL("../contracts/test/vectors/dispute-v1.json", import.meta.url);
await mkdir(new URL("../contracts/test/vectors/", import.meta.url), { recursive: true });
await writeFile(target, `${JSON.stringify(vector, null, 2)}\n`, "utf8");
