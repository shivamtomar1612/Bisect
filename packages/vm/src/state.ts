import { encodeAbiParameters } from "viem";
import { VmError } from "./errors.js";
import { type Registers, type SerializedState, type State, UINT64_MAX } from "./types.js";

export function parsePublicInput(value: unknown): Registers {
  if (!Array.isArray(value) || value.length !== 8) {
    throw new VmError(
      "INVALID_PUBLIC_INPUT",
      "Public input must be an array of exactly eight uint64 values.",
    );
  }
  const values = value.map((item, index) => {
    let parsed: bigint;
    if (typeof item === "bigint") parsed = item;
    else if (typeof item === "string" && item.length <= 20 && /^(0|[1-9][0-9]*)$/.test(item))
      parsed = BigInt(item);
    else if (typeof item === "number" && Number.isSafeInteger(item) && item >= 0)
      parsed = BigInt(item);
    else
      throw new VmError(
        "INVALID_PUBLIC_INPUT",
        `Public input at index ${index} must be a nonnegative integer or decimal string.`,
      );
    if (parsed < 0n || parsed > UINT64_MAX) {
      throw new VmError(
        "INVALID_PUBLIC_INPUT",
        `Public input at index ${index} is outside uint64 range.`,
      );
    }
    return parsed;
  });
  return freezeRegisters(values);
}

export function createState(pc: number, halted: boolean, registers: readonly bigint[]): State {
  if (!Number.isInteger(pc) || pc < 0 || pc > 0xffff) {
    throw new VmError("INVALID_PRESTATE_PC", "PC must be an unsigned 16-bit integer.", { pc });
  }
  if (typeof halted !== "boolean") throw new TypeError("halted must be a boolean");
  if (
    registers.length !== 8 ||
    registers.some((value) => typeof value !== "bigint" || value < 0n || value > UINT64_MAX)
  ) {
    throw new TypeError("State registers must contain exactly eight uint64 BigInts.");
  }
  return Object.freeze({ pc, halted, registers: freezeRegisters(registers) });
}

export function initialState(publicInput: unknown): State {
  return createState(0, false, parsePublicInput(publicInput));
}

export function serializeState(state: State): SerializedState {
  return Object.freeze({
    pc: state.pc,
    halted: state.halted,
    registers: Object.freeze(state.registers.map((register) => register.toString(10))),
  });
}

export function serializeStateAbi(state: State): `0x${string}` {
  return encodeAbiParameters(
    [{ type: "uint16" }, { type: "bool" }, { type: "uint64[8]" }],
    [state.pc, state.halted, [...state.registers]],
  );
}

export function parseStateJson(value: unknown): State {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new VmError("INVALID_CLI_INPUT", "State must be a JSON object.");
  }
  const record = value as {
    readonly pc?: unknown;
    readonly halted?: unknown;
    readonly registers?: unknown;
  };
  if (!Number.isInteger(record.pc) || typeof record.halted !== "boolean") {
    throw new VmError(
      "INVALID_CLI_INPUT",
      "State must contain an integer pc and boolean halted field.",
    );
  }
  const parsedInput = parsePublicInput(record.registers);
  return createState(record.pc as number, record.halted, parsedInput);
}

function freezeRegisters(registers: readonly bigint[]): Registers {
  return Object.freeze([...registers]) as unknown as Registers;
}
