# BISECT Phase 1 and Phase 2 retrospective audit

**Audit date:** 2026-10-31

**Repository:** `D:\Bisect`

**Scope:** Phase 1 protocol specification and Phase 2 TypeScript VM implementation. This audit did not begin Phase 3.

## Result

- **Phase 1: VM, encoding, and dispute specification — PASS.** Versioned v1 semantics and the required Merkle/bisection rules are explicit and internally consistent.
- **Phase 2: deterministic TypeScript VM — PASS.** The implementation matches the locked VM/encoding behavior covered by the tests and CLI runs below. One asynchronous CLI output defect was corrected and regression-tested during this audit.
- **Merkle readiness — PASS for v1 design and VM-local implementation.** Tree rules are locked, and root/proof generation and verification are implemented in `packages/vm`. The standalone `@bisect/merkle` package is still a Phase 3 extraction placeholder.
- **Solidity verifier, dispute execution, deployment, audit — NOT IMPLEMENTED.** These are not claimed complete by this audit. There is no TypeScript/Solidity parity evidence yet.

## Phase 1 specification audit

`docs/vm-spec.md` is explicitly locked to VM v1 by its opening status declaration (line 3). It defines exactly eight `uint64` registers, `uint16` instruction-index PC, boolean halt flag, fixed four-byte instructions, 1–128 instructions, eight public inputs, and budgets `{63,255,1023,4095}` with exactly `N+1` states (section 1, lines 5–15). Initial registers equal the public input, PC starts at zero, and output is final `R[0]`.

The program wire format, static validation order, reserved bytes, register bounds, and possible successor checks are explicit in `docs/vm-spec.md` section 2, lines 17–29. The ten opcodes and their operands are defined in section 3, lines 31–48. In particular, `JNZ` uses a signed big-endian 16-bit offset relative to the **current** PC; sequential execution uses `pc+1`; arithmetic wraps modulo `2^64`; `HALT` retains PC/registers; and halted states stutter. Section 4, lines 50–61, defines execution and the successful halt requirement. Section 5, lines 63–67, defines deterministic error categories and precedence.

Canonical encodings are normative in `docs/encoding-spec.md`:

- Version identifiers and canonical ABI field types/order: sections 1–2, lines 5–17.
- Keccak-256 domain-separated program, input, context, state, leaf, and node hashes: section 3, lines 19–63. Program identity includes VM version, exact byte length and bytes; input identity includes encoding version and all eight inputs; context binds protocol/VM/encoding versions, program/input hashes, `N`, and `L`; each leaf binds context, exact state index, and state.
- Ordered binary Merkle construction, no padding, bottom-up sibling order, index-bit left/right orientation, and exact proof depths 6/8/10/12: section 4, lines 65–75.
- Initial-state and final halted-output proofs: section 5, lines 78–85.
- Machine-readable compatibility vectors: section 6 and `docs/protocol-vectors.json`.

The protocol requires context/index-bound leaf proofs to authenticate exact state/index pairs; version, input, program, and trace-length binding is therefore specified. JSON presentation is decimal-string-safe in the VM API; protocol hashes use ABI encodings and do not depend on JSON serialization.

The dispute specification in `docs/dispute-state-machine.md` defines equal canonical initial states, ordered child reveals, and a left-first descent (sections 3.2–3.3, lines 39–58). This preserves the common low boundary algorithmically: index zero is proven equal, and descending into the left differing subtree whenever possible identifies the _smallest_ differing state index `k`; therefore `k >= 1`, and `k-1` is the shared predecessor under the hash assumptions. The protocol does not need to carry a separate mutable “low boundary” record. Terminal proofs authenticate both parties’ states at `k-1` and `k`, require predecessor equality, and verify the prover’s unique successor (section 3.4, lines 60–71).

Timeouts, inclusive response deadlines, retry behavior, and exact settlement paths are specified in sections 3.5–3.7 and 4–5. `docs/protocol-v1.md` states the invariants and conditional liveness assumptions. `docs/security-model.md` records chain inclusion/reorganization assumptions, bond and window choices, watcher/data-availability limits, and bounded resource risks. No contradiction or unresolved consensus-semantic ambiguity was found in the reviewed v1 documents.

## Phase 2 implementation audit

Implementation and test evidence:

- **Versioned constants and approved budgets:** `packages/vm/src/types.ts:1-10`; budget and protocol-vector tests in `tests/unit/vm.test.ts:201-220,272-313`.
- **Parsing, all-instruction validation, deterministic error categories:** `packages/vm/src/program.ts:23-120`; `tests/unit/vm.test.ts:41-79` covers malformed length, 128-instruction limit, opcode, register, reserved operand, and branch validation.
- **Eight-register state, input validation, exact integer conversion:** `packages/vm/src/state.ts:5-88`; input range and unsafe Number checks in `tests/unit/vm.test.ts:182-190`.
- **All ten transitions, wrapping arithmetic, current-PC branch, HALT/stutter:** `packages/vm/src/machine.ts:6-90`; per-opcode tests at `tests/unit/vm.test.ts:81-118`, wrap tests at 119–136, JNZ at 138–159, and halt at 161–170.
- **Bounded execution, halt index, output, and precisely `N+1` states:** `packages/vm/src/executor.ts:24-100`; trace and budget tests at `tests/unit/vm.test.ts:193-240`.
- **ABI/Keccak hashes, context and indexed leaves, root/proofs:** `packages/vm/src/encoding.ts:16-184`; known-answer tests at `tests/unit/vm.test.ts:272-342`, with all four proof depths exercised at 201–218.
- **BigInt-safe canonical JSON and repeatability:** `packages/vm/src/encoding.ts:186-192` and `packages/vm/src/state.ts:53-65`; repeatability and max-uint64 serialization at `tests/unit/vm.test.ts:262-269`.
- **Assembler, examples, and CLI:** `packages/vm/src/assembler.ts`, `packages/vm/src/examples.ts`, and `packages/vm/src/cli.ts`; assembler round trip and CLI async-write regression at `tests/unit/vm.test.ts:343-400`; actual CLI executions listed below.

