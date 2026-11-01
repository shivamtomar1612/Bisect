# Development progress

## 2026-11-01 — Phase 14 interactive bisection visualizer

- Added a confirmed dispute-event timeline API, ordered child-hash replay verifier, real dispute route, accessible interval visualizer, and clearly labeled 1,023-transition educational simulation.
- Measured the simulation with 10 actual Merkle reductions to the altered state at index 700. The underlying VM/SDK data is real; its rounds are simulated and no financial outcome is claimed.
- `pnpm test` passed 65 tests; web/indexer typechecks, production build, 3 Chromium visualizer tests, PostgreSQL health and Anvil/PostgreSQL indexer integration passed. Repository-wide lint/format still fail on pre-existing Windows CRLF checkout formatting.
- No configured Base Sepolia deployment or indexed completed bisection is available for a real browser replay. See [phase-14-report.md](phase-14-report.md).

## 2026-11-01 — Phase 13 challenger interface

- Added a claim challenger route with on-chain context inspection, independent VM/Merkle replay, exact-bond challenge submission, ordered-child bisection moves, terminal proof submission, timeout action and live game/credit views.
- Added challenger evidence unit tests. `pnpm test` passed 61 tests; targeted Foundry dispute suite passed 10 tests; workspace typecheck, final production build, 2 Chromium challenger-route tests and targeted formatting/lint passed. The existing isolated Anvil dispute walkthrough mined 21 real transactions across 6 rounds with a challenger victory and actual withdrawal. Repository-wide lint/format remain blocked by pre-existing CRLF checkout formatting in 149 files.
- No Base Sepolia registry address or published prover trace is configured; a real browser dispute and indexed financial-history walkthrough cannot be claimed. See [phase-13-report.md](phase-13-report.md).

## 2026-11-01 — Phase 12 wallet and account ledger implementation

- Added external wallet connection and chain switching, live contract-backed claim submission and pull withdrawal, pending/confirmed/reverted transaction states, and exact wei account views.
- Added a validated, read-only account ledger API over the Phase 8 indexer and confirmed activity CSV export.
- No Base Sepolia registry address has been deployed/configured yet. Public-network financial transaction verification remains pending; the UI does not invent it. See [phase-12-report.md](phase-12-report.md).
- Web typecheck and production build passed; 58 unit tests, 55 Foundry tests and 21 Chromium checks passed (18 existing plus 3 Phase 12 checks). Targeted changed-file Biome check passed. Repository-wide lint/format checks failed on Windows CRLF line endings in untouched files. The protocol remains unaudited.

## 2026-11-01 — Phase 6A trace integrity and data availability

### Completed

- Added `docs/trace-integrity-specification.md` defining same-output intermediate fraud, context-bound challenger and prover witnesses, the exact v1 mismatch proof path, trace publication/retrieval/retention assumptions, and consequences for unavailable data.
- Preserved locked v1 semantics. No contract transition or settlement rule changed: challenges still open with a different context-bound root plus canonical initial-state proof, then ordered child hashes isolate the leftmost mismatch and the verifier checks the prover transition.
- Made the same-output fraud assertion explicit; added Foundry coverage for an alternate challenger root with a different final output, forged initial membership evidence, and withheld prover response with deadline and single-settlement accounting checks.
- Extended `packages/sdk/scripts/phase6-anvil.mts` to mine a complete proof-based same-output fraud game and a separate real prover-timeout game using Anvil test ETH.
- Added ADR-0014 and updated architecture/security documentation. The two-location trace archive profile is operational guidance only; no archive service, manifest index, or retention monitor was added.

### Verification

- `pnpm check:phase6` — passed, exit 0: lint, formatting, all 7 workspace typechecks, 41 Vitest tests, all package and Next.js production builds, Foundry compilation, vector regeneration, 36 Foundry tests, and the expanded Anvil run.
- Foundry suites: 10 dispute tests, 8 verifier tests, 16 claim registry tests, 1 OpenZeppelin smoke test, and 1 accounting invariant test passed. The invariant completed 256 runs and 128,000 calls with zero reverts or invariant failures.
- Mined Anvil run: 21 successful transactions. The same-output fraudulent intermediate trace was isolated at state 1 in 6 rounds; the challenger received and withdrew 2 ETH. A separate withheld-response game settled after timeout, crediting 2 ETH to the challenger. Final escrow: 0 locked, 2 ETH credits/liabilities/balance; accounting invariant true. Full measurements are in [`phase-6a-report.md`](phase-6a-report.md).

### Readiness and remaining risks

- **Phase 6A local trace-integrity verification: PASS.** Same-output fraud is provable; missing proposer data during a game follows the locked timeout path.
- The archive/manifest policy is not enforced by Solidity and has no implemented service. An unchallenged invalid claim can still finalize if no honest challenge is included before the challenge deadline. Chain inclusion, monitoring, independent audit, and Base Sepolia operations remain unverified; deployment/meaningful-fund use remains **NO-GO**.

## 2026-11-01 — Phase 6 interactive dispute and financial settlement

### Completed

- Implemented `contracts/src/BisectDisputeRegistryV1.sol` as a non-upgradeable derived registry. It enables exact-bond claims, distinct-root challenges with the locked v1 initial-state proof, child-hash bisection, authenticated terminal states, Solidity one-step adjudication, turn timeouts, retry fencing, finalization, and pull-credit bond settlement.
- Preserved v1 leftmost-difference selection using ordered child-subtree hashes. The opening witness and bisection remain exactly as locked in `docs/dispute-state-machine.md`; no midpoint-state search or protocol-semantic change was introduced.
- Added TypeScript-generated cross-language dispute vectors, eight Foundry dispute tests, generated SDK ABI and typed reader/writer API, a complete isolated Anvil transaction test, and an Anvil test step in the contract CI job.
- Added ADR-0013 for per-call `gameNumber` stale-call rejection; it is an ABI replay fence only. Updated requirements, architecture, security model, setup/status docs, and `docs/phase-6-integration-contract.md`.
- Did not implement wallet custody, database financial ledger, automatic challenger service, or testnet deployment. The Account Ledger addendum remains pending.

