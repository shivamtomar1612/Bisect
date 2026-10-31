import { encodeAbiParameters, type Hex, keccak256, stringToHex } from "viem";
import { VmError } from "./errors.js";
import { programToHex } from "./program.js";
import { parsePublicInput, serializeStateAbi } from "./state.js";
import {
  APPROVED_BUDGETS,
  ENCODING_VERSION,
  type ExecutionBudget,
  PROTOCOL_VERSION,
  type Program,
  type Registers,
  type State,
  VM_VERSION,
} from "./types.js";

export const DOMAINS = Object.freeze({
  program: keccak256(stringToHex("BISECT/PROGRAM/V1")),
  input: keccak256(stringToHex("BISECT/INPUT/V1")),
  context: keccak256(stringToHex("BISECT/CONTEXT/V1")),
  state: keccak256(stringToHex("BISECT/STATE/V1")),
  leaf: keccak256(stringToHex("BISECT/LEAF/V1")),
  node: keccak256(stringToHex("BISECT/NODE/V1")),
});

export function encodePublicInputAbi(publicInput: unknown): Hex {
  const registers = parsePublicInput(publicInput);
  return encodeAbiParameters([{ type: "uint64[8]" }], [[...registers]]);
}

export function computeProgramHash(program: Program): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint16" }, { type: "uint16" }, { type: "bytes" }],
      [DOMAINS.program, VM_VERSION, program.bytes.length, programToHex(program)],
    ),
  );
}

export function computeInputHash(publicInput: unknown): Hex {
  const registers = parsePublicInput(publicInput);
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint16" }, { type: "uint64[8]" }],
      [DOMAINS.input, ENCODING_VERSION, [...registers]],
    ),
  );
}

export function computeContextHash(programHash: Hex, inputHash: Hex, budget: number): Hex {
  const validBudget = requireBudget(budget);
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint16" },
        { type: "uint16" },
        { type: "uint16" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint16" },
        { type: "uint16" },
      ],
      [
        DOMAINS.context,
        PROTOCOL_VERSION,
        VM_VERSION,
        ENCODING_VERSION,
        programHash,
        inputHash,
        validBudget,
        validBudget + 1,
      ],
    ),
  );
}

export function computeStateHash(state: State): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint16" },
        { type: "uint16" },
        { type: "uint16" },
        { type: "bool" },
        { type: "uint64[8]" },
      ],
      [DOMAINS.state, VM_VERSION, ENCODING_VERSION, state.pc, state.halted, [...state.registers]],
    ),
  );
}

export function computeLeafHash(contextHash: Hex, index: number, state: State): Hex {
  if (!Number.isInteger(index) || index < 0 || index > 4095)
    throw new RangeError("State index must be in 0..4095.");
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint16" }, { type: "bytes32" }],
      [DOMAINS.leaf, contextHash, index, computeStateHash(state)],
    ),
  );
}

export function computeNodeHash(left: Hex, right: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }],
      [DOMAINS.node, left, right],
    ),
  );
}

export function computeTraceRoot(contextHash: Hex, trace: readonly State[]): Hex {
  if (!APPROVED_BUDGETS.some((budget) => budget + 1 === trace.length)) {
    throw new RangeError("A trace tree must contain 64, 256, 1024, or 4096 states.");
  }
  let level = trace.map((state, index) => computeLeafHash(contextHash, index, state));
  while (level.length > 1) {
    const next: Hex[] = [];
    for (let i = 0; i < level.length; i += 2)
      next.push(computeNodeHash(level[i] as Hex, level[i + 1] as Hex));
    level = next;
  }
  return level[0] as Hex;
}

export function createMerkleProof(
  contextHash: Hex,
  trace: readonly State[],
  index: number,
): readonly Hex[] {
  if (!Number.isInteger(index) || index < 0 || index >= trace.length)
    throw new RangeError("Proof index is outside the trace.");
  if (!APPROVED_BUDGETS.some((budget) => budget + 1 === trace.length)) {
    throw new RangeError("Trace leaf count must be 64, 256, 1024, or 4096.");
  }
  let position = index;
  let level = trace.map((state, i) => computeLeafHash(contextHash, i, state));
  const siblings: Hex[] = [];
  while (level.length > 1) {
    siblings.push(level[position ^ 1] as Hex);
    const next: Hex[] = [];
    for (let i = 0; i < level.length; i += 2)
      next.push(computeNodeHash(level[i] as Hex, level[i + 1] as Hex));
    position = Math.floor(position / 2);
    level = next;
  }
  return Object.freeze(siblings);
}

export function verifyMerkleProof(
  contextHash: Hex,
  index: number,
  state: State,
  siblings: readonly Hex[],
  root: Hex,
): boolean {
  const validDepth = [6, 8, 10, 12].includes(siblings.length);
  const validHex = (value: string): boolean => /^0x[0-9a-fA-F]{64}$/.test(value);
  if (
    !validDepth ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= 2 ** siblings.length ||
    !validHex(contextHash) ||
    !validHex(root) ||
    siblings.some((sibling) => !validHex(sibling))
  )
    return false;
  try {
    let hash = computeLeafHash(contextHash, index, state);
    for (let level = 0; level < siblings.length; level += 1) {
      const sibling = siblings[level];
      if (sibling === undefined) return false;
      hash =
        ((index >> level) & 1) === 0
          ? computeNodeHash(hash, sibling)
          : computeNodeHash(sibling, hash);
    }
    return hash.toLowerCase() === root.toLowerCase();
  } catch {
    return false;
  }
}

export function serializeCanonicalJson(value: unknown): string {
  return `${JSON.stringify(
    value,
    (_key, item: unknown) => (typeof item === "bigint" ? item.toString(10) : item),
    2,
  )}\n`;
}

export function requireBudget(value: number): ExecutionBudget {
  if (!APPROVED_BUDGETS.some((budget) => budget === value)) {
    throw new VmError(
      "INVALID_BUDGET",
      `Transition budget must be one of ${APPROVED_BUDGETS.join(", ")}.`,
    );
  }
  return value as ExecutionBudget;
}

export function stateAbiBytes(state: State): Hex {
  return serializeStateAbi(state);
}

export function publicInputAsRegisters(value: unknown): Registers {
  return parsePublicInput(value);
}
