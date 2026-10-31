import { mkdir, writeFile } from "node:fs/promises";
import {
  computeLeafHash,
  computeStateHash,
  computeTraceRoot,
  createMerkleProof,
  encodePublicInputAbi,
  createState as makeState,
  parseProgram,
  type State,
  serializeStateAbi,
  traceProgram,
} from "../packages/vm/dist/index.js";

interface VectorDefinition {
  readonly name: string;
  readonly program: string;
  readonly input: readonly string[];
  readonly budget?: number;
  readonly index?: number;
}

const HALT = "09000000";
const NOP = "00000000";
const cases: VectorDefinition[] = [
  { name: "nop", program: `0x${NOP}${HALT}`, input: zeros(), index: 0 },
  { name: "movi", program: "0x01001234" + HALT, input: zeros(), index: 0 },
  {
    name: "mov",
    program: "0x02000100" + HALT,
    input: ["0", "18446744073709551615", "0", "0", "0", "0", "0", "0"],
    index: 0,
  },
  {
    name: "add-wraparound",
    program: "0x03000102" + HALT,
    input: ["0", "18446744073709551615", "1", "0", "0", "0", "0", "0"],
    index: 0,
  },
  {
    name: "sub-underflow",
    program: "0x04000102" + HALT,
    input: ["0", "0", "1", "0", "0", "0", "0", "0"],
    index: 0,
  },
  {
    name: "mul-wraparound",
    program: "0x05000102" + HALT,
    input: ["0", "18446744073709551615", "2", "0", "0", "0", "0", "0"],
    index: 0,
  },
  {
    name: "xor",
    program: "0x06000102" + HALT,
    input: ["0", "170", "15", "0", "0", "0", "0", "0"],
    index: 0,
  },
  {
    name: "and",
    program: "0x07000102" + HALT,
    input: ["0", "170", "15", "0", "0", "0", "0", "0"],
    index: 0,
  },
  {
    name: "jnz-taken",
    program: "0x0800000201070001" + HALT,
    input: ["1", "0", "0", "0", "0", "0", "0", "0"],
    index: 0,
  },
  {
    name: "jnz-not-taken",
    program: "0x0800000209000000" + HALT,
    input: zeros(),
    index: 0,
  },
  { name: "halt-enter", program: `0x${HALT}`, input: zeros(), index: 0 },
  { name: "halt-stutter", program: `0x${HALT}`, input: zeros(), index: 1 },
  ...([63, 255, 1023, 4095] as const).map((budget) => ({
    name: `budget-${budget}`,
    program: `0x${HALT}`,
    input: zeros(),
    budget,
    index: budget - 1,
  })),
  {
    name: "maximum-program-and-proof-depth",
    program: `0x${NOP.repeat(127)}${HALT}`,
    input: zeros(),
    budget: 4095,
    index: 127,
  },
];

function zeros(): readonly string[] {
  return ["0", "0", "0", "0", "0", "0", "0", "0"];
}

function hashVector(
  name: string,
  program: string,
  input: readonly string[],
  budget: number,
  index: number,
  trace: readonly State[],
  traceRoot: `0x${string}`,
  hashes: {
    readonly programHash: `0x${string}`;
    readonly inputHash: `0x${string}`;
    readonly executionContextHash: `0x${string}`;
  },
) {
  const predecessor = trace[index];
  const successor = trace[index + 1];
  if (predecessor === undefined || successor === undefined) {
    throw new Error(`${name} has no adjacent state pair at index ${index}.`);
  }
  const siblings = (stateIndex: number) =>
    createMerkleProof(hashes.executionContextHash, trace, stateIndex);
  return {
    name,
    program,
    publicInputAbiEncoded: encodePublicInputAbi(input),
    transitionCount: budget,
    stateIndex: index,
    programHash: hashes.programHash,
    inputHash: hashes.inputHash,
    executionContextHash: hashes.executionContextHash,
    traceRoot,
    predecessor: {
      abiEncoded: serializeStateAbi(predecessor),
      stateHash: computeStateHash(predecessor),
      leafHash: computeLeafHash(hashes.executionContextHash, index, predecessor),
      siblingsBottomUp: siblings(index),
    },
    successor: {
      abiEncoded: serializeStateAbi(successor),
      stateHash: computeStateHash(successor),
      leafHash: computeLeafHash(hashes.executionContextHash, index + 1, successor),
      siblingsBottomUp: siblings(index + 1),
    },
  };
}

