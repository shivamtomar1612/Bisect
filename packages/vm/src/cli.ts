#!/usr/bin/env node
import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assemble, disassemble } from "./assembler.js";
import { serializeCanonicalJson } from "./encoding.js";
import { isVmError, VmError } from "./errors.js";
import { createExample, INVALID_EXAMPLES, listExamples } from "./examples.js";
import { execute, traceProgram } from "./executor.js";
import { parseProgram, programToHex } from "./program.js";
import { serializeState } from "./state.js";

const HELP = [
  "BISECT VM v1 deterministic register machine",
  "",
  "Usage:",
  "  bisect vm <command> <program> [options]",
  "",
  "Commands:",
  "  validate <program>              Validate canonical program bytes.",
  "  run <program> --input <values>  Execute to HALT and print summary.",
  "  trace <program> --input <values> Emit the exact N+1 state trace.",
  "  inspect <program>                Show instructions and program metadata.",
  "  disassemble <program>            Print readable assembly.",
  "",
  "Program is 0x-prefixed bytecode, a file (.hex, .bin, .asm), or example:<name>.",
  "Input is a JSON array of exactly eight uint64 values (use decimal strings for large values).",
  "Execution commands require --budget 63|255|1023|4095. --input may be a JSON file path.",
  "Options: --input <json-or-file> --budget <N> --output <file> --help",
  `Examples: ${listExamples().join(", ")}`,
].join("\n");

export async function main(args: readonly string[] = process.argv.slice(2)): Promise<number> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h" || args[1] === "--help") {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  if (args[0] !== "vm") return fail("Use the top-level command 'vm'.");
  const command = args[1];
  if (command === undefined || command === "--help" || command === "-h") {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  if (!["validate", "run", "trace", "inspect", "disassemble"].includes(command)) {
    return fail(`Unknown VM command: ${command}.`);
  }
  try {
    const parsed = parseArgs(args.slice(2));
    if (parsed.help) {
      process.stdout.write(`${HELP}\n`);
      return 0;
    }
    if (parsed.program === undefined)
      throw new VmError("INVALID_CLI_INPUT", "A program argument is required.");
    const program = await loadProgram(parsed.program);
    if (command === "validate") {
      await print(
        {
          valid: true,
          instructionCount: program.instructions.length,
          programHex: programToHex(program),
        },
        parsed.output,
      );
      return 0;
    }
    if (command === "inspect") {
      await print(
        {
          vmVersion: 1,
          instructionCount: program.instructions.length,
          byteLength: program.bytes.length,
          programHex: programToHex(program),
          instructions: program.instructions.map((instruction) => ({
            index: instruction.index,
            opcode: instruction.opcode,
            name:
              instruction.opcode <= 9
                ? ["NOP", "MOVI", "MOV", "ADD", "SUB", "MUL", "XOR", "AND", "JNZ", "HALT"][
                    instruction.opcode
                  ]
                : "UNKNOWN",
            operands: [instruction.a, instruction.b, instruction.c],
          })),
        },
        parsed.output,
      );
      return 0;
    }
    if (command === "disassemble") {
      const text = disassemble(program);
      if (parsed.output === undefined) process.stdout.write(text);
      else await writeFile(resolve(parsed.output), text, "utf8");
      return 0;
    }
    if (parsed.input === undefined)
      throw new VmError("INVALID_CLI_INPUT", "Execution requires --input.");
    if (parsed.budget === undefined)
      throw new VmError("INVALID_CLI_INPUT", "Execution requires --budget.");
    const input = await loadInput(parsed.input);
    if (command === "run") {
      const result = execute(program, input, parsed.budget);
      await print({ ...result.summary, traceLength: result.trace.length }, parsed.output);
    } else {
      const result = traceProgram(program, input, parsed.budget);
      const finalState = result.trace[result.transitionCount];
      await print(
        {
          protocolVersion: 1,
          vmVersion: 1,
          encodingVersion: 1,
          programHex: programToHex(program),
          transitionCount: result.transitionCount,
          leafCount: result.trace.length,
          haltIndex: result.haltIndex,
          haltedWithinBudget: result.haltIndex !== null,
          output: result.haltIndex === null ? null : finalState?.registers[0].toString(10),
          programHash: result.programHash,
          inputHash: result.inputHash,
          executionContextHash: result.executionContextHash,
          traceRoot: result.traceRoot,
          finalState: finalState === undefined ? null : serializeState(finalState),
          trace: result.trace.map(serializeState),
        },
        parsed.output,
      );
    }
    return 0;
  } catch (error) {
    const message = isVmError(error)
      ? `${error.code}: ${error.message}`
      : error instanceof Error
        ? error.message
        : String(error);
    process.stderr.write(`${message}\n`);
    return 1;
  }
}

