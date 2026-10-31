import { describe, expect, it } from "vitest";
import {
  commitExecutionState,
  createExecutionStateProof,
  exportExecutionStateProof,
  exportExecutionTrace,
  generateTraceCommitment,
  generateTraceRoot,
  importExecutionStateProof,
  importExecutionTrace,
  verifyExecutionStateProof,
} from "../../packages/sdk/src/index.js";
import { initialState } from "../../packages/vm/src/index.js";

describe("typed SDK trace commitment APIs", () => {
  it("generates, exports, imports, and verifies a proof against its execution context", () => {
    const request = {
      program: "0x010100050300000109000000",
      publicInput: ["7", "0", "0", "0", "0", "0", "0", "0"],
      transitionCount: 63,
    };
    const trace = generateTraceCommitment(request);
    expect(generateTraceRoot(request)).toBe(trace.traceRoot);
    const proof = createExecutionStateProof({ trace, stateIndex: 63 });
    const exportedTrace = exportExecutionTrace(trace);
    const exportedProof = exportExecutionStateProof(proof);
    const importedTrace = importExecutionTrace(exportedTrace);
    const importedProof = importExecutionStateProof(exportedProof);
    const initialCommitment = commitExecutionState({
      executionContextHash: trace.executionContextHash,
      transitionCount: trace.transitionCount,
      stateIndex: 0,
      state: initialState(request.publicInput),
    });

    expect(importedTrace.traceRoot).toBe(trace.traceRoot);
    expect(importedProof.siblingsBottomUp).toEqual(proof.siblingsBottomUp);
    expect(initialCommitment.leafHash).toBe(
      createExecutionStateProof({ trace, stateIndex: 0 }).leafHash,
    );
    expect(
      verifyExecutionStateProof({
        proof: importedProof,
        program: request.program,
        publicInput: request.publicInput,
        transitionCount: request.transitionCount,
        expectedRoot: trace.traceRoot,
      }),
    ).toBe(true);
    expect(
      verifyExecutionStateProof({
        proof: importedProof,
        program: request.program,
        publicInput: request.publicInput,
        transitionCount: request.transitionCount,
        expectedRoot: importedProof.programHash,
      }),
    ).toBe(false);
  });
});
