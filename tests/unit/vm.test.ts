import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import protocolVectors from "../../docs/protocol-vectors.json";
import vector from "../../packages/vm/fixtures/vm-v1-known-answer.json";
import { main as runVmCli } from "../../packages/vm/src/cli.js";
import {
  APPROVED_BUDGETS,
  assemble,
  computeContextHash,
  computeInputHash,
  computeLeafHash,
  computeProgramHash,
  computeStateHash,
  createExample,
  createMerkleProof,
  DOMAINS,
  disassemble,
  encodePublicInputAbi,
  execute,
  generateTrace,
  initialState,
  Opcode,
  parseProgram,
  parsePublicInput,
  serializeCanonicalJson,
  serializeStateAbi,
  step,
  traceProgram,
  UINT64_MAX,
  VmError,
  verifyMerkleProof,
  verifyTransition,
} from "../../packages/vm/src/index.js";

const zeroInput = ["0", "0", "0", "0", "0", "0", "0", "0"];
const program = (...instructions: number[]): ReturnType<typeof parseProgram> =>
  parseProgram(Uint8Array.from(instructions));

describe("program parsing and validation", () => {
  it("rejects empty, oversized, and partial programs in specification order", () => {
    expectCode(() => parseProgram(new Uint8Array()), "PROGRAM_EMPTY");
    expectCode(() => parseProgram(new Uint8Array(516)), "PROGRAM_TOO_LONG");
    expectCode(() => parseProgram(new Uint8Array([9, 0, 0])), "PROGRAM_LENGTH_NOT_MULTIPLE_OF_4");
    const maximumProgram = new Uint8Array(512);
    maximumProgram.set([Opcode.HALT, 0, 0, 0], 508);
    expect(parseProgram(maximumProgram).instructions).toHaveLength(128);
  });

  it("rejects unknown opcodes, bad registers, reserved bytes, and invalid successors", () => {
    expectCode(() => parseProgram("0xff000000"), "UNKNOWN_OPCODE");
    expectCode(() => parseProgram("0x0108000009000000"), "REGISTER_OUT_OF_RANGE");
    expectCode(() => parseProgram("0x0201000109000000"), "NONZERO_RESERVED_OPERAND");
    expectCode(() => parseProgram("0x00000000"), "FALLTHROUGH_OUT_OF_RANGE");
    expectCode(() => parseProgram("0x0800ffff09000000"), "JUMP_TARGET_OUT_OF_RANGE");
  });

  it("validates unreachable instructions and accepts backward control flow", () => {
    expectCode(
      () =>
        parseProgram(
          Uint8Array.from([Opcode.JNZ, 0, 0, 2, Opcode.MOVI, 8, 0, 0, Opcode.HALT, 0, 0, 0]),
        ),
      "REGISTER_OUT_OF_RANGE",
    );
    expect(assemble("loop:\nJNZ R0, loop\nHALT").instructions).toHaveLength(2);
  });

  it("keeps canonical program bytes isolated from caller mutation", () => {
    const parsed = parseProgram("0x09000000");
    parsed.bytes[0] = Opcode.NOP;
    expect(parsed.bytes[0]).toBe(Opcode.HALT);
  });

  it("accepts only the fixed ISA and rejects JavaScript-like assembly", () => {
    expectCode(() => assemble("eval R0"), "INVALID_ASSEMBLY");
  });
});