### Verification

- `pnpm check:phase6` — passed, exit 0: lint, formatting, all 7 workspace typechecks, 41 Vitest tests across 5 files, TypeScript package builds, Next.js production build, Foundry build and tests, regenerated TypeScript/Solidity vectors, and mined Anvil game.
- Foundry `1.8.7` / Solidity `0.8.30`: 34 tests passed across five suites. The accounting invariant completed 256 runs and 128,000 handler calls with no reverts or invariant failures. Two verifier fuzz tests ran 256 cases each.
- After the final Anvil `PATH` discovery adjustment, `pnpm --filter @bisect/sdk typecheck`, `pnpm lint`, `pnpm format:check`, `forge fmt --root contracts --check`, and `pnpm phase6:anvil` passed again.
- The Anvil run mined 18 transactions on chain ID 31337, isolated the first differing state at index 1 in 6 rounds, and settled 2 ETH of pull credit to the challenger. Actual gas and wei balance measurements are recorded in `docs/phase-6-report.md`.
- `.github/workflows/ci.yml` now includes the local Anvil dispute run. GitHub-hosted CI was not run from this workstation.

### Readiness and remaining risks

- **Phase 6 local implementation and verification: PASS.** The integrated game is tested with local real transactions and test ETH; it has not been deployed to Base Sepolia.
- **Deployment or meaningful-fund use: NO-GO.** There is no independent audit, production data-availability/challenger operation, or reviewed Base Sepolia bond/window configuration.
- Full maximum-budget game execution and a separate full dispute-lifecycle invariant handler remain unimplemented. See [`phase-6-report.md`](phase-6-report.md) for the measured Anvil run, exact checks, and assumptions.

## 2026-10-31 — Phase 5.5 pre-dispute security gate and Phase 6 design

### Completed

- Audited the actual Phase 5 contract and found that endpoint-only claims could be finalized without an implemented challenge path. Disabled public claim admission and finalization in the base registry; a revert prevents both false claim finality and deposits that would otherwise have no production settlement path.
- Retained the checked claim-validation and exact-wei accounting flow as internal helpers for an integrated derived contract. The Foundry-only harness exposes those internals for tests; it is not a production settlement path.
- Added a TypeScript-generated same-output fraud vector: an intermediate state is invalid, the trace root differs, and the final halted output remains the honest value. Added Solidity regression coverage and a base-contract deposit-rejection test.
- Added `docs/phase-5-5-security-gate.md`, `docs/phase-6-integration-contract.md`, and `docs/phase-6-security-checklist.md`; corrected status claims in README, architecture, requirements, security model, Phase 5 report, and this progress log.
- Fixed duplicate decision numbering and recorded the fail-closed base and single-contract Phase 6 integration decisions. No VM/Merkle semantics or Phase 6 game code changed.
- Confirmed the Account Ledger addendum and its architecture, policy, and invariant documents remain absent. No ledger behavior was inferred or implemented.

### Verification

- `pnpm claims:vectors` — passed; regenerated the honest endpoint vectors plus same-output fraud fixture using the TypeScript VM/Merkle packages.
- Targeted `BisectClaimRegistryTest` — 16 passed, including exact bond/accounting coverage, base registry deposit rejection, and the same-output fraud case.
- `pnpm check:phase5` — final run passed: lint, formatting, 7 workspace typechecks, 41 Vitest tests, VM/Merkle/SDK/Next.js builds, Foundry build/ABI generation, vector regeneration, and 26 Foundry tests across four suites.
- Foundry invariant — 256 runs, 128,000 handler calls, no reverts or invariant failures.
- The initial aggregate run exposed an existing maximum-budget VM test exceeding Vitest's 5-second default on this Windows environment. Raised only that test's timeout to 15 seconds; standalone and aggregate test runs then passed. No VM execution logic changed.
- Standalone `pnpm lint` — passed on 106 files with 56 informational suggestions and no errors; `pnpm format:check` — passed on 106 files; `pnpm typecheck` — 7 workspace packages passed; `pnpm test` — 41 passed; `pnpm build` — VM/Merkle/SDK/Next production builds passed.
- `pnpm e2e` — 1 Playwright Chromium test passed. `forge fmt --check --root contracts` — passed. Targeted registry tests — 16 passed.

### Readiness

- **Phase 5.5 gate: PASS** for fail-closed base behavior and documented Phase 6 integration requirements.
- **Phase 6 implementation: GO** within the three Phase 6 documents and locked `docs/dispute-state-machine.md`.
- **Deployment/funding: NO-GO.** The base registry cannot accept claims, and no integrated game is implemented. No testnet deployment, live gas claim, or independent audit is claimed.
- The Account Ledger, wallet custody, database financial journal, dispute game, and challenger service remain separate future work.

## 2026-10-31 — Phase 5 bonded claim registry and pull escrow (initial implementation; superseded by Phase 5.5 gate)

### Completed

- Initially added `contracts/src/BisectClaimRegistry.sol` with immutable settings, exact prover bond submission, full v1 program/context validation, authenticated initial/terminal proofs, sequential IDs, duplicate prevention, block deadlines, pull credits, and caller-only withdrawals guarded by OpenZeppelin `ReentrancyGuard`. The later Phase 5.5 gate disabled public claim submission and finalization until the dispute game exists.
- Added exact liability accounting (`totalLockedBonds`, `totalCredits`, `totalLiabilities`) with a solvency view. Fees are zero, plain ETH transfers revert, forced ETH is not credited, and there is no administrator withdrawal path.
- Reused the locked ordered Merkle verifier through an internal state-proof API. No VM, trace encoding, or dispute semantics changed. Added the Foundry-generated `@bisect/sdk` ABI and typed viem reader/writer wrappers; SDK callers provide their own clients and keys.
- Generated Solidity endpoint proof fixtures by executing the TypeScript VM/Merkle packages. Added adversarial financial tests and a stateful accounting invariant test.
- Updated requirements, architecture, README, decisions, and `docs/phase-5-verification-report.md`.

### Verification

