export const VM_VERSION = 1 as const;
export const PROTOCOL_VERSION = 1 as const;
export const ENCODING_VERSION = 1 as const;
export const REGISTER_COUNT = 8 as const;
export const INSTRUCTION_SIZE = 4 as const;
export const MAX_INSTRUCTIONS = 128 as const;
export const UINT64_MODULUS = 1n << 64n;
export const UINT64_MAX = UINT64_MODULUS - 1n;
export const APPROVED_BUDGETS = [63, 255, 1023, 4095] as const;

export type ExecutionBudget = (typeof APPROVED_BUDGETS)[number];
export type Registers = readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];

export interface State {
  readonly pc: number;
  readonly halted: boolean;
  readonly registers: Registers;
}

export interface Instruction {
  readonly index: number;
  readonly opcode: Opcode;
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly bytes: readonly [number, number, number, number];
}

export enum Opcode {
  NOP = 0x00,
  MOVI = 0x01,
  MOV = 0x02,
  ADD = 0x03,
  SUB = 0x04,
  MUL = 0x05,
  XOR = 0x06,
  AND = 0x07,
  JNZ = 0x08,
  HALT = 0x09,
}

export interface Program {
  readonly bytes: Uint8Array;
  readonly instructions: readonly Instruction[];
}

export interface ExecutionSummary {
  readonly protocolVersion: 1;
  readonly vmVersion: 1;
  readonly encodingVersion: 1;
  readonly programHex: string;
  readonly publicInput: readonly string[];
  readonly transitionCount: ExecutionBudget;
  readonly leafCount: number;
  readonly haltIndex: number;
  readonly output: string;
  readonly programHash: `0x${string}`;
  readonly inputHash: `0x${string}`;
  readonly executionContextHash: `0x${string}`;
  readonly traceRoot: `0x${string}`;
  readonly finalState: SerializedState;
}

export interface SerializedState {
  readonly pc: number;
  readonly halted: boolean;
  readonly registers: readonly string[];
}

export interface ExecutionResult {
  readonly summary: ExecutionSummary;
  readonly trace: readonly State[];
}

export interface ExampleProgram {
  readonly name: string;
  readonly description: string;
  readonly program: Program;
  readonly publicInput: Registers;
  readonly recommendedBudget: ExecutionBudget;
  readonly maxInput?: bigint;
}