describe("VM v1 instruction transitions", () => {
  it("executes NOP and preserves registers", () => {
    const state = initialState(["9", "8", "7", "6", "5", "4", "3", "2"]);
    expect(step(program(Opcode.NOP, 0, 0, 0, Opcode.HALT, 0, 0, 0), state)).toMatchObject({
      pc: 1,
      halted: false,
      registers: state.registers,
    });
  });

  it("executes MOVI with an unsigned big-endian immediate", () => {
    const result = step(
      program(Opcode.MOVI, 3, 0x12, 0x34, Opcode.HALT, 0, 0, 0),
      initialState(zeroInput),
    );
    expect(result.registers[3]).toBe(0x1234n);
  });

  it("executes MOV from the predecessor state", () => {
    const result = step(
      program(Opcode.MOV, 2, 1, 0, Opcode.HALT, 0, 0, 0),
      initialState(["1", "18446744073709551615", "0", "0", "0", "0", "0", "0"]),
    );
    expect(result.registers[2]).toBe(UINT64_MAX);
  });

  it.each([
    ["ADD", [Opcode.ADD, 0, 1, 2], 12n],
    ["SUB", [Opcode.SUB, 0, 1, 2], 2n],
    ["MUL", [Opcode.MUL, 0, 1, 2], 35n],
    ["XOR", [Opcode.XOR, 0, 1, 2], 2n],
    ["AND", [Opcode.AND, 0, 1, 2], 5n],
  ] as const)("executes %s", (_name, instruction, expected) => {
    const state = initialState(["0", "7", "5", "0", "0", "0", "0", "0"]);
    const result = step(program(...instruction, Opcode.HALT, 0, 0, 0), state);
    expect(result.registers[0]).toBe(expected);
  });

  it("wraps ADD and MUL and wraps SUB underflow modulo 2^64", () => {
    const maxInput = initialState([UINT64_MAX, "1", "0", "0", "0", "0", "0", "0"]);
    expect(step(program(Opcode.ADD, 0, 0, 1, Opcode.HALT, 0, 0, 0), maxInput).registers[0]).toBe(
      0n,
    );
    expect(
      step(
        program(Opcode.SUB, 0, 1, 2, Opcode.HALT, 0, 0, 0),
        initialState(["0", "0", "1", "0", "0", "0", "0", "0"]),
      ).registers[0],
    ).toBe(UINT64_MAX);
    expect(
      step(
        program(Opcode.MUL, 0, 0, 1, Opcode.HALT, 0, 0, 0),
        initialState([UINT64_MAX, "2", "0", "0", "0", "0", "0", "0"]),
      ).registers[0],
    ).toBe(UINT64_MAX - 1n);
  });

  it("implements taken and not-taken JNZ offsets relative to the current PC", () => {
    const branch = program(
      Opcode.NOP,
      0,
      0,
      0,
      Opcode.NOP,
      0,
      0,
      0,
      Opcode.JNZ,
      0,
      0xff,
      0xff,
      Opcode.HALT,
      0,
      0,
      0,
    );
    expect(step(branch, { ...initialState(["1", ...zeroInput.slice(1)]), pc: 2 }).pc).toBe(1);
    expect(step(branch, { ...initialState(zeroInput), pc: 2 }).pc).toBe(3);
  });

  it("HALT retains PC/registers and halted states stutter without fetching", () => {
    const before = initialState(["15", "0", "0", "0", "0", "0", "0", "0"]);
    const halted = step(program(Opcode.HALT, 0, 0, 0), before);
    expect(halted).toMatchObject({ pc: 0, halted: true, registers: before.registers });
    expect(step(program(Opcode.HALT, 0, 0, 0), halted)).toBe(halted);
    expect(step(program(Opcode.HALT, 0, 0, 0), { ...halted, pc: 65535 })).toMatchObject({
      pc: 65535,
      halted: true,
    });
  });

  it("classifies exact and conflicting transitions", () => {
    const p = program(Opcode.MOVI, 0, 0, 3, Opcode.HALT, 0, 0, 0);
    const before = initialState(zeroInput);
    const after = step(p, before);
    expect(verifyTransition(p, before, after)).toBe("VALID");
    expect(verifyTransition(p, before, initialState(["4", ...zeroInput.slice(1)]))).toBe(
      "INVALID_TRANSITION",
    );
  });

  it("rejects invalid fetch PC and invalid public input values", () => {
    expectCode(
      () => step(program(Opcode.HALT, 0, 0, 0), { ...initialState(zeroInput), pc: 1 }),
      "INVALID_PRESTATE_PC",
    );
    expect(() => parsePublicInput([0, 0, 0, 0, 0, 0, 0])).toThrow();
    expect(() => parsePublicInput(["18446744073709551616", ...zeroInput.slice(1)])).toThrow();
    expect(() => parsePublicInput([Number.MAX_SAFE_INTEGER + 1, ...zeroInput.slice(1)])).toThrow();
  });
});