interface ParsedArgs {
  readonly program?: string;
  readonly input?: string;
  readonly budget?: number;
  readonly output?: string;
  readonly help: boolean;
}

function parseArgs(args: readonly string[]): ParsedArgs {
  const result: {
    program?: string;
    input?: string;
    budget?: number;
    output?: string;
    help: boolean;
  } = { help: false };
  let index = 0;
  if (args[0] !== undefined && !args[0].startsWith("-")) {
    result.program = args[0];
    index = 1;
  }
  while (index < args.length) {
    const option = args[index];
    if (option === "--help" || option === "-h") result.help = true;
    else if (option === "--input") result.input = requiredValue(args, ++index, option);
    else if (option === "--budget") {
      const raw = requiredValue(args, ++index, option);
      if (!/^(63|255|1023|4095)$/.test(raw))
        throw new VmError("INVALID_BUDGET", "Budget must be 63, 255, 1023, or 4095.");
      result.budget = Number(raw);
    } else if (option === "--output") result.output = requiredValue(args, ++index, option);
    else throw new VmError("INVALID_CLI_INPUT", `Unknown option ${option}.`);
    index += 1;
  }
  return result;
}

function requiredValue(args: readonly string[], index: number, option: string): string {
  const value = args[index];
  if (value === undefined || value.startsWith("--"))
    throw new VmError("INVALID_CLI_INPUT", `${option} requires a value.`);
  return value;
}

async function loadProgram(source: string) {
  if (source.startsWith("example:")) {
    const name = source.slice("example:".length);
    if (name in INVALID_EXAMPLES)
      return parseProgram(INVALID_EXAMPLES[name as keyof typeof INVALID_EXAMPLES]);
    return createExample(name).program;
  }
  if (source.startsWith("0x")) return parseProgram(source);
  const path = resolve(source);
  const info = await stat(path);
  if (info.size > 16_384) {
    throw new VmError("INVALID_CLI_INPUT", "Program file exceeds the 16 KiB input limit.");
  }
  const content = await readFile(path);
  if (path.toLowerCase().endsWith(".asm")) return assemble(content.toString("utf8"));
  if (path.toLowerCase().endsWith(".bin")) return parseProgram(new Uint8Array(content));
  return parseProgram(content.toString("utf8").trim());
}

async function loadInput(source: string): Promise<unknown> {
  let text = source;
  if (source.length > 4096) {
    throw new VmError("INVALID_CLI_INPUT", "--input exceeds the 4 KiB JSON input limit.");
  }
  if (!source.trimStart().startsWith("[")) {
    const path = resolve(source);
    const info = await stat(path);
    if (info.size > 4096) {
      throw new VmError("INVALID_CLI_INPUT", "Input file exceeds the 4 KiB JSON input limit.");
    }
    text = await readFile(path, "utf8");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new VmError(
      "INVALID_CLI_INPUT",
      "--input must contain a JSON array of eight uint64 values.",
    );
  }
}

async function print(value: unknown, path?: string): Promise<void> {
  const output = serializeCanonicalJson(value);
  if (path === undefined) process.stdout.write(output);
  else await writeFile(resolve(path), output, "utf8");
}

function fail(message: string): number {
  process.stderr.write(`${message}\n\n${HELP}\n`);
  return 2;
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/cli.ts")) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