- `pnpm check:phase5` — passed. Biome lint checked 103 files with 56 informational suggestions and no errors; formatting checked 103 files; all 7 workspace typechecks passed; Vitest passed 41 tests across 5 files; VM/Merkle/SDK/Next.js production builds passed; Foundry compilation and ABI generation passed; and Foundry passed all 22 tests across 4 suites.
- The Foundry accounting invariant passed 256 runs and 128,000 handler calls with zero reverts or invariant failures. Existing verifier fuzz tests each ran 256 arithmetic/branch cases.
- `pnpm e2e` — passed: 1 Playwright Chromium test.
- `forge fmt --check --root contracts` — passed.
- Foundry invariant testing emits non-failing warnings while probing optional target-selector configuration methods; the explicit handler target was exercised successfully for all 128,000 calls.

### Limits and readiness

- At original Phase 5 close, the contract had no public challenge entrypoint or bisection game, and endpoint membership did not prove every transition. Phase 5.5 found and closed the unsafe finalization path and disabled base submissions as well. Do not deploy or fund the base contract as a live optimistic-verification service.
- No challenge bonds, retries, timeout outcomes, game settlement, wallet UI, Account Ledger addendum, deployment, live gas measurement, or independent audit were added. Foundry bond/window values are test fixtures, not public-network parameters.
- **Phase 5 scoped financial foundation: implemented. Full protocol readiness: PARTIAL.**

## 2026-10-31 — Phase 4 Solidity verifier and cross-language consistency

### Completed

- Added the stateless `contracts/src/BisectVerifier.sol` internal library. It validates the full bounded VM v1 program, recomputes all v1 program/input/context/state/leaf/node hashes from canonical values, verifies exact-depth ordered proofs for adjacent states, checks the canonical initial state at index zero, executes one deterministic transition, and compares the claimed successor.
- Added a TypeScript vector generator and shared Foundry JSON vectors for all ten opcodes, uint64 boundaries, signed branches, halt/stutter, each approved trace budget, a maximum-size 128-instruction program, and authenticated adversarial states. Solidity verifies the hashes, ABI state bytes, roots, proof paths, and valid step results generated by TypeScript.
- Added Foundry validation tests, adversarial proof/context tests, state-transition tests, and fuzz coverage for wrapping arithmetic and signed JNZ offsets. Solidity is pinned at 0.8.30; only the test vector directory is readable by Foundry tests.
- No VM v1 semantics, protocol encoding formulas, game/accounting design, wallet behavior, or custody behavior changed. No claim/game contract or deployment was added. The Account Ledger addendum remains pending and Phase 5 financial implementation was not started.

### Verification

- `pnpm contracts:build` — passed with Solc 0.8.30.
- `pnpm contracts:test` — passed: 9 Foundry tests across the verifier and OpenZeppelin smoke suites; fuzz tests ran 256 arithmetic cases and 256 JNZ cases.
- TypeScript-generated Solidity fixture — 17 valid cross-language vectors and 8 malformed-program vectors passed. State ABI encodings and program/input/context/state/leaf hashes matched byte-for-byte.
- Worst-case verifier harness call — 256,018 measured gas for a 128-instruction program with two depth-12 proofs. This is local Foundry call measurement, not a deployed transaction estimate.
- `pnpm install --frozen-lockfile` — passed; all 8 workspace projects up to date.
- `pnpm check:phase4` — passed with exit code 0: lint (96 files; 56 informational suggestions, no errors), format check (96 files), seven workspace typechecks, 40 Vitest tests across four files, VM/Merkle/SDK/Next.js builds, Foundry compilation, vector regeneration, and all 9 Foundry tests across two suites.
- `forge fmt --check --root contracts` — passed.

### Limits and readiness

- The implemented verifier authenticates membership and one adjacent transition; it does not implement proposal/claim management or the interactive game, full-trace data availability, financial settlement, or production operations.
- No deployment or independent audit is claimed. The complete protocol remains unaudited.
- **Phase 4 scoped result: PASS. Full protocol result: PARTIAL. Phase 5 financial implementation: NO-GO** until the Account Ledger addendum is provided and separately authorized.

## 2026-10-31 — Phase 3 Merkle commitments and cryptographic SDK

### Completed

- Implemented `@bisect/merkle` using the locked v1 VM hash APIs and the real Phase 2 executor. It independently builds ordered left/right Keccak trees, checks the resulting root against the VM's root, binds state bytes to execution context and index, and produces bottom-up proofs with exact budget-derived depth.
- Added strict trace/proof validation and canonical JSON import/export. Trace imports replay the VM; proof verification binds caller-supplied program, public input, budget, and expected root. uint64 values remain decimal strings.
- Added typed SDK APIs for trace/root generation, state commitments, proof generation/verification, and artifact import/export.
- Added deterministic standard-budget sampled proofs and a maximum-budget vector, plus tests for positive and altered proofs, wrong identities/index/depth, serialization precision, deterministic replay, nonhalting bounded traces, and v1 budget boundaries.
- Confirmed the installed OpenZeppelin `v5.5.0` Merkle helper uses commutative sorted-pair hashing; BISECT's ordered verifier does not use it.
- No Phase 2 VM semantics changed. No Solidity contract, wallet/escrow/withdrawal, account ledger, database ledger, or Base Sepolia deployment was started. The Account Ledger addendum is pending as confirmed by the project owner.

### Verification

- `pnpm install --frozen-lockfile` — passed; all 8 workspace projects up to date.
- `pnpm merkle:vectors` — passed; regenerated and formatted `packages/merkle/fixtures/merkle-v1-vectors.json`.
- `pnpm check:phase3` — passed with exit code 0: Biome lint (93 files; 47 informational guarded-record suggestions and no errors), format check (93 files), typecheck (all 7 scripted workspaces), Vitest (40 tests across 4 files), VM/Merkle/SDK package builds, and Next.js production build.
- The checked-in fixture matches the existing protocol v1 64-leaf root; maximum-budget proof depth is 12. There is no Solidity parity result yet.

### Limits and readiness