describe("execution traces and deterministic serialization", () => {
  it("emits exactly N+1 states and keeps halted states identical", () => {
    const trace = generateTrace(program(Opcode.MOVI, 0, 0, 4, Opcode.HALT, 0, 0, 0), zeroInput, 63);
    expect(trace).toHaveLength(64);
    expect(trace[2]).toEqual(trace[63]);
    expect(trace[2]?.halted).toBe(true);
  });

  it("accepts every protocol budget and rejects other lengths", () => {
    const haltProgram = program(Opcode.HALT, 0, 0, 0);
    for (const budget of APPROVED_BUDGETS) {
      const trace = generateTrace(haltProgram, zeroInput, budget);
      expect(trace).toHaveLength(budget + 1);
      const result = traceProgram(haltProgram, zeroInput, budget);
      const proof = createMerkleProof(result.executionContextHash, result.trace, budget);
      expect(proof).toHaveLength(Math.log2(budget + 1));
      expect(
        verifyMerkleProof(
          result.executionContextHash,
          budget,
          result.trace[budget] as ReturnType<typeof initialState>,
          proof,
          result.traceRoot,
        ),
      ).toBe(true);
    }
    expectCode(() => execute(program(Opcode.HALT, 0, 0, 0), zeroInput, 64), "INVALID_BUDGET");
  }, 15_000);

  it("classifies nonterminating programs as budget exhausted", () => {
    expectCode(
      () =>
        execute(
          createExample("nonterminating").program,
          createExample("nonterminating").publicInput,
          63,
        ),
      "BUDGET_EXHAUSTED",
    );
    expect(
      generateTrace(
        createExample("nonterminating").program,
        createExample("nonterminating").publicInput,
        63,
      ),
    ).toHaveLength(64);
  });

  it("replays generated examples within documented bounds", () => {
    expect(
      execute(createExample("sum").program, createExample("sum").publicInput, 63).summary.output,
    ).toBe("15");
    expect(
      execute(createExample("fibonacci").program, createExample("fibonacci").publicInput, 63)
        .summary.output,
    ).toBe("13");
    expect(
      execute(createExample("factorial").program, createExample("factorial").publicInput, 63)
        .summary.output,
    ).toBe("120");
    expect(
      execute(
        createExample("multiplication").program,
        createExample("multiplication").publicInput,
        63,
      ).summary.output,
    ).toBe("42");
  });

  it("is byte-identical across repeated executions and preserves uint64 JSON exactly", () => {
    const p = parseProgram(vector.programHex);
    const first = execute(p, vector.publicInput, vector.transitionCount);
    const second = execute(p, vector.publicInput, vector.transitionCount);
    expect(serializeCanonicalJson(first.summary)).toBe(serializeCanonicalJson(second.summary));
    expect(first.summary.output).toBe("12");
    expect(serializeCanonicalJson({ value: UINT64_MAX })).toContain('"18446744073709551615"');
  });
});

