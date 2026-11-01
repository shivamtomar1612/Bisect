# Phase 14 interactive bisection visualizer

**Status: PARTIAL.** The real-event timeline API, verifier and responsive replay UI are implemented. A browser replay of a fully executed indexed bisection awaits a configured registry and indexed deployment. The educational 1,023-transition walkthrough is explicitly a simulation.

## What the visualizer shows

- Real route: `/disputes/{claimId}/{gameNumber}`. The Phase 8 API returns only confirmed canonical events with block, transaction and log order. It filters the exact claim and game, caps history and reports indexer lag.
- The browser replays v1 ordered child hashes. For each complete round it checks both parent commitments with the same domain-separated Keccak node hash used by the VM, verifies the contract-reported retained subtree, and shows its exact index range, split, choice and remaining candidate states. A missing or contradictory event stops reconstruction; no round is invented.
- Terminal evidence and the settlement event are checked against the isolated index, outcome, beneficiary and v1 zero-fee bond payout. The UI distinguishes indexed bond status, credited entitlement and the winner's live contract withdrawable balance where available.
- When the on-chain program and input reconstruct a trace matching one of the committed roots, the UI generates and verifies the final state inclusion proof with the SDK. If a dishonest trace is unavailable, it says so. Ordered child openings are authenticated by the contract but are not mislabeled as standalone leaf inclusion proofs.
- Buttons support previous, next, restart and direct round selection. Native controls support keyboard use; reduced motion disables interval animation.

## Measured educational case

`/disputes/demo` uses the real BISECT VM and Keccak tree for an addition program with **1,023 transitions and 1,024 states**. One intermediate state at index **700** is altered in a second committed trace while the final output remains the same. The unit test actually computes both trees and measures **10** ordered hash reductions, with candidate counts **512, 256, 128, 64, 32, 16, 8, 4, 2, 1**. The view labels the case **EDUCATIONAL SIMULATION**. It contains no blockchain transactions, gas, bond or settlement result.

## Verification and limits

- `pnpm test`: 65 tests across 10 files passed, including replay ordering, forged child hashes, missing rounds, exact financial beneficiary and the measured 1,023-transition case.
- `pnpm --filter @bisect/indexer typecheck` and `pnpm --filter @bisect/web typecheck`: passed.
- `pnpm db:health`: PostgreSQL accepted connections.
- `pnpm indexer:test:integration`: passed against actual isolated Anvil/PostgreSQL; the new timeline endpoint returned confirmed opening and credit events. The run indexed 19 final confirmed events, reconciled contract/database balances, and passed restart and reorganization checks. Its tested game resolved by timeout, so it does not prove a populated ten-round browser replay.
- Targeted Biome checks on changed files pass. Repository-wide lint and formatting fail because Windows checkout CRLF line endings affect 145 largely untouched files, the pre-existing local formatting condition.
- `pnpm --filter @bisect/web build`: passed; both `/disputes/demo` and `/disputes/[claimId]/[gameNumber]` were generated.
- `pnpm exec playwright test tests/e2e/dispute-visualizer.spec.ts`: passed 3 Chromium tests after narrowing an ambiguous text locator. The suite exercised ten-round replay, keyboard action, 375px layout and the missing-indexer state. It did not submit a wallet transaction.

The protocol remains unaudited. Trace availability and active participants remain necessary for fraud-proof soundness. The indexer is a derived read model; contract state and receipts remain financial authority.
