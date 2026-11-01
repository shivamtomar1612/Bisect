import { assemble } from "./assembler.js";
import { parsePublicInput } from "./state.js";
import { APPROVED_BUDGETS, type ExampleProgram } from "./types.js";

const exampleSources: Readonly<
  Record<
    string,
    { description: string; source: string; input: readonly string[]; maxInput?: bigint }
  >
> = Object.freeze({
  increment: {
    description: "Adds one to R0 using R1 as the increment value.",
    source: "ADD R0, R0, R1\nHALT\n",
    input: ["41", "1", "0", "0", "0", "0", "0", "0"],
  },
  addition: {
    description: "Adds input registers R0 and R1 into R0 with uint64 wrapping.",
    source: "ADD R0, R0, R1\nHALT\n",
    input: ["7", "5", "0", "0", "0", "0", "0", "0"],
  },
  multiplication: {
    description: "Multiplies input registers R0 and R1 into R0 with uint64 wrapping.",
    source: "MUL R0, R0, R1\nHALT\n",
    input: ["7", "6", "0", "0", "0", "0", "0", "0"],
  },
  sum: {
    description: "Computes 1 + ... + n in R0; requires n <= 14 with budget 63.",
    source:
      "MOV R3, R0\nMOVI R0, 0\nMOVI R2, 1\nMOV R4, R2\nJNZ R3, loop\nHALT\nloop:\nADD R0, R0, R4\nADD R4, R4, R2\nSUB R3, R3, R2\nJNZ R3, loop\nHALT\n",
    input: ["5", "0", "0", "0", "0", "0", "0", "0"],
    maxInput: 14n,
  },
  fibonacci: {
    description: "Computes F(n) iteratively in R0; requires n <= 11 with budget 63.",
    source:
      "MOV R2, R0\nMOVI R0, 0\nMOVI R1, 1\nMOVI R3, 1\nJNZ R2, loop\nHALT\nloop:\nADD R4, R0, R1\nMOV R0, R1\nMOV R1, R4\nSUB R2, R2, R3\nJNZ R2, loop\nHALT\n",
    input: ["7", "0", "0", "0", "0", "0", "0", "0"],
    maxInput: 11n,
  },
  factorial: {
    description: "Computes n! modulo 2^64 in R0; requires n <= 19 with budget 63.",
    source:
      "MOV R3, R0\nMOVI R0, 1\nMOVI R2, 1\nJNZ R3, loop\nHALT\nloop:\nMUL R0, R0, R3\nSUB R3, R3, R2\nJNZ R3, loop\nHALT\n",
    input: ["5", "0", "0", "0", "0", "0", "0", "0"],
    maxInput: 19n,
  },
  branching: {
    description: "Takes one of two deterministic branches and records which path ran in R1.",
    source: "JNZ R0, nonzero\nMOVI R1, 0\nHALT\nnonzero:\nMOVI R1, 1\nHALT\n",
    input: ["1", "0", "0", "0", "0", "0", "0", "0"],
  },
  "halt-stutter": {
    description: "Writes R1, halts, then preserves the exact halted state for the remaining trace.",
    source: "MOVI R1, 7\nHALT\n",
    input: ["0", "0", "0", "0", "0", "0", "0", "0"],
  },
  nonterminating: {
    description: "A valid infinite self-loop when R0 is nonzero; default input is 1.",
    source: "JNZ R0, loop\nHALT\nloop:\nJNZ R0, loop\nHALT\n",
    input: ["1", "0", "0", "0", "0", "0", "0", "0"],
  },
});

export function listExamples(): readonly string[] {
  return Object.freeze([...Object.keys(exampleSources), "invalid-opcode", "malformed-operands"]);
}

export function createExample(name: string): ExampleProgram {
  const definition = exampleSources[name];
  if (definition === undefined)
    throw new RangeError(`Unknown example ${name}. Available: ${listExamples().join(", ")}`);
  const example: ExampleProgram = {
    name,
    description: definition.description,
    program: assemble(definition.source),
    publicInput: parsePublicInput(definition.input),
    recommendedBudget: APPROVED_BUDGETS[0],
    ...(definition.maxInput === undefined ? {} : { maxInput: definition.maxInput }),
  };
  return Object.freeze(example);
}

export function getExampleSource(name: string): string {
  const definition = exampleSources[name];
  if (definition === undefined)
    throw new RangeError(`Example does not have executable source: ${name}`);
  return definition.source;
}

export const INVALID_EXAMPLES = Object.freeze({
  "invalid-opcode": "0xff000000",
  "malformed-operands": "0x00010000",
});