- Merkle proofs establish indexed membership against a root; they do not prove the correctness of all transitions. The Solidity verifier/dispute implementation remains future work.
- Solidity compatibility, live chain behavior, independent audit, data availability, and chain liveness are not established by this phase. The system remains unaudited.
- **Phase 4 decision: GO** for cryptographic compatibility and verifier work. Ledger/custody features remain out of scope pending the separately authorized Account Ledger addendum.

## 2026-10-31 — Retrospective Phase 1/2 audit

### Result

- Phase 1 specification audit — **PASS**. VM v1 semantics, ABI/Keccak encodings, ordered indexed Merkle construction/proofs, endpoint/output binding, bisection, terminal verification, timeouts, and settlement rules are versioned and locked in the protocol documents.
- Phase 2 VM implementation audit — **PASS**. The TypeScript implementation matches the reviewed v1 rules for the exercised behaviors. The standalone `@bisect/merkle` package is still a Phase 3 extraction placeholder; working trace commitment helpers are currently in `packages/vm/src/encoding.ts`.
- Corrected the CLI to await `validate` and `inspect` file writes and added an immediate-read regression test. Clarified architecture/Merkle package documentation. No protocol semantics or contract code changed.

### Verification

- `pnpm lint` — passed; Biome checked 85 files.
- `pnpm format:check` — passed; Biome checked 85 files.
- `pnpm typecheck` — passed for workspace packages with scripts.
- `pnpm test` — passed; 30 tests across 2 files.
- `pnpm build` — passed; VM package and Next.js production build.
- VM CLI help, validate, inspect, disassemble, addition run, and bounded nonterminating trace — all passed. Addition returned `12`; the nonterminating trace contained 64 states and reported no halt within 63 transitions.
- Full command evidence, file-level findings, and remaining assumptions: `docs/phase-1-2-audit.md`.

### Limits and readiness

- Merkle specification and TypeScript generation/proof utilities are ready; the standalone Merkle package API and Solidity parity are not implemented.
- No contract, dispute settlement, testnet deployment, independent audit, or production-security claim is complete.
- **Phase 3 decision: GO** for the planned Merkle package work using the v1 vectors as compatibility gates. Phase 3 was not started in this audit.

## 2026-10-31 — Phase 1 VM v1 engine

### Completed

- Replaced the empty VM placeholder with strict TypeScript modules for canonical program parsing/validation, instruction decoding, immutable state construction, one-step execution, exact transition verification, bounded execution, fixed-length trace generation, output calculation, JSON serialization, v1 ABI/Keccak encodings, ordered Merkle roots/proofs, and typed errors.
- Implemented all ten locked opcodes with BigInt uint64 arithmetic and explicit modulo-2^64 wrapping. Validation follows the locked error precedence and validates unreachable instructions and both possible JNZ successors.
- Added readable assembly/disassembly, labels, and example builders for increment, addition, multiplication, sum, iterative Fibonacci, factorial, nontermination, invalid opcode, and malformed operands.
- Added the pnpm bisect vm CLI commands validate, run, trace, inspect, and disassemble. A successful run requires HALT; trace generation can produce the valid bounded non-halting trace needed by challenger-side analysis.
- Added deterministic unit, encoding/vector, Merkle proof, seeded randomized-program, boundary, and CLI coverage. The generated package build emits JS and declarations to ignored packages/vm/dist.
- Updated README, architecture, engineering stage, requirements status, and implementation decision documentation. No Solidity verifier or blockchain interaction was added to the VM package.

### Verification

- Frozen workspace install — passed inside pnpm check:all.
- Lint and formatting checks — passed inside pnpm check:all.
- Workspace typecheck — passed for all packages, including @bisect/vm.
- Unit tests — passed: 29 tests across 2 files. VM tests cover all opcodes, arithmetic wrapping, invalid register/PC/program/input cases, closed-ISA rejection, branch semantics, stuttering, all four trace budgets, non-halting traces, deterministic replay, example results, and seeded randomized valid programs.
- Production build — passed: VM TypeScript build and Next.js production build.
- Protocol known-answer fixture checks — passed for every domain hash, canonical input ABI bytes, program/input/context hashes, sampled state and leaf hashes, final proof siblings, and the 64-state trace root from docs/protocol-vectors.json.
- CLI smoke runs — passed for all five requested subcommands. A max-uint64 multiplication input read from JSON produced the exact wrapped output 18446744073709551614.
- pnpm check:all — passed with exit code 0, including 28 tests at that point. It also passed Docker/PostgreSQL health, Prisma validation/generation/migration/read-write/restart persistence, Base Sepolia RPC chain ID 84532, local Anvil chain ID 31337, Foundry build and 1 contract smoke test, and Playwright Chromium (1 test).
- After adding the final closed-ISA rejection test, pnpm lint, pnpm format:check, and pnpm test were rerun; lint and formatting passed, and all 29 tests passed.

### Limits and remaining risks

- VM v1 has TypeScript implementation and known-answer coverage, but no Solidity VM/verifier exists yet, so cross-language transition and hash parity is not established.
- Property-style randomized tests are deterministic and seeded; they are not exhaustive or a formal proof.
- Merkle roots and proofs authenticate commitments under the locked Keccak/ABI assumptions; they do not prove execution correctness without the future dispute verifier.
- BISECT remains unaudited. No protocol contract is deployed, and the challenger, indexer, wallet transaction flow, and production data-availability operations remain planned.

## 2026-10-31 — BISECT protocol v1 specification lock

### Completed

- Read the repository engineering rules, requirements matrix, architecture, and decisions before design work.
- Locked VM v1 semantics, program validation, transition/error behavior, and fixed-length traces in `docs/vm-spec.md`.
- Locked ABI serialization, Keccak-256 domain separation, context/state/leaf/node hashing, proof ordering, and final output binding in `docs/encoding-spec.md`.
- Specified proposal, single-active-game/retry behavior, leftmost-difference bisection, response deadlines, terminal proof, exact bond outcomes, accounting, and withdrawal paths in `docs/dispute-state-machine.md`.
- Added the protocol summary/invariants/non-goals, threat assumptions, and cross-language vector fixture in `docs/protocol-v1.md`, `docs/security-model.md`, and `docs/protocol-vectors.json`.
- Updated architecture, decision log, requirements traceability, README, and Windows/database verification records to match the locked protocol and current Phase 0 results.
- No VM or dispute implementation was started. v1 is specified, not implemented, deployed, or audited.

