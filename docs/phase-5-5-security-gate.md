# Phase 5.5 — pre-dispute security gate

**Result: PASS for the fail-closed pre-dispute gate. Phase 6 implementation: GO with the integration contract below. Deployment or funding: NO-GO.** This review inspected the Phase 5 Solidity implementation, Foundry tests, cross-language fixtures, locked protocol/dispute specifications, SDK ABI generator, and repository documentation. It did not implement the interactive game or deploy a contract.

## Finding

The original `BisectClaimRegistry` accepted an exact prover bond after checking only the initial and terminal states. Its `finalize` function then credited the prover after the challenge deadline even though no `challenge` operation existed. An invalid intermediate trace could therefore be finalized. A trace can also be fraudulent while claiming the same final output as an honest run; checking only the output does not establish every transition.

The proposed Phase 5.5 fix also closes the related deposit trap: disabling finalization while continuing to accept public deposits would leave honest users with no production path to release their bonds. The public base contract now rejects both claim submission and finalization with `DisputeProtocolUnavailable`.

## Corrections made

- `contracts/src/BisectClaimRegistry.sol` keeps the validated submission flow in internal `_submitClaim`, but the public base `submitClaim` reverts. This avoids both false acceptance and deposits that cannot be safely settled.
- The public base `finalize` checks normal claim/status/deadline/bond preconditions and then reverts. A future integrated contract must override it and check the active-game mapping before using the shared internal finalization helper.
- Added internal accounting transitions for exact incoming bonds, locked-bond-to-credit movement, and proof-authorized finalization. These helpers choose no winner and expose no arbitrary public settlement method.
- `contracts/test/BisectClaimRegistry.t.sol` uses an explicitly test-only derived harness to exercise submission, withdrawals, liability movement, and the accounting invariant. Its accounting finalizer does not represent a proven dispute result. A separate test proves the production base rejects a bond and keeps no liability.
- `scripts/generate-phase5-claim-vectors.mts` now generates a same-output fraud fixture from the TypeScript VM/Merkle code. The program first writes 5, then overwrites the register with 42 and halts. The adversarial trace changes state index 1 to 9, making transition 0 invalid while retaining the honest halted terminal state and output 42. Its root differs from the honest root. Foundry tests confirm the valid first transition yields 5 and that the base contract cannot finalize this claim or credit the prover.
- No VM, Merkle, hash, serialization, or locked dispute outcome semantics changed.

## Financial accounting review

The intended invariant remains:

```text
totalLiabilities = totalLockedBonds + totalCredits
address(this).balance >= totalLiabilities
```

Recording an incoming bond increases locked bonds and total liabilities by the same exact wei amount. Moving locked funds to a credit changes only liability composition. Withdrawal reduces the caller's full credit and both credit/total liabilities before the ETH call under OpenZeppelin `ReentrancyGuard`; a failed call reverts the transaction. The contract has no arbitrary-recipient credit function, administrator withdrawal, fee, treasury, or ordinary-ETH receive path. Forced ETH remains surplus. In Phase 6, each dispute bond and each settlement needs a per-claim/game lock and one-time settlement guard; aggregate totals alone do not prevent double settlement.

There is no current production path to create a claim, lock a user bond, or finalize one. The harness is test code and must not be deployed. No Base Sepolia deployment, live gas measurement, or audit is claimed.

## Phase 6 integration compatibility

The stored claim includes program bytes, input, budget, trace root, output, context hashes, challenge deadline, and proposer-bond lock state. A derived integrated contract can reuse the private validated storage routines through `_submitClaim` and the shared accounting helpers. The base implementation is non-upgradeable; Phase 6 should be a fresh deployment, not a migration or admin-controlled readiness switch.

The concrete integration contract is in [`phase-6-integration-contract.md`](phase-6-integration-contract.md). Security acceptance conditions are in [`phase-6-security-checklist.md`](phase-6-security-checklist.md). In short, the challenge path must authenticate the challenger's initial state under the stored context, enforce a distinct root and exact bond, preserve a common low boundary, descend to the leftmost differing state, verify the prover's exact one-step successor, and settle only through the locked v1 outcome rules. The same-output fraud vector must remain a regression case.

## Scope and unresolved external material

`docs/ledger-architecture.md`, `docs/ledger-economic-policy.md`, and `docs/ledger-invariants.md` are absent; no Account Ledger addendum has been authored. This gate does not invent one and does not add wallet custody, an off-chain financial ledger, database settlement authority, or withdrawal changes. Current source still supports noncustodial external wallets and contract escrow/pull credits only as future Phase 6 integration semantics.

## Verification

- `pnpm claims:vectors` — passed; regenerated the honest and fraudulent traces and exact proofs from the TypeScript VM/Merkle packages.
- `node scripts/run-foundry.mjs test --match-contract BisectClaimRegistryTest` — 16 passed, 0 failed, including proof authentication for the modified intermediate and a direct comparison with the Solidity VM successor.
- `pnpm lint` — passed on 106 files; 56 informational suggestions, no errors.
- `pnpm format:check` — passed on 106 files.
- `pnpm typecheck` — passed for all 7 applicable workspaces.
- `pnpm test` — 41 passed across 5 files.
- `pnpm build` — VM, Merkle, SDK, and Next.js production builds passed.
- `pnpm e2e` — 1 Playwright Chromium test passed.
- `forge fmt --check --root contracts` — passed.
- `pnpm check:phase5` — passed after the final fixture change. It reran lint, formatting, typecheck, tests, builds, Solidity compilation/ABI generation, cross-language vectors, and full Foundry tests.
- Full Foundry suite — 26 passed across four suites. The claim-registry suite passed 16 tests, including the base deposit/finalization guard and authenticated same-output fraud vector; the verifier suite passed 8 tests, including two 256-case fuzz tests; OpenZeppelin smoke passed; and the accounting invariant passed.
- Accounting invariant — 256 runs, 128,000 handler calls, 0 reverts and 0 invariant failures.

The first aggregate run exceeded Vitest's default five-second limit in an existing test that exercises all VM budgets through the 4095-transition maximum. Its measured runtime was about 5.6 seconds on this Windows environment. The test now has a 15-second per-test limit; the standalone test and final aggregate gate both passed. This changes only the test timeout, not VM behavior.

Foundry reports non-failing warnings while probing optional invariant target-selector methods; its configured handler completed all 128,000 calls. No Base Sepolia deployment, live gas measurement, production economics, or independent audit is claimed.
