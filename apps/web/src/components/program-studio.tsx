"use client";

import {
  commitExecutionState,
  createExecutionStateProof,
  exportExecutionStateProof,
  generateTraceCommitment,
  type StateProofArtifact,
  type TraceCommitmentArtifact,
  verifyExecutionStateProof,
} from "@bisect/sdk";
import {
  APPROVED_BUDGETS,
  assemble,
  createExample,
  type ExecutionBudget,
  getExampleSource,
  opcodeName,
  type Program,
  parsePublicInput,
  parseStateJson,
  type Registers,
  requireBudget,
  type State,
} from "@bisect/vm";
import {
  ArrowDownToLine,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  FileCode2,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildPhase5ClaimSubmission,
  createDishonestTraceScenario,
  type DishonestTraceScenario,
  type Phase5ClaimSubmission,
  phase5ClaimCalldata,
  serializePhase5ClaimExport,
  serializeStudioExport,
} from "./program-studio-utils";

const RUNNABLE_EXAMPLES = [
  "increment",
  "addition",
  "multiplication",
  "sum",
  "fibonacci",
  "factorial",
  "branching",
  "halt-stutter",
  "nonterminating",
] as const;

const EXAMPLE_LABELS: Readonly<Record<(typeof RUNNABLE_EXAMPLES)[number], string>> = {
  increment: "Increment",
  addition: "Addition",
  multiplication: "Multiplication",
  sum: "Sum loop",
  fibonacci: "Fibonacci-like loop",
  factorial: "Factorial",
  branching: "Conditional branching",
  "halt-stutter": "HALT and stuttering",
  nonterminating: "Nonterminating loop",
};

const VALIDATION_EXAMPLES = {
  "invalid-opcode": { label: "Unknown opcode", source: "WAT R0\nHALT\n" },
  "malformed-operands": { label: "Malformed operands", source: "MOVI R0\nHALT\n" },
  "invalid-register": { label: "Invalid register index", source: "ADD R8, R0, R1\nHALT\n" },
} as const;

const DEFAULT_EXAMPLE = createExample("addition");
const INPUT_LABELS = ["R0", "R1", "R2", "R3", "R4", "R5", "R6", "R7"] as const;
const ROW_HEIGHT = 58;
const VIEWPORT_HEIGHT = 360;
const OVERSCAN = 4;

interface ExecutionView {
  readonly artifact: TraceCommitmentArtifact;
  readonly program: Program;
  readonly publicInput: Registers;
  readonly states: readonly State[];
}

type ValidationResult =
  | {
      readonly ok: true;
      readonly program: Program;
      readonly publicInput: Registers;
      readonly budget: ExecutionBudget;
    }
  | {
      readonly ok: false;
      readonly field: "program" | "public-input" | "budget";
      readonly message: string;
    };