describe("canonical encoding and known-answer vectors", () => {
  it("matches protocol v1 known-answer program/input/context and trace-root values", () => {
    const p = parseProgram(vector.programHex);
    const programHash = computeProgramHash(p);
    const inputHash = computeInputHash(vector.publicInput);
    const contextHash = computeContextHash(programHash, inputHash, vector.transitionCount);
    const result = execute(p, vector.publicInput, vector.transitionCount);
    expect(programHash).toBe(vector.programHash);
    expect(inputHash).toBe(vector.inputHash);
    expect(contextHash).toBe(vector.executionContextHash);
    expect(result.summary.traceRoot).toBe(vector.traceRoot);
    expect(result.summary.haltIndex).toBe(vector.haltIndex);
  });

  it("matches every documented domain, sampled state/leaf hash, input ABI bytes, and final proof", () => {
    expect(DOMAINS).toEqual(protocolVectors.domains);
    const expected = protocolVectors.exampleExecution;
    expect(encodePublicInputAbi(expected.publicInputValues)).toBe(expected.publicInputAbiEncoded);
    const result = execute(
      parseProgram(expected.programHex),
      expected.publicInputValues,
      expected.transitionCount,
    );
    for (const sample of expected.sampledStates) {
      const state = result.trace[sample.index];
      expect(state).toBeDefined();
      expect(computeStateHash(state as ReturnType<typeof initialState>)).toBe(sample.stateHash);
      expect(
        computeLeafHash(
          result.summary.executionContextHash,
          sample.index,
          state as ReturnType<typeof initialState>,
        ),
      ).toBe(sample.leafHash);
    }
    const finalProof = createMerkleProof(
      result.summary.executionContextHash,
      result.trace,
      expected.finalStateProof.index,
    );
    expect(finalProof).toEqual(expected.finalStateProof.siblingsBottomUp);
  });

  it("encodes the state as 320 ABI bytes and authenticates indexed leaves", () => {
    const p = parseProgram(vector.programHex);
    const result = execute(p, vector.publicInput, vector.transitionCount);
    expect(
      (serializeStateAbi(result.trace[0] as ReturnType<typeof initialState>).length - 2) / 2,
    ).toBe(320);
    const proof = createMerkleProof(result.summary.executionContextHash, result.trace, 63);
    expect(proof).toHaveLength(6);
    expect(
      verifyMerkleProof(
        result.summary.executionContextHash,
        63,
        result.trace[63] as ReturnType<typeof initialState>,
        proof,
        result.summary.traceRoot,
      ),
    ).toBe(true);
    expect(
      verifyMerkleProof(
        result.summary.executionContextHash,
        62,
        result.trace[63] as ReturnType<typeof initialState>,
        proof,
        result.summary.traceRoot,
      ),
    ).toBe(false);
  });

  it("round-trips assembled programs through readable disassembly", () => {
    const original = assemble("loop:\nADD R0, R0, R1\nJNZ R1, loop\nHALT\n");
    expect(assemble(disassemble(original)).bytes).toEqual(original.bytes);
  });
});

describe("deterministic generated-program property checks", () => {
  it("runs seeded randomized valid straight-line programs reproducibly", () => {
    let seed = 0x5eed1234;
    const random = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    };
    for (let sample = 0; sample < 24; sample += 1) {
      const instructions: number[] = [];
      for (let index = 0; index < 5; index += 1) {
        const opcode = [Opcode.MOVI, Opcode.ADD, Opcode.SUB, Opcode.MUL, Opcode.XOR, Opcode.AND][
          random() % 6
        ] as number;
        if (opcode === Opcode.MOVI)
          instructions.push(opcode, random() % 8, (random() >>> 8) & 0xff, random() & 0xff);
        else instructions.push(opcode, random() % 8, random() % 8, random() % 8);
      }
      instructions.push(Opcode.HALT, 0, 0, 0);
      const p = parseProgram(Uint8Array.from(instructions));
      const input = Array.from({ length: 8 }, () => (BigInt(random()) << 32n) | BigInt(random()));
      const left = execute(p, input, 63);
      const right = execute(p, input, 63);
      expect(left.trace).toEqual(right.trace);
      expect(left.summary.traceRoot).toBe(right.summary.traceRoot);
      expect(left.trace).toHaveLength(64);
    }
  });
});

describe("VM CLI file output", () => {
  it("awaits validate and inspect output writes and emits valid JSON", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bisect-vm-cli-"));
    try {
      const validatePath = join(directory, "validate.json");
      const inspectPath = join(directory, "inspect.json");
      expect(
        await runVmCli(["vm", "validate", "0x010100050300000109000000", "--output", validatePath]),
      ).toBe(0);
      expect(JSON.parse(await readFile(validatePath, "utf8"))).toMatchObject({
        valid: true,
        instructionCount: 3,
      });

      expect(await runVmCli(["vm", "inspect", "example:sum", "--output", inspectPath])).toBe(0);
      expect(JSON.parse(await readFile(inspectPath, "utf8"))).toMatchObject({
        vmVersion: 1,
        instructionCount: 11,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

function expectCode(action: () => unknown, code: string): void {
  try {
    action();
    expect.fail(`Expected VM error ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(VmError);
    expect((error as VmError).code).toBe(code);
  }
}
