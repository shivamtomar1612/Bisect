import { VmError } from "./errors.js";
import { decodeSignedOffset, opcodeName, parseProgram, programToHex } from "./program.js";
import { Opcode, type Program } from "./types.js";

type Pending = {
  readonly line: number;
  readonly name: string;
  readonly args: readonly string[];
  readonly address: number;
};

export function assemble(source: string): Program {
  if (source.length > 16_384) {
    throw new VmError("INVALID_ASSEMBLY", "Assembly source exceeds the 16 KiB parser limit.");
  }
  const labels = new Map<string, number>();
  const pending: Pending[] = [];
  let address = 0;
  const lines = source.split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    let text = (lines[lineIndex] as string).replace(/;.*/, "").replace(/#.*/, "").trim();
    text = text.replace(/^\d+\s*:\s*/, "");
    if (text === "") continue;
    const labelMatch = /^([A-Za-z_][A-Za-z0-9_]*):/.exec(text);
    if (labelMatch !== null) {
      const label = labelMatch[1] as string;
      if (labels.has(label)) throw asmError(lineIndex + 1, `Duplicate label ${label}.`);
      labels.set(label, address);
      text = text.slice(labelMatch[0].length).trim();
      if (text === "") continue;
    }
    const split = /^([A-Za-z]+)\s*(.*)$/.exec(text);
    if (split === null) throw asmError(lineIndex + 1, "Expected an instruction.");
    const name = (split[1] as string).toUpperCase();
    const args =
      (split[2] as string).trim() === ""
        ? []
        : (split[2] as string).split(",").map((part) => part.trim());
    pending.push({ line: lineIndex + 1, name, args, address });
    address += 1;
    if (address > 128)
      throw asmError(lineIndex + 1, "Programs may contain at most 128 instructions.");
  }
  const bytes: number[] = [];
  for (const item of pending) bytes.push(...encodeInstruction(item, labels));
  try {
    return parseProgram(Uint8Array.from(bytes));
  } catch (error) {
    if (error instanceof VmError) throw error;
    throw error;
  }
}

export function disassemble(program: Program): string {
  return `${program.instructions
    .map((instruction) => {
      const { opcode, a, b, c, index } = instruction;
      switch (opcode) {
        case Opcode.NOP:
          return format(index, "NOP");
        case Opcode.MOVI:
          return format(index, `MOVI R${a}, ${b * 256 + c}`);
        case Opcode.MOV:
          return format(index, `MOV R${a}, R${b}`);
        case Opcode.ADD:
        case Opcode.SUB:
        case Opcode.MUL:
        case Opcode.XOR:
        case Opcode.AND:
          return format(index, `${opcodeName(opcode)} R${a}, R${b}, R${c}`);
        case Opcode.JNZ:
          return format(index, `JNZ R${a}, ${decodeSignedOffset(b, c)}`);
        case Opcode.HALT:
          return format(index, "HALT");
        default:
          return format(index, `UNKNOWN_${opcode}`);
      }
    })
    .join("\n")}\n`;
}

export function formatProgram(program: Program): string {
  return programToHex(program);
}

function encodeInstruction(item: Pending, labels: ReadonlyMap<string, number>): readonly number[] {
  const fail = (message: string): never => {
    throw asmError(item.line, message);
  };
  const reg = (raw: string | undefined): number => {
    if (raw === undefined || !/^R[0-7]$/i.test(raw))
      return fail("Registers must be written R0 through R7.");
    return Number(raw.slice(1));
  };
  const exact = (expected: number): void => {
    if (item.args.length !== expected) fail(`${item.name} expects ${expected} operand(s).`);
  };
  switch (item.name) {
    case "NOP":
      exact(0);
      return [Opcode.NOP, 0, 0, 0];
    case "HALT":
      exact(0);
      return [Opcode.HALT, 0, 0, 0];
    case "MOVI": {
      exact(2);
      const destination = reg(item.args[0]);
      const valueText = item.args[1] as string;
      if (!/^(0|[1-9][0-9]*)$/.test(valueText))
        return fail("MOVI immediate must be an unsigned decimal integer.");
      const value = Number(valueText);
      if (!Number.isInteger(value) || value > 65535)
        return fail("MOVI immediate must be in 0..65535.");
      return [Opcode.MOVI, destination, Math.floor(value / 256), value % 256];
    }
    case "MOV": {
      exact(2);
      return [Opcode.MOV, reg(item.args[0]), reg(item.args[1]), 0];
    }
    case "ADD":
    case "SUB":
    case "MUL":
    case "XOR":
    case "AND": {
      exact(3);
      const opcode = Opcode[item.name as "ADD" | "SUB" | "MUL" | "XOR" | "AND"];
      return [opcode, reg(item.args[0]), reg(item.args[1]), reg(item.args[2])];
    }
    case "JNZ": {
      exact(2);
      const register = reg(item.args[0]);
      const targetText = item.args[1] as string;
      const target = labels.get(targetText);
      let offset: number;
      if (target !== undefined) offset = target - item.address;
      else {
        if (!/^-?(0|[1-9][0-9]*)$/.test(targetText))
          return fail("JNZ expects a signed offset or a label.");
        offset = Number(targetText);
      }
      if (!Number.isInteger(offset) || offset < -32768 || offset > 32767)
        return fail("JNZ offset must fit signed 16-bit.");
      const unsigned = offset < 0 ? offset + 65536 : offset;
      return [Opcode.JNZ, register, Math.floor(unsigned / 256), unsigned % 256];
    }
    default:
      return fail(`Unknown instruction ${item.name}.`);
  }
}

function format(index: number, instruction: string): string {
  return `${index.toString().padStart(3, "0")}: ${instruction}`;
}

function asmError(line: number, message: string): VmError {
  return new VmError("INVALID_ASSEMBLY", `Line ${line}: ${message}`);
}