export function ProgramStudio() {
  const [exampleId, setExampleId] = useState<string>("addition");
  const [source, setSource] = useState(() => getExampleSource("addition"));
  const [inputValues, setInputValues] = useState<readonly string[]>(() =>
    DEFAULT_EXAMPLE.publicInput.map((value) => value.toString(10)),
  );
  const [budgetText, setBudgetText] = useState(String(DEFAULT_EXAMPLE.recommendedBudget));
  const [execution, setExecution] = useState<ExecutionView | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [proof, setProof] = useState<StateProofArtifact | null>(null);
  const [proofVerified, setProofVerified] = useState<boolean | null>(null);
  const [tamperedProofVerified, setTamperedProofVerified] = useState<boolean | null>(null);
  const [claimSubmission, setClaimSubmission] = useState<Phase5ClaimSubmission | null>(null);
  const [dishonestScenario, setDishonestScenario] = useState<DishonestTraceScenario | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const traceListRef = useRef<HTMLOListElement | null>(null);

  const validation = useMemo<ValidationResult>(() => {
    let program: Program;
    try {
      program = assemble(source);
    } catch (error) {
      return {
        ok: false,
        field: "program",
        message: error instanceof Error ? error.message : "Program assembly failed.",
      };
    }
    let publicInput: Registers;
    try {
      publicInput = parsePublicInput(inputValues);
    } catch (error) {
      return {
        ok: false,
        field: "public-input",
        message: error instanceof Error ? error.message : "Public input is invalid.",
      };
    }
    try {
      return {
        ok: true,
        program,
        publicInput,
        budget: requireBudget(Number(budgetText)),
      };
    } catch (error) {
      return {
        ok: false,
        field: "budget",
        message: error instanceof Error ? error.message : "Execution budget is invalid.",
      };
    }
  }, [source, inputValues, budgetText]);

  const invalidateExecution = () => {
    setExecution(null);
    setSelectedIndex(0);
    setScrollTop(0);
    setIsPlaying(false);
    setRunError(null);
    setProof(null);
    setProofVerified(null);
    setTamperedProofVerified(null);
    setClaimSubmission(null);
  };

  const states = execution?.states ?? [];
  const lastIndex = Math.max(0, states.length - 1);
  const selectedState = states[selectedIndex];
  const previousState = selectedIndex > 0 ? states[selectedIndex - 1] : undefined;
  const changedRegisters = changedRegisterNames(previousState, selectedState);
  const previousInstruction =
    previousState === undefined
      ? null
      : (execution?.program.instructions[previousState.pc] ?? null);
  const visibleStart =
    states.length === 0 ? 0 : Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleEnd = Math.min(
    states.length,
    visibleStart + Math.ceil(VIEWPORT_HEIGHT / ROW_HEIGHT) + OVERSCAN * 2,
  );
  const visibleStates = states.slice(visibleStart, visibleEnd);
  const selectedStateCommitment =
    execution !== null && selectedState !== undefined
      ? commitExecutionState({
          executionContextHash: execution.artifact.executionContextHash,
          transitionCount: execution.artifact.transitionCount,
          stateIndex: selectedIndex,
          state: selectedState,
        })
      : undefined;

  useEffect(() => {
    if (!isPlaying || execution === null || selectedIndex >= lastIndex) {
      if (isPlaying && selectedIndex >= lastIndex) setIsPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setSelectedIndex((current) => Math.min(current + 1, lastIndex));
      setProof(null);
      setProofVerified(null);
      setTamperedProofVerified(null);
    }, 420);
    return () => window.clearTimeout(timer);
  }, [isPlaying, execution, selectedIndex, lastIndex]);

  useEffect(() => {
    const list = traceListRef.current;
    if (list === null) return;
    if (selectedIndex < visibleStart || selectedIndex >= visibleEnd) {
      list.scrollTop = Math.max(0, (selectedIndex - 2) * ROW_HEIGHT);
    }
  }, [selectedIndex, visibleStart, visibleEnd]);

  const selectExample = (value: string) => {
    setExampleId(value);
    if (value === "custom") {
      invalidateExecution();
      return;
    }
    const invalidExample = Object.entries(VALIDATION_EXAMPLES).find(
      ([name]) => name === value,
    )?.[1];
    if (invalidExample !== undefined) {
      setSource(invalidExample.source);
      setInputValues(["0", "0", "0", "0", "0", "0", "0", "0"]);
      setBudgetText("63");
      invalidateExecution();
      return;
    }
    try {
      const example = createExample(value);
      setSource(getExampleSource(value));
      setInputValues(example.publicInput.map((item) => item.toString(10)));
      setBudgetText(String(example.recommendedBudget));
      invalidateExecution();
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "Example could not be loaded.");
    }
  };

  const runProgram = () => {
    invalidateExecution();
    if (!validation.ok) {
      setRunError(validation.message);
      return;
    }
    try {
      const artifact = generateTraceCommitment({
        program: validation.program,
        publicInput: validation.publicInput,
        transitionCount: validation.budget,
      });
      const nextExecution: ExecutionView = Object.freeze({
        artifact,
        program: validation.program,
        publicInput: validation.publicInput,
        states: Object.freeze(artifact.states.map((state) => parseStateJson(state))),
      });
      setExecution(nextExecution);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "The bounded VM run failed.");
    }
  };

  const generateProof = () => {
    if (execution === null) return;
    try {
      const nextProof = createExecutionStateProof({
        trace: execution.artifact,
        stateIndex: selectedIndex,
      });
      const verified = verifyStateProofForExecution(nextProof, execution);
      setProof(nextProof);
      setProofVerified(verified);
      setTamperedProofVerified(null);
    } catch (error) {
      setProof(null);
      setProofVerified(false);
      setTamperedProofVerified(null);
      setRunError(error instanceof Error ? error.message : "Inclusion proof generation failed.");
    }
  };

  const verifyProofAgain = () => {
    if (proof === null || execution === null) return;
    setProofVerified(verifyStateProofForExecution(proof, execution));
    setTamperedProofVerified(null);
  };

  const testTamperedProof = () => {
    if (proof === null || execution === null) return;
    const firstSibling = proof.siblingsBottomUp[0];
    if (firstSibling === undefined) {
      setTamperedProofVerified(false);
      return;
    }
    const firstNibble = firstSibling[2] === "0" ? "1" : "0";
    const alteredProof = {
      ...proof,
      siblingsBottomUp: [
        `0x${firstNibble}${firstSibling.slice(3)}`,
        ...proof.siblingsBottomUp.slice(1),
      ],
    };
    setTamperedProofVerified(verifyStateProofForExecution(alteredProof, execution));
  };

  const prepareClaim = () => {
    if (execution === null || !execution.artifact.haltedWithinBudget) return;
    try {
      setClaimSubmission(buildPhase5ClaimSubmission(execution.artifact));
      setRunError(null);
    } catch (error) {
      setClaimSubmission(null);
      setRunError(error instanceof Error ? error.message : "Claim payload preparation failed.");
    }
  };

  const runDishonestScenario = () => {
    try {
      setDishonestScenario(createDishonestTraceScenario());
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "Test scenario could not be built.");
    }
  };

  const updateSource = (value: string) => {
    setSource(value);
    setExampleId("custom");
    invalidateExecution();
  };

  const updateInput = (index: number, value: string) => {
    setInputValues((current) =>
      current.map((entry, itemIndex) => (itemIndex === index ? value : entry)),
    );
    setExampleId("custom");
    invalidateExecution();
  };

  const changeBudget = (value: string) => {
    setBudgetText(value);
    setExampleId("custom");
    invalidateExecution();
  };

  const downloadBundle = () => {
    if (execution === null) return;
    downloadFile(
      "bisect-execution-bundle.json",
      serializeStudioExport(execution.artifact, source, proof, claimSubmission),
    );
  };

  const downloadProof = () => {
    if (proof === null) return;
    downloadFile("bisect-state-proof.json", exportExecutionStateProof(proof));
  };

  const downloadClaim = () => {
    if (claimSubmission === null) return;
    downloadFile(
      "bisect-phase5-claim-submission.json",
      serializePhase5ClaimExport(claimSubmission),
    );
  };

  return (
    <div className="program-studio">
      <div className="callout studio-readonly-note" role="note">
        <ShieldCheck size={17} aria-hidden="true" />
        <span>
          Runs execute the bounded BISECT VM and commitment code in this browser. No uploaded code,
          JavaScript execution, wallet signature, or transaction is involved.
        </span>
      </div>

      <div className="studio-editor-grid">
        <section className="card pad studio-editor-card" aria-labelledby="studio-editor-title">
          <div className="section-head">
            <div>
              <p className="eyebrow">01 / Program</p>
              <h2 id="studio-editor-title">Instruction editor</h2>
            </div>
            <FileCode2 className="feature-icon" size={19} aria-hidden="true" />
          </div>
          <label className="studio-field-label" htmlFor="studio-example">
            Start from an example
          </label>
          <select
            id="studio-example"
            className="input studio-example-select"
            value={exampleId}
            onChange={(event) => selectExample(event.currentTarget.value)}
          >
            <option value="custom">Custom program</option>
            <optgroup label="Runnable VM programs">
              {RUNNABLE_EXAMPLES.map((name) => (
                <option value={name} key={name}>
                  {EXAMPLE_LABELS[name]}
                </option>
              ))}
            </optgroup>
            <optgroup label="Validation test cases">
              {Object.entries(VALIDATION_EXAMPLES).map(([name, example]) => (
                <option value={name} key={name}>
                  {example.label}
                </option>
              ))}
            </optgroup>
          </select>
          <label className="studio-field-label" htmlFor="studio-source">
            BISECT assembly
          </label>
          <textarea
            id="studio-source"
            className="studio-code-editor resize-none"
            value={source}
            onChange={(event) => updateSource(event.currentTarget.value)}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-invalid={!validation.ok && validation.field === "program"}
            aria-describedby="studio-validation"
            data-testid="studio-source"
          />
          <p className="studio-hint">
            Fixed VM instructions only. Labels and signed relative offsets are supported; comments
            start with <code>;</code> or <code>#</code>.
          </p>
          <p
            className={validation.ok ? "studio-validation good" : "studio-validation error"}
            id="studio-validation"
            role={validation.ok ? "status" : "alert"}
            data-testid="studio-validation"
          >
            {validation.ok
              ? "Valid program · " +
                validation.program.instructions.length +
                " instruction" +
                (validation.program.instructions.length === 1 ? "" : "s") +
                " · up to 128"
              : validation.message}
          </p>
        </section>

        <section className="card pad studio-input-card" aria-labelledby="studio-input-title">
          <div className="section-head">
            <div>
              <p className="eyebrow">02 / Public context</p>
              <h2 id="studio-input-title">Registers and budget</h2>
            </div>
            <span className="chip">uint64 × 8</span>
          </div>
          <p className="small muted">
            Values are decimal strings and retain full uint64 precision. These become the VM's
            initial registers.
          </p>
          <div className="studio-input-grid">
            {INPUT_LABELS.map((label, index) => (
              <label className="studio-register-field" key={label}>
                <span>{label}</span>
                <input
                  className="input"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={20}
                  aria-label={`${label} public input`}
                  aria-invalid={!validation.ok && validation.field === "public-input"}
                  aria-describedby="studio-validation"
                  value={inputValues[index] ?? ""}
                  onChange={(event) => updateInput(index, event.currentTarget.value)}
                  data-testid={`studio-input-${index}`}
                />
              </label>
            ))}
          </div>
          <label className="studio-field-label" htmlFor="studio-budget">
            Transition budget
          </label>
          <select
            id="studio-budget"
            className="input studio-budget-select"
            value={budgetText}
            onChange={(event) => changeBudget(event.currentTarget.value)}
            aria-invalid={!validation.ok && validation.field === "budget"}
            aria-describedby="studio-validation"
          >
            {APPROVED_BUDGETS.map((budget) => (
              <option value={budget} key={budget}>
                {budget.toLocaleString("en-US")} transitions · {budget + 1} states
              </option>
            ))}
          </select>
          <div className="studio-run-row">
            <button
              className="button primary"
              type="button"
              onClick={runProgram}
              disabled={!validation.ok}
              data-testid="studio-run"
            >
              <Play size={15} aria-hidden="true" />
              Run VM and build commitment
            </button>
            <span className="small muted">Local · deterministic</span>
          </div>
          {runError !== null ? (
            <p className="studio-action-error" role="alert" data-testid="studio-run-error">
              <CircleAlert size={15} aria-hidden="true" /> {runError}
            </p>
          ) : null}
        </section>
      </div>

      {execution === null ? (
        <section className="card studio-empty-result" aria-live="polite">
          <Sparkles size={19} aria-hidden="true" />
          <div>
            <h2>Ready for a reproducible run</h2>
            <p className="small muted">
              Choose an example or edit the instruction set, then run it to inspect states and
              create an ordered Merkle commitment.
            </p>
          </div>
        </section>
      ) : (
        <>
          <section className="card pad studio-result-card" aria-labelledby="studio-result-title">
            <div className="section-head">
              <div>
                <p className="eyebrow">03 / Execution result</p>
                <h2 id="studio-result-title">Run summary</h2>
              </div>
              <span className={execution.artifact.haltedWithinBudget ? "chip good" : "chip warn"}>
                {execution.artifact.haltedWithinBudget ? "HALT reached" : "Budget exhausted"}
              </span>
            </div>
            <div className="studio-summary-grid">
              <SummaryValue
                label="Output · R0"
                value={
                  execution.artifact.states[execution.artifact.transitionCount]?.registers[0] ??
                  "Unavailable"
                }
              />
              <SummaryValue
                label="HALT state"
                value={
                  execution.artifact.haltIndex === null
                    ? "Not reached"
                    : `State ${execution.artifact.haltIndex}`
                }
              />
              <SummaryValue
                label="Trace size"
                value={`${execution.artifact.leafCount.toLocaleString("en-US")} states`}
              />
              <SummaryValue label="Versions" value="Protocol 1 · VM 1 · Encoding 1" />
            </div>
            <HashValue label="Program identity" value={execution.artifact.programHash} />
            <HashValue label="Execution context" value={execution.artifact.executionContextHash} />
            <HashValue label="Ordered Merkle root" value={execution.artifact.traceRoot} />
            <div className="studio-result-actions">
              <button
                className="button"
                type="button"
                onClick={downloadBundle}
                data-testid="studio-export"
              >
                <ArrowDownToLine size={15} aria-hidden="true" /> Export execution bundle
              </button>
              {execution.artifact.haltedWithinBudget ? (
                <button
                  className="button"
                  type="button"
                  onClick={prepareClaim}
                  data-testid="studio-prepare-claim"
                >
                  <FileCode2 size={15} aria-hidden="true" />
                  {claimSubmission === null ? "Prepare Phase 5 payload" : "Refresh Phase 5 payload"}
                </button>
              ) : null}
            </div>
            {claimSubmission !== null ? (
              <div className="studio-claim-ready" role="status" data-testid="studio-claim-ready">
                <CircleCheck size={17} aria-hidden="true" />
                <div>
                  <strong>ClaimSubmission prepared locally</strong>
                  <p className="small">
                    Matches the integrated registry tuple: program, eight public inputs, transition
                    count, root, output, and authenticated initial/final proofs. Bond value is a
                    separate <code>msg.value</code> set by the deployment.
                  </p>
                  <code className="studio-calldata">{phase5ClaimCalldata(claimSubmission)}</code>
                  <button
                    className="button studio-download-claim"
                    type="button"
                    onClick={downloadClaim}
                    data-testid="studio-export-claim"
                  >
                    <ArrowDownToLine size={14} aria-hidden="true" />
                    Export unsigned claim payload
                  </button>
                  <span className="small muted">
                    Calldata prepared only. No wallet was opened and no transaction was sent.
                  </span>
                </div>
              </div>
            ) : null}
          </section>

          <div className="studio-trace-grid">
            <section className="card pad studio-trace-card" aria-labelledby="studio-trace-title">
              <div className="section-head studio-trace-heading">
                <div>
                  <p className="eyebrow">04 / Trace explorer</p>
                  <h2 id="studio-trace-title">Execution states</h2>
                </div>
                <span className="chip">
                  {execution.states.length.toLocaleString("en-US")} total
                </span>
              </div>
              <nav className="studio-trace-controls" aria-label="Trace navigation">
                <button
                  className="button"
                  type="button"
                  aria-label="Reset trace to initial state"
                  onClick={() => {
                    setIsPlaying(false);
                    setSelectedIndex(0);
                    setProof(null);
                    setProofVerified(null);
                    setTamperedProofVerified(null);
                  }}
                  disabled={selectedIndex === 0}
                >
                  <RotateCcw size={15} aria-hidden="true" /> Reset
                </button>
                <button
                  className="button"
                  type="button"
                  aria-label="Previous trace state"
                  onClick={() => {
                    setIsPlaying(false);
                    setSelectedIndex((index) => Math.max(0, index - 1));
                    setProof(null);
                    setProofVerified(null);
                    setTamperedProofVerified(null);
                  }}
                  disabled={selectedIndex === 0}
                >
                  <ChevronLeft size={16} aria-hidden="true" /> Previous
                </button>
                <button
                  className="button"
                  type="button"
                  aria-label={isPlaying ? "Pause trace playback" : "Play trace"}
                  onClick={() => {
                    if (!isPlaying) {
                      setProof(null);
                      setProofVerified(null);
                      setTamperedProofVerified(null);
                    }
                    setIsPlaying(!isPlaying);
                  }}
                  disabled={execution.states.length < 2 || selectedIndex >= lastIndex}
                >
                  {isPlaying ? (
                    <Pause size={15} aria-hidden="true" />
                  ) : (
                    <Play size={15} aria-hidden="true" />
                  )}
                  {isPlaying ? "Pause" : "Play"}
                </button>
                <button
                  className="button"
                  type="button"
                  aria-label="Next trace state"
                  onClick={() => {
                    setIsPlaying(false);
                    setSelectedIndex((index) => Math.min(lastIndex, index + 1));
                    setProof(null);
                    setProofVerified(null);
                    setTamperedProofVerified(null);
                  }}
                  disabled={selectedIndex >= lastIndex}
                >
                  Next <ChevronRight size={16} aria-hidden="true" />
                </button>
              </nav>
              <ol
                className="studio-trace-list"
                ref={traceListRef}
                aria-label={`Execution trace with ${execution.states.length} states`}
                onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
                data-testid="studio-trace-list"
              >
                {visibleStart > 0 ? (
                  <li
                    className="studio-trace-spacer"
                    aria-hidden="true"
                    style={{ height: visibleStart * ROW_HEIGHT }}
                  />
                ) : null}
                {visibleStates.map((state, offset) => {
                  const index = visibleStart + offset;
                  const prior = index > 0 ? execution.states[index - 1] : undefined;
                  const changed = changedRegisterNames(prior, state);
                  const instruction =
                    prior === undefined ? null : (execution.program.instructions[prior.pc] ?? null);
                  return (
                    <li
                      className="studio-trace-list-item"
                      key={index}
                      aria-posinset={index + 1}
                      aria-setsize={execution.states.length}
                    >
                      <button
                        className={
                          "studio-trace-row" +
                          (index === selectedIndex ? " selected" : "") +
                          (state.halted ? " halted" : "")
                        }
                        type="button"
                        data-state-index={index}
                        data-testid={
                          index === selectedIndex ? "studio-selected-trace-row" : undefined
                        }
                        aria-label={
                          "State " +
                          index +
                          " of " +
                          (execution.states.length - 1) +
                          ", PC " +
                          state.pc +
                          ", " +
                          (state.halted ? "halted" : "running")
                        }
                        aria-current={index === selectedIndex ? "step" : undefined}
                        onClick={() => {
                          setIsPlaying(false);
                          setSelectedIndex(index);
                          setProof(null);
                          setProofVerified(null);
                          setTamperedProofVerified(null);
                        }}
                      >
                        <span className="studio-state-index">{String(index).padStart(4, "0")}</span>
                        <span className="studio-state-main">
                          <strong>PC {state.pc}</strong>
                          <span>
                            {instruction === null
                              ? "Initial state"
                              : opcodeName(instruction.opcode)}
                          </span>
                        </span>
                        <span className="studio-state-changes">
                          {changed.length === 0 ? "—" : changed.join(" · ")}
                        </span>
                        <span
                          className={state.halted ? "studio-halt-tag active" : "studio-halt-tag"}
                        >
                          {state.halted ? "HALTED" : "RUNNING"}
                        </span>
                      </button>
                    </li>
                  );
                })}
                {visibleEnd < execution.states.length ? (
                  <li
                    className="studio-trace-spacer"
                    aria-hidden="true"
                    style={{ height: (execution.states.length - visibleEnd) * ROW_HEIGHT }}
                  />
                ) : null}
              </ol>
              <p className="studio-list-foot" aria-live="polite">
                Showing states {visibleStart + 1}–{visibleEnd} of {execution.states.length} ·
                selected {selectedIndex}
              </p>
            </section>

            <section className="card pad studio-state-card" aria-labelledby="studio-state-title">
              <div className="section-head">
                <div>
                  <p className="eyebrow">Selected state</p>
                  <h2 id="studio-state-title">State {selectedIndex}</h2>
                </div>
                {selectedState?.halted ? (
                  <span className="chip good">HALTED</span>
                ) : (
                  <span className="chip">RUNNING</span>
                )}
              </div>
              <div className="studio-state-metadata">
                <span>
                  <small>Program counter</small>
                  <strong>{selectedState?.pc ?? "—"}</strong>
                </span>
                <span>
                  <small>Transition into this state</small>
                  <strong>
                    {previousInstruction === null
                      ? "Initial"
                      : String(previousInstruction.index).padStart(3, "0") +
                        " · " +
                        opcodeName(previousInstruction.opcode)}
                  </strong>
                </span>
                <span>
                  <small>Register changes</small>
                  <strong>
                    {changedRegisters.length === 0 ? "None" : changedRegisters.join(", ")}
                  </strong>
                </span>
              </div>
              <div className="studio-register-table-wrap">
                <table className="studio-register-table">
                  <caption className="sr-only">Registers in state {selectedIndex}</caption>
                  <thead>
                    <tr>
                      <th scope="col">Register</th>
                      <th scope="col">Exact uint64 value</th>
                      <th scope="col">Changed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {INPUT_LABELS.map((label, index) => {
                      const changed = changedRegisters.includes(label);
                      return (
                        <tr className={changed ? "changed" : ""} key={label}>
                          <th scope="row">{label}</th>
                          <td>
                            <code>{selectedState?.registers[index]?.toString(10) ?? "—"}</code>
                          </td>
                          <td>
                            {changed ? <span className="studio-change-mark">Updated</span> : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {selectedStateCommitment !== undefined ? (
                <div className="studio-selected-hash">
                  <HashValue
                    label="Canonical state hash"
                    value={selectedStateCommitment.stateHash}
                  />
                  <HashValue label="Indexed leaf hash" value={selectedStateCommitment.leafHash} />
                </div>
              ) : null}
              <div className="studio-proof-actions">
                <button
                  className="button primary"
                  type="button"
                  onClick={generateProof}
                  data-testid="studio-generate-proof"
                >
                  <ShieldCheck size={15} aria-hidden="true" /> Generate inclusion proof
                </button>
                {proof !== null ? (
                  <>
                    <button
                      className="button"
                      type="button"
                      onClick={verifyProofAgain}
                      data-testid="studio-verify-proof"
                    >
                      Verify proof locally
                    </button>
                    <button
                      className="button"
                      type="button"
                      onClick={testTamperedProof}
                      data-testid="studio-test-invalid-proof"
                    >
                      Test a tampered proof
                    </button>
                    <button
                      className="button"
                      type="button"
                      onClick={downloadProof}
                      data-testid="studio-export-proof"
                    >
                      <ArrowDownToLine size={14} aria-hidden="true" /> Export proof
                    </button>
                  </>
                ) : null}
              </div>
              {proof !== null ? (
                <div
                  className="studio-proof-feedback"
                  aria-live="polite"
                  data-testid="studio-proof-feedback"
                >
                  {proofVerified === true ? (
                    <p className="good">
                      <Check size={15} aria-hidden="true" /> Proof verified for state{" "}
                      {proof.stateIndex} against this program, input, budget, context, and root.
                    </p>
                  ) : proofVerified === false ? (
                    <p className="error">
                      <CircleAlert size={15} aria-hidden="true" /> Invalid proof: the supplied path
                      does not authenticate this state under the expected root.
                    </p>
                  ) : (
                    <p>
                      Proof generated. Run the local verifier to check its context and ordered
                      sibling path.
                    </p>
                  )}
                  {tamperedProofVerified === false ? (
                    <p className="error" data-testid="studio-invalid-proof-result">
                      <CircleAlert size={15} aria-hidden="true" /> Tamper test rejected: changing
                      one sibling hash breaks the root.
                    </p>
                  ) : tamperedProofVerified === true ? (
                    <p className="error">Unexpected result: the altered sibling path verified.</p>
                  ) : null}
                  <p className="small muted">
                    Membership shows that a state and index belong to this root. It does not prove
                    that every transition in the trace is valid.
                  </p>
                </div>
              ) : null}
            </section>
          </div>
        </>
      )}

      <details className="card pad studio-dishonest-scenario">
        <summary>
          <span>
            <strong>Test scenario: correct output, altered intermediate state</strong>
            <small>
              Deliberately dishonest trace · local only · no protocol outcome is simulated
            </small>
          </span>
          <span className="chip warn">Test only</span>
        </summary>
        <div className="studio-scenario-content">
          <p className="small muted">
            This fixed addition example changes only R7 after the first transition. The modified
            trace is independently hashed and its state proof is genuinely verified against that
            altered root. The computation's output stays 12, while the first transition is invalid.
            Merkle inclusion alone does not establish correct execution.
          </p>
          <button
            className="button"
            type="button"
            onClick={runDishonestScenario}
            data-testid="studio-run-dishonest-scenario"
          >
            Build test-only altered trace
          </button>
          {dishonestScenario !== null ? (
            <div
              className="studio-scenario-result"
              role="status"
              data-testid="studio-dishonest-result"
            >
              <div className="studio-scenario-badges">
                <span className="chip good">
                  Membership proof: {dishonestScenario.membershipVerified ? "verified" : "failed"}
                </span>
                <span className="chip warn">
                  First transition: {dishonestScenario.transitionValid ? "valid" : "invalid"}
                </span>
                <span className="chip">
                  Final output: {dishonestScenario.outputPreserved ? "unchanged · 12" : "changed"}
                </span>
              </div>
              <HashValue label="Test-only altered root" value={dishonestScenario.traceRoot} />
              <div className="studio-scenario-states">
                <span>
                  <small>Canonical S[1]</small>
                  <code>{dishonestScenario.expectedState.registers[7]}</code>
                </span>
                <span>
                  <small>Committed test S[1]</small>
                  <code>{dishonestScenario.alteredState.registers[7]}</code>
                </span>
                <span>
                  <small>Proof state index</small>
                  <code>{dishonestScenario.alteredStateProof.stateIndex}</code>
                </span>
              </div>
              <p className="small muted">
                The altered root is not an execution commitment for the honest VM run and is never
                used to prepare a claim payload.
              </p>
            </div>
          ) : null}
        </div>
      </details>
    </div>
  );
}

function SummaryValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="studio-summary-value">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function HashValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="studio-hash-row">
      <span>{label}</span>
      <code title={value}>{value}</code>
    </div>
  );
}

function changedRegisterNames(previous: State | undefined, current: State | undefined): string[] {
  if (previous === undefined || current === undefined) return [];
  return INPUT_LABELS.filter((_, index) => previous.registers[index] !== current.registers[index]);
}

function verifyStateProofForExecution(proof: unknown, execution: ExecutionView): boolean {
  return verifyExecutionStateProof({
    proof,
    program: execution.artifact.programHex,
    publicInput: execution.artifact.publicInput,
    transitionCount: execution.artifact.transitionCount,
    expectedRoot: execution.artifact.traceRoot,
  });
}

function downloadFile(filename: string, contents: string): void {
  const blobUrl = URL.createObjectURL(
    new Blob([contents], { type: "application/json;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
}
