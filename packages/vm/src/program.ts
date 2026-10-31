import { VmError } from "./errors.js";
import {
  INSTRUCTION_SIZE,
  type Instruction,
  MAX_INSTRUCTIONS,
  Opcode,
  type Program,
} from "./types.js";

const OPCODE_NAMES = new Set<number>([
  Opcode.NOP,
  Opcode.MOVI,
  Opcode.MOV,
  Opcode.ADD,
  Opcode.SUB,
  Opcode.MUL,
  Opcode.XOR,
  Opcode.AND,
  Opcode.JNZ,
  Opcode.HALT,
]);

export function parseProgram(source: Uint8Array | string): Program {
  let bytes: Uint8Array;
  if (typeof source === "string") {
    const raw = source.startsWith("0x") ? source.slice(2) : source;
    if (raw.length > MAX_INSTRUCTIONS * INSTRUCTION_SIZE * 2) {
      throw new VmError("PROGRAM_TOO_LONG", `Program exceeds ${MAX_INSTRUCTIONS} instructions.`);
    }
    if (raw.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(raw)) {
      throw new VmError("INVALID_HEX", "Program must be an even-length hexadecimal string.");
    }
    bytes = Uint8Array.from(raw.match(/.{2}/g)?.map((pair) => Number.parseInt(pair, 16)) ?? []);
  } else {
    bytes = new Uint8Array(source);
  }
  validateProgramBytes(bytes);
  const canonicalBytes = new Uint8Array(bytes);
  const instructions = Object.freeze(decodeInstructions(canonicalBytes));
  return Object.freeze({
    get bytes(): Uint8Array {
      return new Uint8Array(canonicalBytes);
    },
    instructions,
  });
}

export function validateProgramBytes(bytes: Uint8Array): void {
  if (bytes.length === 0)
    throw new VmError("PROGRAM_EMPTY", "Program must contain at least one instruction.");
  if (bytes.length > MAX_INSTRUCTIONS * INSTRUCTION_SIZE) {
    throw new VmError("PROGRAM_TOO_LONG", `Program exceeds ${MAX_INSTRUCTIONS} instructions.`);
  }
  if (bytes.length % INSTRUCTION_SIZE !== 0) {
    throw new VmError(
      "PROGRAM_LENGTH_NOT_MULTIPLE_OF_4",
      "Program byte length must be a multiple of 4.",
    );
  }
  const count = bytes.length / INSTRUCTION_SIZE;
  const instructions = decodeInstructions(bytes);
  for (const ins of instructions) {
    const { opcode, a, b, c, index } = ins;
    if (!OPCODE_NAMES.has(opcode)) {
      throw new VmError(
        "UNKNOWN_OPCODE",
        `Unknown opcode 0x${opcode.toString(16).padStart(2, "0")} at instruction ${index}.`,
        { instructionIndex: index },
      );
    }
    const registers =
      opcode === Opcode.MOVI || opcode === Opcode.JNZ
        ? [a]
        : opcode === Opcode.MOV
          ? [a, b]
          : opcode >= Opcode.ADD && opcode <= Opcode.AND
            ? [a, b, c]
            : [];
    for (const register of registers) {
      if (register > 7)
        throw new VmError(
          "REGISTER_OUT_OF_RANGE",
          `Register R${register} is invalid at instruction ${index}.`,
          { instructionIndex: index },
        );
    }
    const reserved =
      opcode === Opcode.NOP || opcode === Opcode.HALT
        ? [a, b, c]
        : opcode === Opcode.MOV
          ? [c]
          : [];
    for (let position = 0; position < reserved.length; position += 1) {
      const value = reserved[position];
      if (value !== 0)
        throw new VmError(
          "NONZERO_RESERVED_OPERAND",
          `Reserved operand byte ${position + 1} must be zero at instruction ${index}.`,
          { instructionIndex: index },
        );
    }
    if (opcode !== Opcode.HALT && index + 1 >= count) {
      throw new VmError(
        "FALLTHROUGH_OUT_OF_RANGE",
        `Instruction ${index} has an out-of-range fallthrough successor.`,
        { instructionIndex: index },
      );
    }
    if (opcode === Opcode.JNZ) {
      const target = index + decodeSignedOffset(b, c);
      if (target < 0 || target >= count) {
        throw new VmError(
          "JUMP_TARGET_OUT_OF_RANGE",
          `JNZ at instruction ${index} targets invalid instruction ${target}.`,
          { instructionIndex: index, pc: target },
        );
      }
    }
  }
}

export function decodeInstructions(bytes: Uint8Array): Instruction[] {
  const result: Instruction[] = [];
  for (let offset = 0; offset + 3 < bytes.length; offset += INSTRUCTION_SIZE) {
    const opcode = bytes[offset] as number;
    const a = bytes[offset + 1] as number;
    const b = bytes[offset + 2] as number;
    const c = bytes[offset + 3] as number;
    result.push(
      Object.freeze({
        index: offset / 4,
        opcode,
        a,
        b,
        c,
        bytes: [opcode, a, b, c] as const,
      }),
    );
  }
  return result;
}

export function decodeSignedOffset(b: number, c: number): number {
  const unsigned = b * 256 + c;
  return unsigned < 0x8000 ? unsigned : unsigned - 0x10000;
}

export function programToHex(program: Program | Uint8Array): `0x${string}` {
  const bytes = program instanceof Uint8Array ? program : program.bytes;
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function opcodeName(opcode: number): string {
  return Opcode[opcode] ?? `UNKNOWN_0x${opcode.toString(16).padStart(2, "0")}`;
}
