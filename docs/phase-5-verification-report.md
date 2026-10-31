# Phase 5 verification — claim registry and pull escrow

**Result: PARTIAL, with the Phase 5 financial foundation implemented.** The registry validates v1 claim context and endpoint evidence, escrows the exact prover bond, finalizes an open claim after its challenge deadline, and exposes caller-only pull withdrawals. Financial operations have deterministic Foundry coverage. The interactive challenge game remains intentionally unimplemented.

## Implemented contract behavior

`contracts/src/BisectClaimRegistry.sol` is non-upgradeable and uses Solidity `0.8.30` with OpenZeppelin Contracts `5.5.0` `ReentrancyGuard`. Its constructor fixes `bondWei`, `challengeWindowBlocks`, and `turnWindowBlocks` using the ranges in `docs/dispute-state-machine.md`. The constructor rejects Base Mainnet chain ID `8453`; Base Sepolia `84532` and local Anvil are permitted. There is no deploy script or deployed address.

`submitClaim(ClaimSubmission)` requires `msg.value == bondWei`, one of the four allowed budgets, a valid bounded VM v1 program, an initial proof at index 0 equal to the public input state, and a terminal proof at index N that is halted and binds `R0` to the claimed output. The verifier derives program, input, and context hashes; callers cannot supply version metadata or override the context. Successful claim IDs begin at 1 and increase monotonically. A repeated `(prover, contextHash, traceRoot, claimedOutput)` is rejected permanently.

`finalize(claimId)` is permissionless only while a claim is open and only when `block.number > challengeDeadline`. It moves the exact locked prover bond into that prover's withdrawable credit without sending ETH. `withdraw()` can withdraw only the caller's full credit. State and aggregate liabilities are reduced before the call; failed sends revert the entire transaction, including state and logs. There is no fee, treasury, administrator, arbitrary-recipient payout, or database authority. Ordinary ETH transfers revert; forced ETH is surplus.

The public accounting views enforce and expose the intended relationship:

```text
totalLiabilities = totalLockedBonds + totalCredits
address(this).balance >= totalLiabilities
```

## Critical limitation and deployment status

There is no challenge entrypoint or bisection game in this phase. The `GAME_ACTIVE` status is a guard for later integration and is exercised only by a test harness; no production call can currently enter that status. Consequently, endpoint checks do **not** prove intermediate transitions. After the deadline, a false intermediate trace can be finalized by this contract and its bond credited to the prover. The challenge-window duration currently delays finalization but does not provide a way to challenge.

Do not deploy or fund this contract as a live optimistic verification protocol. The full v1 dispute game, challenger bond accounting, retries, timeout settlements, terminal adjudication, and security review are required before that use. No Base Sepolia transaction, live gas result, or independent audit is claimed.

The separate Account Ledger addendum is still pending. This phase follows only the owner's current explicit scope and the existing locked dispute state machine; it adds no wallet custody, key storage, off-chain ledger, or database financial records. Test parameters (`1 ETH`, five challenge blocks, three turn blocks) are Foundry fixtures only, not recommended deployment economics. Zero fees are fixed in code for this implementation.

## Shared vectors and SDK

`scripts/generate-phase5-claim-vectors.mts` executes the Phase 2 VM and Phase 3 Merkle package to generate `contracts/test/vectors/claim-registry-v1.json`. Foundry consumes the exact ABI state encodings, root, and proof siblings. The generated SDK ABI is derived from the Foundry artifact by `scripts/generate-claim-registry-abi.mjs`; typed viem reader/writer wrappers require caller-provided clients and address and do not store or create keys.

The verifier library's state-proof function is now `internal` so the registry can reuse the locked ordered proof verifier. It still checks the exact allowed trace budget. No Phase 1–4 VM, Merkle, or transition semantics changed.

## Verification evidence

The final `pnpm check:phase5` gate exited successfully. It ran:

- Biome lint on 103 files: passed with 56 informational suggestions and no errors.
- Biome formatting check: passed on 103 files.
- Workspace TypeScript typechecking: all 7 applicable workspaces passed.
- Vitest: 41 tests across 5 files passed.
- VM, Merkle, SDK, and Next.js production builds: passed.
- Foundry build: passed with pinned Solidity `0.8.30`; ABI regeneration and formatting passed.
- Foundry: 22 tests across 4 suites passed, including 12 claim-registry cases, 8 existing VM/verifier cases, the OpenZeppelin smoke test, and the accounting invariant.
- Accounting invariant: 256 runs and 128,000 handler calls; zero reverts, invariant failures, or discarded calls.
- Existing verifier fuzz tests: 256 uint64 arithmetic cases and 256 signed-branch cases passed.
- `pnpm e2e`: 1 Playwright Chromium test passed.
- `forge fmt --check --root contracts`: passed.

The Foundry invariant runner logs non-failing discovery warnings while probing optional target-selector configuration methods; it successfully targeted the explicit handler, completed all 128,000 calls, and passed the invariant. No check deployed to Base Sepolia or measured a live transaction.

Foundry financial tests cover exact/incorrect bond values, claim ID sequence and ownership, duplicate submissions, inclusive deadline boundaries, premature/repeated settlement, active-state guard, endpoint-context and input/output/budget/program failures, malformed/truncated proofs, caller-only credit, transfer failure rollback, reentrancy, and solvency. A stateful Foundry invariant test checks liability composition and solvency after handler calls.