function makeVector(definition: VectorDefinition) {
  const budget = definition.budget ?? 63;
  const index = definition.index ?? 0;
  const program = parseProgram(definition.program);
  const trace = traceProgram(program, definition.input, budget);
  return {
    ...hashVector(
      definition.name,
      definition.program,
      definition.input,
      budget,
      index,
      trace.trace,
      trace.traceRoot,
      trace,
    ),
    publicInput: definition.input,
    leafCount: budget + 1,
  };
}

function makeAdversarialVector(
  name: string,
  alter: (trace: readonly State[]) => State[],
  index = 0,
) {
  const definition = { name, program: `0x${NOP}${HALT}`, input: zeros() };
  const program = parseProgram(definition.program);
  const execution = traceProgram(program, definition.input, 63);
  const states = alter(execution.trace);
  const root = computeTraceRoot(execution.executionContextHash, states);
  return {
    ...hashVector(name, definition.program, definition.input, 63, index, states, root, execution),
    publicInput: definition.input,
    leafCount: states.length,
  };
}

const validVectors = cases.map(makeVector);
const wrongSuccessorVector = makeAdversarialVector("authenticated-wrong-successor", (trace) => {
  const states = [...trace];
  const honestSuccessor = states[1];
  if (honestSuccessor === undefined) throw new Error("Missing successor fixture state.");
  const registers = [...honestSuccessor.registers];
  registers[0] = 1n;
  states[1] = makeState(honestSuccessor.pc, honestSuccessor.halted, registers);
  return states;
});
const invalidPcVector = makeAdversarialVector(
  "authenticated-invalid-prestate-pc",
  (trace) => {
    const states = [...trace];
    const second = states[1];
    if (second === undefined) throw new Error("Missing adversarial fixture state.");
    states[1] = makeState(2, false, second.registers);
    return states;
  },
  1,
);

const errorCodes: Readonly<Record<string, number>> = {
  PROGRAM_EMPTY: 1,
  PROGRAM_TOO_LONG: 2,
  PROGRAM_LENGTH_NOT_MULTIPLE_OF_4: 3,
  UNKNOWN_OPCODE: 4,
  NONZERO_RESERVED_OPERAND: 5,
  REGISTER_OUT_OF_RANGE: 6,
  FALLTHROUGH_OUT_OF_RANGE: 7,
  JUMP_TARGET_OUT_OF_RANGE: 8,
};

const malformedProgramVectors = [
  { name: "empty", program: "0x", expectedError: "PROGRAM_EMPTY" },
  {
    name: "too-long",
    program: `0x${"00".repeat(513)}`,
    expectedError: "PROGRAM_TOO_LONG",
  },
  {
    name: "instruction-width",
    program: "0x010203",
    expectedError: "PROGRAM_LENGTH_NOT_MULTIPLE_OF_4",
  },
  { name: "unknown-opcode", program: "0xff00000009000000", expectedError: "UNKNOWN_OPCODE" },
  {
    name: "invalid-register",
    program: "0x0108000009000000",
    expectedError: "REGISTER_OUT_OF_RANGE",
  },
  {
    name: "reserved-operand",
    program: "0x0001000009000000",
    expectedError: "NONZERO_RESERVED_OPERAND",
  },
  { name: "fallthrough", program: "0x00000000", expectedError: "FALLTHROUGH_OUT_OF_RANGE" },
  { name: "jump-target", program: "0x0800ffff09000000", expectedError: "JUMP_TARGET_OUT_OF_RANGE" },
].map((vector) => {
  try {
    parseProgram(vector.program);
    throw new Error(`Expected ${vector.name} program to be rejected.`);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== vector.expectedError) throw error;
    return {
      ...vector,
      expectedErrorCode: errorCodes[vector.expectedError],
      rejectedByTypeScript: true,
    };
  }
});

const vectors = {
  schema: "bisect.solidity-verifier-v1",
  generatedBy: "packages/vm v1 + packages/merkle v1",
  hash: "Ethereum Keccak-256 / Solidity abi.encode",
  vectors: validVectors,
  adversarial: [wrongSuccessorVector, invalidPcVector],
  malformedPrograms: malformedProgramVectors,
};

const outputPath = new URL("../contracts/test/vectors/verifier-v1.json", import.meta.url);
async function main(): Promise<void> {
  await mkdir(new URL("../contracts/test/vectors/", import.meta.url), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(vectors, null, 2)}\n`, "utf8");
  process.stdout.write(`Wrote ${outputPath.pathname}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
