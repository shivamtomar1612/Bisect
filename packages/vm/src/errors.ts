export const VM_ERROR_CODES = [
  "PROGRAM_EMPTY",
  "PROGRAM_TOO_LONG",
  "PROGRAM_LENGTH_NOT_MULTIPLE_OF_4",
  "UNKNOWN_OPCODE",
  "NONZERO_RESERVED_OPERAND",
  "REGISTER_OUT_OF_RANGE",
  "FALLTHROUGH_OUT_OF_RANGE",
  "JUMP_TARGET_OUT_OF_RANGE",
  "INVALID_PUBLIC_INPUT",
  "INVALID_BUDGET",
  "INVALID_PRESTATE_PC",
  "INVALID_SUCCESSOR_PC",
  "BUDGET_EXHAUSTED",
  "INVALID_TRANSITION",
  "INVALID_HEX",
  "INVALID_ASSEMBLY",
  "INVALID_CLI_INPUT",
] as const;

export type VmErrorCode = (typeof VM_ERROR_CODES)[number];

export class VmError extends Error {
  readonly code: VmErrorCode;
  readonly instructionIndex?: number;
  readonly pc?: number;

  constructor(
    code: VmErrorCode,
    message: string,
    details: { instructionIndex?: number; pc?: number } = {},
  ) {
    super(message);
    this.name = "VmError";
    this.code = code;
    if (details.instructionIndex !== undefined) this.instructionIndex = details.instructionIndex;
    if (details.pc !== undefined) this.pc = details.pc;
  }
}

export function isVmError(error: unknown): error is VmError {
  return error instanceof VmError;
}
