# Phase 11 — Program Studio and Trace Explorer

Date: 2026-11-01

## Result

**Phase 11: PASS for the local browser Studio.** It executes the existing deterministic VM v1 and ordered Merkle SDK in the browser, verifies actual inclusion proofs, and exports canonical run artifacts. It does not submit transactions or claim a testnet deployment.

## Implemented behavior

- The Studio editor accepts only BISECT assembly. The existing VM parser validates opcode syntax, operands, register indices, program size, exact eight-value public input, uint64 bounds, and transition budgets `{63, 255, 1023, 4095}`. Invalid programs and inputs disable execution with field-level feedback.
- The browser calls the real VM and `generateTraceCommitment`; it does not evaluate user JavaScript, use a server-side mock, call a blockchain, or request a wallet.
- Results show output, halt information, program/input/context hashes, and the ordered trace root. The full trace has deterministic indices and canonical states. The virtual list renders the viewport plus a small overscan region, including at the 4,096-state maximum.
- State selection shows PC, halted state, eight exact registers, changed-register highlights, canonical state hash, and index-bound leaf hash. Play, pause, next, previous, reset, row selection, and keyboard operation are available.
- The selected-state proof comes from the Phase 3 SDK. The Studio verifies it against the selected run's program, public input, transition budget, execution context, state index, and root. Proof export retains the exact canonical strings; a sibling mutation is rejected locally.
- A halted valid run can prepare the exact Phase 5 `ClaimSubmission`, including authenticated initial and terminal proofs and viem-encoded `BisectDisputeRegistryV1.submitClaim` calldata. The bond is not embedded or invented: it must be supplied separately as `msg.value`. There is no signing or submission path.
- The intentionally dishonest example alters an intermediate register while preserving output 12. Its membership proof is computed for its own altered trace root and is valid as a membership proof; the VM rejects its first transition. UI labels identify it as a test-only trace, not as a protocol dispute result.

## Real-program execution demo

Executed the existing VM CLI with the Addition example, input `[7, 5, 0, 0, 0, 0, 0, 0]`, and budget 63. The actual output was:

| Result                    | Observed value                                                       |
| ------------------------- | -------------------------------------------------------------------- |
| Program bytes             | `0x0300000109000000`                                                 |
| Program hash              | `0x2d6335c89bdc1dcdfbff0792a369dd8091829a9a9f2265a985bd45c55f42e72f` |
| Input hash                | `0x05dd67c097d06a846d90d8df36a83cd18a843fe9fb8ac8c335f586b60a37c820` |
| Execution-context hash    | `0xd7b9739579b98f99797191e49efe175265fca3880a8200113317ba35207d1a75` |
| Output                    | `12`                                                                 |
| HALT transition           | `2`                                                                  |
| Trace state count         | `64`                                                                 |
| Ordered Keccak trace root | `0x0b4d6162f7b834cda766d7f80641823fcc73e50c2f60940b2d12d9f3db101cfd` |

The production Chromium E2E test ran the same example in the Studio, checked output and root shape, navigated to state index 1, generated a six-sibling inclusion proof, and observed the SDK's “Proof verified for state 1” result. It downloaded and parsed the proof and full trace export, altered a proof sibling and observed rejection, prepared the Phase 5 payload, and verified `submitClaim` calldata plus the initial and final six-sibling endpoint paths. The UI confirmed no wallet was opened and no transaction was sent.

## Verification evidence

- `pnpm format:check` — passed; 156 files checked.
- `pnpm lint --reporter=summary` — passed, exit 0. There are 286 informational suggestions in older files; no blocking errors. Targeted Biome checks of the changed Studio, helper, CSS, and E2E files pass without diagnostics.
- `pnpm typecheck` — passed across all 7 applicable workspace projects.
- `pnpm test` — passed; 58 tests in 8 files.
- `pnpm build` — passed for the VM, Merkle, SDK, and Next.js production application.
- `pnpm web:a11y` — passed; 2 Chromium smoke tests.
- `pnpm e2e` — passed against the production build; 18 Chromium tests in 2.3 minutes.
- `pnpm --filter @bisect/vm cli vm run example:addition --input "[7,5,0,0,0,0,0,0]" --budget 63` — passed and produced the values shown above.

## Files

- `apps/web/src/components/program-studio.tsx` — interactive Studio, local execution, trace/proof inspection, playback, and exports.
- `apps/web/src/components/program-studio-utils.ts` — exact Phase 5 tuple/calldata, canonical exports, and the isolated dishonest trace fixture.
- `apps/web/src/components/section-page.tsx`, `apps/web/src/app/globals.css`, `apps/web/next.config.ts` — route integration, responsive styling, and local Next dev-origin configuration.
- `tests/e2e/program-studio.spec.ts` — production browser scenarios.
- `packages/vm/src/examples.ts` — deterministic branching and HALT/stutter examples.
- `package.json`, `apps/web/package.json`, `pnpm-lock.yaml`, `playwright.config.ts` — workspace package build ordering and reproducible app test setup.
- `DESIGN.md`, `UX-CONTRACT.md`, `README.md`, `docs/architecture.md`, `docs/progress.md` — product behavior and phase record.

## Limits and risks

- The editor supports only the locked VM assembly language and fixed budgets. It is local browser computation; 4,096 states are bounded but still consume browser memory while an execution is displayed.
- A valid inclusion proof only proves state membership in the supplied root. It does not prove every transition; the separate test-only scenario demonstrates this property.
- Claim payload preparation does not verify deployment configuration or bond economics, and does not send a transaction. Wallet connection, transaction review, gas estimation, and submission remain outside this phase.
- No live Base Sepolia deployment, independent security audit, or production readiness is claimed. Phase 8 API data availability limitations remain unchanged.