### Verification

- Protocol vector check using viem `2.57.13` — passed: canonical input ABI bytes, all domain hashes, program/input/context hashes, sampled states/leaves, 64-leaf root, and final-state inclusion proof reproduced from the formulas.
- `docs/protocol-vectors.json` — parsed successfully as JSON and independently recomputed against the locked formulas.
- `pnpm check:all` — passed with exit code 0 after specification edits. It includes frozen install, environment and Docker checks, PostgreSQL/Prisma migration/read/write/restart persistence, lint, format, typecheck, Vitest, Next production build, Base Sepolia and Anvil RPC, Foundry build/test, and Playwright.

### Readiness and limits

- Protocol v1 is locked for implementation. Consensus-visible changes require a new version and vectors.
- Future implementation gates remain: cross-language tests, VM bounds/fuzz tests, Solidity state/accounting tests, gas analysis, real Base Sepolia deployment evidence, and independent audit.

## 2026-10-31 — Phase 0 foundation and environment verification

### Completed

- Established the pnpm workspace, strict TypeScript settings, Biome, Vitest, Playwright, Next.js scaffold, project guidance, protocol documentation, and requirements traceability matrix.
- Added a minimal Foundry project and pinned OpenZeppelin Contracts `v5.5.0` submodule; repository-local Foundry `1.8.7` compiles and runs the import smoke test.
- Added local PostgreSQL Compose configuration, a minimal Prisma `7.10.1` health-check schema/migration, read/write smoke test, and restart persistence verification.
- Added local Anvil and Base Sepolia (`84532`) read-only RPC checks, reproducible root commands, environment documentation, and CI workflows.
- Installed Docker Desktop `4.97.0`; the Linux engine is running on WSL 2. PostgreSQL `17.11-alpine3.24` is healthy with a named volume and loopback-only port binding.
- Kept `.env` and Foundry binaries under ignored paths. No keys or live credentials are configured.
- Reviewed pnpm install scripts; only Prisma engines, Prisma CLI, and esbuild at locked versions are allowed. Three optional native accelerators remain denied.
- Configured repository-local Git identity and committed the foundation.

### Verification

- `pnpm check:all` — passed with exit code 0 after the restart-check script formatting fix. The aggregate runs frozen install, tool checks, Docker, PostgreSQL, Prisma, lint, format, typecheck, unit tests, production build, Base Sepolia RPC, Anvil RPC, Foundry build/tests, and Playwright.
- Database checks passed: Compose startup and health, Prisma schema validation and generation, migration applied and subsequently reported in sync, Prisma authenticated read/write before and after container restart, and a marked row survived restart and was then deleted by the check.
- Contract checks passed: Foundry `1.8.7`, Solidity `0.8.30`, OpenZeppelin ReentrancyGuard smoke test (1 passed).
- RPC checks passed: Base Sepolia chain ID `84532`; local Anvil chain ID `31337`.
- Browser test passed: Playwright Chromium, 1 test. Unit test passed: Vitest, 1 test.
- CI workflow YAML parsed with PyYAML `6.0.3`; GitHub-hosted CI has not been executed from this workstation.
- `docker compose ps` reports PostgreSQL healthy and bound only to `127.0.0.1:5432`.

### Readiness and remaining scope

- **Phase 0 is ready to close; the environment is ready to proceed to Phase 1.** All checks in `pnpm check:all` passed.
- WSL 2 works for Docker Desktop. `wsl --list --verbose` shows Docker Desktop's internal distribution but no developer Ubuntu distro. An Ubuntu install attempt returned `Wsl/InstallDistro/ERROR_ALREADY_EXISTS` without registering Ubuntu. This is nonblocking because the app and verified Foundry workflow run natively on Windows; no WSL distributions or data were removed.
- No Phase 1 protocol implementation has started. VM execution, Merkle commitments, dispute resolution, indexer/challenger behavior, wallet transactions, and testnet deployment remain planned.
- Protocol questions remain in `docs/decisions.md`. No protocol contract is deployed, and no independent security audit has been performed. The project is not production-secure.

## Initial scaffold notes

The repository was empty at initial setup. The initial foundation created one requirements integrity unit test and one browser test that checks the current phase is described honestly. The initial CI includes separate TypeScript, PostgreSQL, and Foundry jobs; it does not deploy on pushes.

## 2026-11-01 — Phase 7 adversarial security and accounting invariants

### Completed

- Added `scripts/generate-phase7-security-vectors.mts` and generated Solidity-consumable fixtures from the actual TypeScript VM and ordered Merkle implementation. The vectors alter one intermediate state at twelve indices from 1 through 63 while retaining the same halted output.
- Extended Solidity verifier tests for predecessor/successor byte mutation, sibling mutation/order, root mutation, authenticated-state fuzzing, and the full signed `int16` JNZ target range.
- Added 48 seeded TypeScript Merkle property cases with full-width `bigint` public inputs and state/index/sibling/context tampering.
- Added twelve Foundry end-to-end dispute regressions: each same-output fraudulent prover trace is bisected to its exact earliest differing state, terminally verified, refuted, and settled once to the challenger.
- Added concurrent-game isolation, production-derived-registry reverting/reentrant withdrawal, unknown-claim challenge/timeout, and forced-ETH-surplus tests.
- Added a stateful invariant handler for the operative `BisectDisputeRegistryV1`. It checks locked obligations, liabilities, solvency, per-claim beneficiary attribution, withdrawals, closure, and payout conservation.
- Added `pnpm security:vectors` and `pnpm check:phase7`. No locked protocol semantics or production contract logic changed; no verified production defect required a code fix.
- Added the Phase 7 security test report and acceptance decision.

### Verification

