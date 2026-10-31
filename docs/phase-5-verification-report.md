# Phase 5 verification — bonded claim escrow foundation

**Phase 5 result: PARTIAL. Phase 5.5 security gate: PASS for fail-closed behavior.** The contract source contains endpoint validation, exact-wei escrow accounting, and pull-withdrawal logic, but its public base entrypoints now reject claim submissions and finalization until an integrated dispute game exists. The Foundry-only harness is not a deployable protocol contract.

## Contract behavior

`contracts/src/BisectClaimRegistry.sol` uses Solidity `0.8.30` and OpenZeppelin `5.5.0` `ReentrancyGuard`. The constructor fixes bond and block windows, rejects Base Mainnet chain ID `8453`, and has no admin or upgrade path. The public base `submitClaim` and `finalize` revert with `DisputeProtocolUnavailable`. Consequently, the base accepts no user bond and cannot mark an unchallenged trace final.

Internal `_submitClaim` validates the approved budget and VM v1 program, derives program/input/context hashes, authenticates the canonical initial proof and halted terminal proof/output, rejects duplicate proposals, stores the claim, and records the exact bond. Internal helpers maintain aggregate locked-bond/credit totals and support future game-authorized settlement. They do not decide a game outcome. `withdraw()` remains caller-only, full-credit, checks-effects-interactions, and protected by OpenZeppelin `ReentrancyGuard`.

The invariant is:

```text
totalLiabilities = totalLockedBonds + totalCredits
address(this).balance >= totalLiabilities
```

The test-only `BisectClaimRegistryHarness` exposes submission and an accounting seam for Foundry regression/invariant tests. Its settlement call does not prove or simulate a real dispute outcome. Do not deploy the harness.

## Phase 5.5 security finding and correction

The original Phase 5 public implementation accepted a prover bond after authenticating only trace endpoints and released it after a challenge window despite having no challenge entrypoint. An invalid intermediate trace could be finalized. A same-output trace could also contain a fraudulent intermediate state while retaining the honest final output.

Phase 5.5 disables both public entrypoints. A regression fixture generated from TypeScript modifies state index 1 of a trace whose program first writes `5` and later writes `42`. The altered trace's first transition is invalid, its root differs from the honest root, and its final halted state/output still equals the honest result (`42`). Foundry checks the expected first successor and confirms the base contract cannot accept the bond or finalize/credit this fraudulent claim.

No VM, Merkle, encoding, protocol-v1, or locked settlement semantics changed. No `challenge`, bisection, timeout, challenger bond, or game settlement implementation exists.

## Verification evidence

- `pnpm check:phase5` — passed after raising the timeout only for the existing maximum-budget VM test. It passed lint, formatting, all 7 applicable workspace typechecks, all 41 Vitest tests, VM/Merkle/SDK/Next.js builds, Solidity compilation, ABI generation, vector regeneration, and the complete Foundry suite.
- Foundry — 26 tests across four suites passed: 16 claim-registry tests, 8 verifier tests including 256-run arithmetic and branch fuzz cases, one OpenZeppelin smoke test, and one accounting invariant test.
- Accounting invariant — 256 runs and 128,000 handler calls; zero reverts, invariant failures, or discarded calls.
- Targeted `BisectClaimRegistryTest` — 16 passed, including base deposit rejection and the same-output fraud regression.
- TypeScript test suite — 41 passed across 5 files after the per-test timeout correction.
- `forge fmt` — formatting applied to the changed Solidity files; final `forge fmt --check`, individual workspace checks, and Playwright outcome are recorded in `docs/phase-5-5-security-gate.md`.

The invariant runner emits warnings while probing optional target-selector configuration methods; the explicit test handler ran all 128,000 calls successfully. No Base Sepolia deployment or live gas measurement is claimed.

## Readiness and limitations

- **Phase 6 implementation: GO**, following [`phase-6-integration-contract.md`](phase-6-integration-contract.md) and [`phase-6-security-checklist.md`](phase-6-security-checklist.md).
- **Deploy/fund the base registry: NO-GO.** Its public submit/finalize operations are intentionally unavailable.
- The challenge game, retries, terminal adjudication, challenger escrow, and timeout settlements remain unimplemented and unaudited.
- The Account Ledger addendum was not authored; ledger architecture, economic-policy, and invariant docs are absent. No wallet custody, database ledger, indexer-ledger reconciliation, or hosted key management is included.
- Foundry's `1 ETH`, five-block challenge window, and three-block turn window are test fixtures only. They are not recommended deployment parameters.
