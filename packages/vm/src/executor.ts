import {
  computeContextHash,
  computeInputHash,
  computeProgramHash,
  computeTraceRoot,
  requireBudget,
} from "./encoding.js";
import { VmError } from "./errors.js";
import { step } from "./machine.js";
import { programToHex } from "./program.js";
import { initialState, parsePublicInput, serializeState } from "./state.js";
import type { ExecutionBudget, ExecutionResult, Program, State } from "./types.js";

export interface TraceExecution {
  readonly transitionCount: ExecutionBudget;
  readonly haltIndex: number | null;
  readonly trace: readonly State[];
  readonly programHash: `0x${string}`;
  readonly inputHash: `0x${string}`;
  readonly executionContextHash: `0x${string}`;
  readonly traceRoot: `0x${string}`;
}

export function execute(
  program: Program,
  publicInput: unknown,
  budgetValue: number,
): ExecutionResult {
  const result = traceProgram(program, publicInput, budgetValue);
  const { transitionCount: budget, trace, haltIndex } = result;
  if (haltIndex === null) {
    throw new VmError(
      "BUDGET_EXHAUSTED",
      `Program did not reach HALT within ${budget} transitions.`,
    );
  }
  const finalState = trace[budget] as State;
  const summary = Object.freeze({
    protocolVersion: 1 as const,
    vmVersion: 1 as const,
    encodingVersion: 1 as const,
    programHex: programToHex(program),
    publicInput: Object.freeze(parsePublicInput(publicInput).map((value) => value.toString(10))),
    transitionCount: budget as ExecutionBudget,
    leafCount: budget + 1,
    haltIndex,
    output: finalState.registers[0].toString(10),
    programHash: result.programHash,
    inputHash: result.inputHash,
    executionContextHash: result.executionContextHash,
    traceRoot: result.traceRoot,
    finalState: serializeState(finalState),
  });
  return Object.freeze({ summary, trace });
}

export function calculateOutput(program: Program, publicInput: unknown, budget: number): bigint {
  return BigInt(execute(program, publicInput, budget).summary.output);
}

export function generateTrace(
  program: Program,
  publicInput: unknown,
  budget: number,
): readonly State[] {
  return traceProgram(program, publicInput, budget).trace;
}

export function traceProgram(
  program: Program,
  publicInput: unknown,
  budgetValue: number,
): TraceExecution {
  const budget = requireBudget(budgetValue);
  const input = parsePublicInput(publicInput);
  const trace: State[] = [initialState(input)];
  let haltIndex: number | null = null;
  for (let transition = 1; transition <= budget; transition += 1) {
    const previous = trace[transition - 1];
    if (previous === undefined) throw new Error("Internal trace index invariant failed.");
    const next = step(program, previous);
    trace.push(next);
    if (next.halted && haltIndex === null) haltIndex = transition;
  }
  if (trace.length !== budget + 1) throw new Error("Internal trace length invariant failed.");
  const programHash = computeProgramHash(program);
  const inputHash = computeInputHash(input);
  const contextHash = computeContextHash(programHash, inputHash, budget);
  const root = computeTraceRoot(contextHash, trace);
  return Object.freeze({
    transitionCount: budget,
    haltIndex,
    trace: Object.freeze(trace),
    programHash,
    inputHash,
    executionContextHash: contextHash,
    traceRoot: root,
  });
}