- `pnpm check:phase7` — passed with exit code 0 using `FOUNDRY_INVARIANT_RUNS=32` and `FOUNDRY_INVARIANT_DEPTH=80`.
- Biome lint — passed with no errors (82 informational suggestions); formatting — passed across 118 files.
- TypeScript typecheck — passed across all seven applicable workspace projects. Vitest — **42 tests passed across 5 files**.
- VM, Merkle, SDK, and Next.js production builds — passed.
- Foundry build — passed with Foundry 1.8.7 and Solidity 0.8.30. Foundry — **55 tests passed across 7 suites**, including 16 Phase 7 adversarial cases. Both stateful accounting invariants each ran 32 sequences × 80 calls (2,560 calls) with zero reverts/failures. Verifier fuzz properties each ran 256 cases.
- Mined local Anvil demonstration — passed on chain ID 31337 with 21 transactions; state index 1 was refuted and the challenger received a real local test-ETH pull credit. The withheld-prover scenario also timed out and settled according to v1. These are not Base Sepolia measurements.
- `forge fmt` — passed.
- No failing fuzz seed or protocol counterexample remains. A test-fixture child-pair orientation error found during development was corrected; it did not identify a production-contract defect.

### Limits and readiness

- Protocol correctness still assumes Keccak collision resistance, correct EVM/compiler behavior, chain liveness, timely transaction inclusion, and an honest challenger with trace reconstruction, bond, and gas resources.
- Tests do not prove trace archive availability, censorship resistance, reorganization/finality, economic adequacy of deployment windows/bonds, or the absence of all contract defects. The system remains unaudited and is not production-secure. No Base Sepolia deployment or automatic challenger is established.
- **Phase 7 test gate: PASS. Phase 8 implementation: GO**, limited to local development. Deployment and meaningful-fund use remain separate review gates.
- Full evidence and caveats: `docs/security-test-report.md`; phase gate: `docs/phase-7-acceptance.md`.

## 2026-11-01 — Phase 8 indexer, PostgreSQL journal, and reconciliation

### Completed

- Added a polling indexer configured by explicit RPC, chain ID, registry, deployment block, confirmation depth, scan range, and reorganization bound. It persists raw and decoded logs, maintains hash-linked checkpoints, distinguishes observed/confirmed/orphaned records, and resumes idempotently.
- Enforced a minimum one-descendant confirmation depth and corrected the exact-depth boundary so a block confirms when `head >= block + depth`.
- Added normalized Prisma read models for wallets, claims, disputes, deposits/allocations, settlements, withdrawals, chain blocks/events, checkpoints, ledger accounts, journal entries/postings, and reconciliation history.
- Added exact-wei double-entry postings for one-time bond receipt/lock, internal settlement liability transfers, and withdrawals. Journal entries are checked as balanced in PostgreSQL and append-only triggers reject updates/deletes. Dishonest prover bond records are marked slashed when the challenger receives the settlement.
- Added read-only, paginated API routes for indexer state, account overview, wallet activity, claims, disputes, deposits, locked bonds, penalties, settlements/rewards, withdrawals, and reconciliation.
- Added same-canonical-block reconciliation against contract custody, locked liabilities, total credits, per-wallet credits, solvency, and journal consistency. Reorganizations append inversals and rebuild derived views from canonical confirmed logs.
- Added Phase 8 development scripts, `.env.example` settings, CI PostgreSQL/Anvil integration job, ADR-0015, `docs/ledger-reconciliation.md`, and the verification report.

### Verification

- `pnpm check:phase8` — passed after the final API and confirmation-boundary changes: lint, format check, strict TypeScript workspace typecheck, 51 Vitest tests, VM/Merkle/SDK/Next.js build, contract compilation/vector generation, 55 Foundry tests, Prisma generation/deploy, and actual PostgreSQL/Anvil integration.
- Foundry stateful accounting invariants each ran 256 sequences × 500 calls (128,000 calls), with zero reverts. Verifier fuzz tests each ran 256 cases.
- Prisma status — 8 migrations applied and schema up to date. PostgreSQL health check passed.
- Actual final local integration (Anvil chain ID `1453966104`, registry `0x5fbdb2315678afecb367f032d93f642f64180aa3`): 17 real events indexed initially; 19 canonical events after a controlled withdrawal reorganization; 2 claims, 3 disputes, 5 deposits, 4 settlements, and 2 withdrawals. It verified pending-confirmation gating, event replay/restart idempotence, API pagination/validation, and journal constraints. Final rerun transaction hashes are recorded in `docs/phase-8-report.md`.
- Journal result: 10 initial entries / 21 balanced postings; after one reorg reversal and replacement withdrawal, 13 entries / 27 postings, all balanced. Reconciliation matched before and after the reorg; final contract balance, locked liabilities, wallet credits, and surplus were all `0` wei. Reverting the confirmed withdrawal restored the exact `2000000000000000` wei credit before its replacement withdrawal.
- `pnpm check:base-sepolia` — public RPC returned chain ID `84532`; no deployed registry address or deployment block is configured, so no public-chain events were indexed.
- `pnpm check:environment` — Node 24.19.0, pnpm 11.25.0, Foundry/Anvil/Cast 1.8.7, Docker 29.9.2, and Compose 5.6.1 verified. CI YAML parsed locally; hosted CI has not run.

### Readiness and limits

- **Phase 8 local gate: PASS. Base Sepolia indexer operation: PARTIAL** until a real registry address and deployment block are configured and verified.
- Confirmation depth is an operational threshold, not finality. The worker assumes one active writer per chain/registry and stops for reorgs deeper than its configured bound. Reconciliation checks at most 1,000 wallets per run and reports an explicit limit discrepancy.
- The indexer and ledger are derived read models. Contract state remains authoritative. There is no independent audit or production-security claim.
- Full evidence and assumptions: `docs/phase-8-report.md` and `docs/ledger-reconciliation.md`.

## 2026-11-01 — Phase 9 professional product design system

### Completed