All `uint64` values are `bigint` internally. `Number` is limited to bounded control/index/byte values and rejects unsafe public input Numbers; JSON encodes register values as base-10 strings. The transition function uses explicit modulo `2^64` arithmetic for add, subtract, and multiply. The validator rejects malformed and oversized bytecode before execution, and both possible `JNZ` successors are checked. `execute` rejects nonhalting runs as `BUDGET_EXHAUSTED`; bounded `traceProgram` remains available for a deterministic nonhalting trace. Post-HALT execution repeats the same state, yielding exactly `N+1` entries.

The test suite covers all opcodes, arithmetic boundaries, taken/not-taken branches, malformed programs and invalid inputs, trace budgets, halt/stutter, deterministic replay, examples, seeded generated programs, serialization, and the v1 known-answer vectors. The vectors include exact domain/hash values, ABI input bytes, sampled states/leaves, root and proof siblings.

## Corrections made during audit

1. In `packages/vm/src/cli.ts`, `validate` and `inspect` now await optional output-file writes. Previously the asynchronous writes were started without awaiting them, so a write failure could evade the normal CLI error path. `tests/unit/vm.test.ts` now calls both commands and reads/parses their output files immediately, providing a regression test.
2. The audit added/retained explicit proof-depth generation and verification checks for each approved trace size in `tests/unit/vm.test.ts`.
3. `docs/architecture.md` now consistently says that VM-local v1 trace roots and proofs are implemented while the dedicated package and Solidity parity remain planned. `packages/merkle/README.md` and `packages/merkle/src/index.ts` identify the package as a Phase 3 extraction placeholder instead of implying that the v1 tree design itself is unimplemented.

No normative v1 behavior or contract code was changed.

## Merkle design readiness

The Merkle format is **specified and implemented inside `@bisect/vm`**, not merely specified: generation builds indexed leaves in order, pairs left/right nodes without sorting or padding, and verification uses index bits to orient bottom-up siblings. `computeTraceRoot`, `createMerkleProof`, and `verifyMerkleProof` enforce allowed leaf counts/depths; known-answer and proof tests pass for all four budgets. This is enough to preserve the locked design and proceed with the planned Phase 3 standalone extraction/integration. `packages/merkle` has no standalone API yet. Solidity-compatible Merkle code, cross-language vectors, and contract dispute execution remain future work.

## Actual verification results

Commands executed from `D:\Bisect` after the audit corrections:

- `pnpm lint` — **PASS**; Biome checked 85 files with no fixes required.
- `pnpm format:check` — **PASS**; Biome checked 85 files.
- `pnpm typecheck` — **PASS**; all present workspace typecheck scripts exited successfully.
- `pnpm test` — **PASS**; 2 test files and 30 tests passed.
- `pnpm build` — **PASS**; VM TypeScript build and Next.js 16.4.3 production build; static `/` and `/_not-found` generated.
- `pnpm bisect vm --help` — **PASS**; help lists all five commands and input/budget constraints.
- `pnpm bisect vm validate example:increment` — **PASS**; valid, two instructions.
- `pnpm bisect vm inspect example:sum` — **PASS**; emitted 11 decoded instructions.
- `pnpm bisect vm disassemble example:fibonacci` — **PASS**; emitted the 12-instruction readable program.
- `pnpm bisect vm run example:addition --input '[7,5,0,0,0,0,0,0]' --budget 63` — **PASS**; output `12`, halt index `2`, 64 states; real program/input/context hashes and trace root emitted.
- `pnpm bisect vm trace example:nonterminating --input '[1,0,0,0,0,0,0,0]' --budget 63 --output <temp file>` — **PASS**; output file parsed; 64 leaves, `haltedWithinBudget=false`, no halt index. Temporary file removed.

The unit suite also exercises `validate` and `inspect` file output paths. This audit did not rerun database, Playwright, Foundry, Anvil, or Base Sepolia checks; no contract, database, or frontend code was part of the audited VM changes. Their latest environment status must be taken from the separate environment-verification records, not inferred from these results.

## Remaining security assumptions and risks

- Ethereum Keccak-256 collision/second-preimage resistance and exact Solidity ABI/EVM behavior are assumed. TypeScript vectors have no independent Solidity implementation to compare against yet.
- A correct TypeScript implementation is not a verifier contract. Contract-level parsing, gas bounds, state/accounting invariants, adversarial financial tests, and an independent audit are still required.
- Trace contents are off-chain. An honest challenger must independently reconstruct and retain the trace/tree and get challenge/response transactions included before block deadlines. A never-challenged false claim can finalize under optimistic assumptions.
- Chain liveness, transaction inclusion, RPC availability, and deployment-specific challenge/turn windows affect whether an honest challenge can complete. Reorganizations can roll back results.
- Seeded randomized tests are reproducible coverage, not exhaustive verification or a formal proof. No deployment, audit, or production-security claim is made.

## Phase 3 decision

**GO for Phase 3.** The locked design and Phase 2 VM implementation passed this retrospective audit, and the VM-local Merkle code plus protocol vectors provide a compatibility baseline for the planned standalone Merkle package work. Phase 3 has **not** started in this audit. Its work must preserve the locked formats and add package-level and, when a Solidity implementation exists, cross-language compatibility tests. This GO decision is not approval to deploy or use real funds.
