import { VmError } from "./errors.js";
import { decodeSignedOffset } from "./program.js";
import { createState } from "./state.js";
import { Opcode, type Program, type State, UINT64_MODULUS } from "./types.js";

export function step(program: Program, state: State): State {
  if (state.halted) return state;
  if (!Number.isInteger(state.pc) || state.pc < 0 || state.pc >= program.instructions.length) {
    throw new VmError("INVALID_PRESTATE_PC", `Cannot fetch instruction at PC ${state.pc}.`, {
      pc: state.pc,
    });
  }
  const instruction = program.instructions[state.pc];
  if (instruction === undefined)
    throw new VmError("INVALID_PRESTATE_PC", `Cannot fetch instruction at PC ${state.pc}.`, {
      pc: state.pc,
    });

  const registers = [...state.registers];
  let nextPc = state.pc + 1;
  let halted = false;
  const { opcode, a, b, c } = instruction;
  switch (opcode) {
    case Opcode.NOP:
      break;
    case Opcode.MOVI:
      registers[a] = BigInt(b * 256 + c);
      break;
    case Opcode.MOV:
      registers[a] = state.registers[b] as bigint;
      break;
    case Opcode.ADD:
      registers[a] =
        ((state.registers[b] as bigint) + (state.registers[c] as bigint)) % UINT64_MODULUS;
      break;
    case Opcode.SUB:
      registers[a] =
        ((state.registers[b] as bigint) - (state.registers[c] as bigint) + UINT64_MODULUS) %
        UINT64_MODULUS;
      break;
    case Opcode.MUL:
      registers[a] =
        ((state.registers[b] as bigint) * (state.registers[c] as bigint)) % UINT64_MODULUS;
      break;
    case Opcode.XOR:
      registers[a] = (state.registers[b] as bigint) ^ (state.registers[c] as bigint);
      break;
    case Opcode.AND:
      registers[a] = (state.registers[b] as bigint) & (state.registers[c] as bigint);
      break;
    case Opcode.JNZ:
      if ((state.registers[a] as bigint) !== 0n) nextPc = state.pc + decodeSignedOffset(b, c);
      break;
    case Opcode.HALT:
      nextPc = state.pc;
      halted = true;
      break;
    default:
      throw new VmError("INVALID_TRANSITION", `Unsupported opcode ${opcode} at PC ${state.pc}.`, {
        pc: state.pc,
      });
  }
  if (nextPc < 0 || nextPc >= program.instructions.length) {
    throw new VmError(
      "INVALID_SUCCESSOR_PC",
      `Instruction at PC ${state.pc} produced invalid PC ${nextPc}.`,
      { pc: nextPc },
    );
  }
  return createState(nextPc, halted, registers);
}

export function statesEqual(left: State, right: State): boolean {
  return (
    left.pc === right.pc &&
    left.halted === right.halted &&
    left.registers.every((register, index) => register === right.registers[index])
  );
}

export function verifyTransition(
  program: Program,
  previous: State,
  next: State,
): "VALID" | "INVALID_TRANSITION" {
  try {
    return statesEqual(step(program, previous), next) ? "VALID" : "INVALID_TRANSITION";
  } catch {
    return "INVALID_TRANSITION";
  }
}