- Replaced the project-stage landing page with a responsive Next.js application shell and routes for Overview, Program Studio, Claims, Disputes, Account Ledger, Documentation, and Settings.
- Added light/dark semantic color themes, a responsive keyboard-operable navigation drawer, active-route state, skip link, and prefers-reduced-motion behavior.
- Added shared exact-wei financial display, transaction lifecycle/status, claim/proof states, wallet security notice/dialog, explorer link validation, empty/loading/error panels, financial table, and real search/status filters that remain disabled until records exist.
- Added read-only injected-wallet account and chain detection. Wallet status does not request signing credentials. Unknown balances remain unavailable and there are no fake transfers, test claims, or chart data.
- Added root `DESIGN.md`, `UX-CONTRACT.md`, and `premium-ui.json`, updated README/architecture, and documented that registry/indexer data and transaction flows are not yet wired into the frontend.

### Verification

- `pnpm lint --reporter=summary` — passed, zero warnings/errors; remaining Biome findings are informational suggestions.
- `pnpm format:check` — passed, 145 files checked.
- `pnpm typecheck` — passed across 7 applicable workspace projects.
- `pnpm test` — passed, 53 tests across 7 files; includes exact wei formatting boundaries.
- `pnpm --filter @bisect/web build` — passed; overview and six static section routes rendered.
- `pnpm e2e` — passed, 8 Chromium tests across desktop/mobile navigation, all routes, wallet status, theme persistence, and dialog behavior.
- `pnpm web:a11y` — passed; semantic control names and light/dark contrast pairs meet the 4.5:1 check.
- Frontend design strict audit — passed with zero findings.

### Readiness and limits

- **Phase 9 UI foundation: PASS.** The UI is a design and read-only wallet/status foundation. The frontend does not yet call the indexer API or registry, so account/claim/dispute financial data remains unavailable until a deployed address and integration configuration are supplied.
- No contract writes, withdrawal flow, real gas estimates, protocol results, independent audit, or Base Sepolia deployment were added or claimed.
- Full screen/component evidence: `docs/phase-9-report.md`; token and behavior sources: `DESIGN.md` and `UX-CONTRACT.md`.

## 2026-11-01 — Phase 10 product landing page, overview, and explorers

### Completed

- Replaced the project-status home screen with an accurate product landing page covering the prover/challenger model, ordered Merkle trace commitments, child-hash bisection, the single disputed on-chain transition, active-challenger requirement, trace-data retrieval assumption, and Base Sepolia prototype status.
- Connected the dashboard, claims explorer, disputes explorer, and claim-detail route to the existing Phase 8 read API. Added read-only `GET /v1/overview` and `GET /v1/claims/:claimId`; claim/dispute listing supports validated search/status filters and cursor pagination.
- Added confirmed claim/dispute counts, locked exposure in exact wei/test ETH, recent confirmed activity, chain/deployment details, indexer checkpoint/lag, challenge deadlines, bisection rounds, bond and settlement references. Unavailable API/data is not rendered as a successful empty state or fabricated zero.
- Added a Prisma `bisectionRounds` field and additive migration, projected from confirmed bisection events. Added strict server-only frontend API response validation and chain-aware explorer links. Account Ledger remains read-only; no financial transaction UI was added.
- Added the direct pinned `tailwindcss` 4.3.3 dependency required by the existing global stylesheet. A clean development compile exposed the missing workspace dependency and stale generated Next cache; after linking the dependency and moving aside only that generated cache, clean Next dev compilation and the full populated integration passed.
- Added a real-Anvil/real-PostgreSQL browser integration mode and saved dashboard, claims, disputes, and claim-detail screenshots under `docs/phase-10-evidence/`.

### Verification

- `pnpm lint --reporter=summary` — passed with exit 0; 286 informational Biome suggestions and no blocking diagnostics.
- `pnpm format:check` — passed; 153 files checked.
- `pnpm install --frozen-lockfile` — passed; lockfile policy verification succeeded and the workspace was already up to date.
- `pnpm typecheck` — passed across all 7 applicable workspace projects.
- `pnpm test` — passed; 58 tests across 8 files.
- `pnpm build` — passed for VM, Merkle, SDK, and Next.js production build; the landing page prerendered and data pages render dynamically.
- `pnpm e2e` — passed; 10 Chromium tests, including mobile-width behavior and API-unavailable states.
- `pnpm web:a11y` — passed; 1 Chromium accessibility smoke test.
- `pnpm db:deploy` — passed; applied the additive bisection-round migration without resetting data.
- `pnpm phase10:web-integration` — passed with actual local Anvil test-ETH transactions, PostgreSQL indexing, API filtering/pagination, restart/replay, reorganization, reconciliation, populated browser views, and 375px horizontal scrolling for populated claims/disputes tables. Final local run: chain ID `1168104142`, 17 initial real events / 19 canonical events after reorganization, 2 claims, 3 disputes, 5 deposits, 4 settlements, 2 withdrawals; journal balanced and reconciliation matched.

### Readiness and limits

- **Phase 10 local product gate: PASS.** **Base Sepolia data integration: PARTIAL** because there is no deployed registry address or deployment block configured; all populated screenshot and transaction evidence is from local Anvil.
- Search/filter/pagination and confirmed on-chain references are read-only. No signing, claim/challenge creation, or withdrawal UI exists. The Account Ledger route remains a future layout.
- The frontend depends on the indexer's confirmation/finality policy and does not supply trace data availability. The system remains unaudited and is not production-secure.
- Phase 11 follows in `docs/phase-11-report.md`.

## 2026-11-01 — Phase 11 interactive Program Studio and Trace Explorer

### Completed

