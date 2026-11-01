import { generateTraceCommitment } from "@bisect/sdk";
import {
  computeLeafHash,
  computeNodeHash,
  createExample,
  createState,
  parseStateJson,
  UINT64_MODULUS,
} from "@bisect/vm";
import type { Hex } from "viem";
import type { Replay, ReplayRound } from "./dispute-replay";

/** Real v1 VM and Keccak commitments, with one explicitly simulated dishonest state. */
export function createEducationalDemoReplay(): Replay {
  const example = createExample("addition");
  const trace = generateTraceCommitment({
    program: example.program,
    publicInput: example.publicInput,
    transitionCount: 1023,
  });
  const validStates = trace.states.map(parseStateJson);
  const alteredStates = validStates.slice();
  const target = 700;
  const original = validStates[target];
  if (!original) throw new Error("The measured 1,023-transition trace is incomplete.");
  const registers = [...original.registers];
  registers[7] = ((registers[7] ?? 0n) + 1n) % UINT64_MODULUS;
  alteredStates[target] = createState(original.pc, original.halted, registers);
  function levels(states: typeof validStates): Hex[][] {
    const result: Hex[][] = [
      states.map((state, index) => computeLeafHash(trace.executionContextHash, index, state)),
    ];
    while ((result.at(-1)?.length ?? 0) > 1) {
      const previous = result.at(-1) as Hex[];
      const next: Hex[] = [];
      for (let index = 0; index < previous.length; index += 2)
        next.push(computeNodeHash(previous[index] as Hex, previous[index + 1] as Hex));
      result.push(next);
    }
    return result;
  }
  const proverLevels = levels(alteredStates);
  const challengerLevels = levels(validStates);
  const proverRoot = proverLevels[10]?.[0];
  const challengerRoot = challengerLevels[10]?.[0];
  if (!proverRoot || !challengerRoot || proverRoot === challengerRoot)
    throw new Error("The educational commitments did not disagree.");
  const rounds: ReplayRound[] = [];
  let low = 0;
  let height = 10;
  while (height > 0) {
    const divisor = 2 ** (height - 1);
    const position = low / divisor;
    const p = proverLevels[height - 1];
    const c = challengerLevels[height - 1];
    const proverChildren: [Hex, Hex] = [p?.[position] as Hex, p?.[position + 1] as Hex];
    const challengerChildren: [Hex, Hex] = [c?.[position] as Hex, c?.[position + 1] as Hex];
    if (
      !proverChildren[0] ||
      !proverChildren[1] ||
      !challengerChildren[0] ||
      !challengerChildren[1]
    )
      throw new Error("The simulated subtree is incomplete.");
    const leftDiffers = proverChildren[0] !== challengerChildren[0];
    const retained = leftDiffers ? "left" : "right";
    const midpoint = low + divisor;
    rounds.push({
      round: rounds.length + 1,
      low,
      high: low + 2 ** height - 1,
      midpoint,
      retained,
      remaining: divisor,
      proverParent: computeNodeHash(...proverChildren),
      challengerParent: computeNodeHash(...challengerChildren),
      proverChildren,
      challengerChildren,
      transactionHashes: null,
      blockNumber: null,
    });
    if (!leftDiffers) low = midpoint;
    height--;
  }
  if (low !== target || rounds.length !== 10)
    throw new Error("The measured educational bisection failed.");
  return {
    chainId: null,
    contractAddress: null,
    claimId: null,
    gameNumber: null,
    rounds,
    complete: false,
    issue:
      "Educational simulation: one altered intermediate state at index 700; no chain settlement occurred.",
    finalIndex: target,
    winner: null,
    creditedWei: null,
    bondWei: null,
    proverBondStatus: null,
    challengerBondStatus: null,
    transitionCount: 1023,
    proverRoot,
    challengerRoot,
    lagBlocks: null,
  };
}