- Replaced the Program Studio placeholder with an assembly editor backed by the existing BISECT v1 parser and the real Phase 2 VM. It accepts only supported assembly, exactly eight decimal-string uint64 inputs, at most 128 instructions, and the approved transition budgets.
- Runs execute locally in the browser using the Phase 3 SDK to build the ordered Keccak trace commitment. No arbitrary code is evaluated and no chain RPC or wallet is used.
- Added result/context summaries, instruction-level state navigation, play/pause/next/previous/reset controls, register-change highlights, state and leaf hashes, and a bounded virtual list that renders a small viewport for up to 4,096 states.
- Added real state-proof generation and verification against the exact run context, downloadable proof and execution artifacts, and an explicit tampered-sibling rejection check.
- Added an explicitly test-only, same-output altered intermediate trace. Its altered-root membership proof verifies while the first state transition is rejected by the VM transition verifier; the fixture cannot produce a claim payload.
- Added local Phase 5 `ClaimSubmission` preparation from verified initial/final endpoint proofs, exact ABI-encoded `submitClaim` calldata, and JSON export. The deployment bond remains caller-supplied `msg.value`; the Studio does not request a wallet signature or submit a transaction.
- Added branching and HALT/stutter examples; updated the product design and interaction contracts; added production-browser E2E coverage.

### Verification

- `pnpm format:check` — passed; 156 files checked.
- `pnpm lint --reporter=summary` — passed with exit 0. Biome reports 286 informational suggestions in pre-existing files; no blocking diagnostics. The changed Studio/CSS files pass targeted Biome checks without diagnostics.
- `pnpm typecheck` — passed across all 7 applicable workspace projects.
- `pnpm test` — passed; 58 tests across 8 files.
- `pnpm build` — passed; VM, Merkle and SDK package builds plus the Next.js production build and route generation.
- `pnpm web:a11y` — passed; 2 Chromium accessibility smoke tests.
- `pnpm e2e` — passed against the production server; 18 Chromium tests including deterministic execution, inclusion proof, export, payload preparation, boundary arithmetic, 4,096-state virtualization, navigation controls, dishonest-trace detection, accessibility and narrow-screen layout.
- `pnpm --filter @bisect/vm cli vm run example:addition --input "[7,5,0,0,0,0,0,0]" --budget 63` — passed. Output `12`, halt index `2`, 64 trace states, root `0x0b4d6162f7b834cda766d7f80641823fcc73e50c2f60940b2d12d9f3db101cfd`.

### Readiness and limits

- **Phase 11 Program Studio: PASS.** The Studio uses the implemented v1 VM and SDK locally and prepares, but does not submit, the Phase 5 payload.
- The claim export is ABI-encoded unsigned calldata only. A deployment address, configured bond, wallet interaction, transaction, gas estimate, or chain result is not inferred or fabricated.
- The malicious trace is an isolated local test fixture with a distinct altered root; it is not a fraud-proof result and does not cause an on-chain outcome.
- The protocol remains unaudited, and Base Sepolia deployment/data remain unconfigured. See [`docs/phase-11-report.md`](phase-11-report.md).

## 2026-11-01 — Phase 15 automated challenger prototype

### Completed

- Added an optional TypeScript challenger service using the existing VM, Merkle SDK, Phase 6 dispute ABI, and authoritative claim/game contract reads. It independently checks context and trace roots, detects same-output intermediate trace fraud, builds real initial and terminal proofs, and follows the locked child-hash bisection protocol.
- Added dry-run-by-default configuration, explicit broadcast opt-in, dedicated signer validation, local-only unlocked-account support, live chain/version checks, bond/total-exposure/gas/balance limits, bounded polling retries, emergency stop/disable controls, process locking, durable attempt/pending-write state, JSONL logs, and reorganization replay from deployment.
- Added CLI commands for help, status, inspect, verify, dry-run, start, stop/resume and enable/disable. Added a local Anvil integration harness and unit coverage for honest claims, same-output intermediate fraud, context mismatch, proof evidence, and configuration safety.
- Documented bot operation, the trace-data model, deployment setup, and remaining operational/security limitations in [`apps/challenger/README.md`](../apps/challenger/README.md), [`docs/architecture.md`](architecture.md), and [`docs/phase-15-report.md`](phase-15-report.md).

### Verification

- `pnpm --filter @bisect/challenger typecheck` — passed.
- `pnpm exec vitest run tests/unit/challenger.test.ts` — passed, 6 tests, including durable pending-write/control-file persistence.
- `pnpm challenger:e2e` — passed on a fresh local Anvil chain (chain ID `31337`): honest claim ignored; dishonest same-output intermediate trace challenged; 6 bisection rounds; outcome `PROVER_TRANSITION_INVALID`; pull credit `2,000,000,000,000,000` wei; spend-cap, insufficient-balance, controlled-reorg, and RPC-outage paths exercised. The harness used actual contract deployments, transactions, receipts, and event/escrow reconciliation. Measured scenario: 19 receipts, 7,207,265 gas used, aggregate receipt gas cost `12,807,818,065,010,651` wei; escrow liabilities/custody reconciled at `4,000,000,000,000,000` wei.
- `pnpm lint` — passed, exit 0 (10 warnings and 541 informational suggestions; no errors).
- `pnpm format:check` — passed, 185 files checked. Biome uses platform-native line endings so Windows `core.autocrlf` does not create false formatting failures.
- `pnpm typecheck` — passed across all 7 applicable workspace projects.
- `pnpm test` — passed, 71 tests across 11 files.
- `pnpm build` — passed; VM, Merkle and SDK package builds plus the Next.js production build and route generation.
- `pnpm build:challenger` — passed; emitted the compiled service under ignored `apps/challenger/dist/`.
- `pnpm contracts:build` — passed; Foundry returned exit 0 with Solidity compilation incrementally skipped because sources were unchanged, and ABI generation completed.
- `pnpm contracts:test` — passed, 55 Foundry tests across 7 suites, including fuzz runs and 256-run accounting invariants; 0 failed.
- `pnpm challenger:help` — passed and printed CLI commands and broadcast safety requirements.

### Readiness and limits

- **Phase 15 local challenger prototype: PASS.** No Base Sepolia registry is configured and the bot did not broadcast to a public chain.
- PostgreSQL indexing/reconciliation was not part of this bot E2E; this harness replayed actual chain events against contract totals in memory. No database changes were made.
- The tool remains unaudited. Operator key protection, sufficient uptime/gas, RPC/network liveness, and manual reconciliation after ambiguous/reorged writes remain necessary assumptions. See [`docs/phase-15-report.md`](phase-15-report.md).
