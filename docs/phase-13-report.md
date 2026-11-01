# Phase 13 challenger interface

**Status: PARTIAL.** The challenger interface and transaction paths are implemented against the v1 dispute ABI. A browser demonstration of real bonded transactions and indexed settlement remains unverified because no registry address is configured for the current frontend.

## Implemented

- `/challenge/[claimId]` reads the program, input, output, root, budget, deadlines, bond and game state from the configured contract. It displays indexer lag separately and states that a root does not establish trace availability.
- Independent execution uses the Phase 2 VM and Phase 3 ordered Merkle SDK. Challenge admission requires a different root under the same context, a locally verified initial-state proof, an open claim, an eligible wallet and an unexpired deadline.
- The opening action encodes the real `challenge` call and exact challenger bond. A separate live gas estimate uses the current RPC gas price. Wallet submission waits for a successful receipt.
- Active game controls derive ordered child hashes from the authenticated local trace, enforce the current actor/deadline in the UI, generate adjacent-state terminal proofs, and call the actual `revealChildren`, `revealTerminal` or `claimTimeout` methods. Contract checks remain authoritative.
- The latest game, outcome, bond status and contract withdrawal credit remain visible after a game closes. Credits are explicitly distinguished from withdrawn ETH and linked to the Account Ledger.

## Verification

- `pnpm test`: 61 tests in 9 files passed, including new challenger evidence tests.
- `pnpm typecheck`: passed across all 7 applicable workspace projects after the final edit.
- `node scripts/run-foundry.mjs test --match-contract BisectDisputeRegistryV1Test`: 10 dispute contract tests passed, including honest/dishonest outcomes, stale rounds, invalid proofs, timeouts and bond accounting.
- `pnpm --filter @bisect/web build`: passed twice, including the final code; the production route `/challenge/[claimId]` was generated.
- `pnpm phase6:anvil`: passed against isolated Anvil chain 31337. The existing real contract walkthrough mined 21 transactions, completed 6 bisection rounds, selected differing state index 1, resolved `PROVER_TRANSITION_INVALID`, credited the challenger 2 test ETH, and executed a withdrawal. Terminal resolution used 199,088 gas and withdrawal used 40,198 gas. This is a contract/SDK walkthrough, not a Phase 13 browser-wallet walkthrough.
- Targeted Biome check of 7 changed code/test files: passed with 2 informational suggestions.
- `pnpm exec playwright test tests/e2e/challenge.spec.ts`: passed twice, including against the final production build; 2 Chromium route tests after changing a brittle default-404 text expectation to an HTTP-status assertion.
- Repository-wide `pnpm lint --reporter=summary` and `pnpm format:check --reporter=summary`: failed on CRLF formatting in 149 largely untouched Windows working-tree files, the same pre-existing checkout condition observed in Phase 12. Changed-file Biome checks passed.

## Remaining verification and assumptions

- No verified Base Sepolia registry address, deployment block or published prover trace is configured. No public dispute transaction, gas cost, settlement or wallet credit is claimed as observed.
- The UI can independently reconstruct the unique valid trace from the on-chain program and input. It cannot reconstruct a dishonest prover's committed intermediate states from a root. Prover trace publication and retention remain an external availability assumption.
- A locally tested wallet can only reveal a subtree or terminal proof if its regenerated trace matches its on-chain commitment. Dishonest traces require the actual committed artifact to be available to their author.
- Client controls are advisory. Solidity verifies all financial, turn, deadline, context and ordered-proof rules. The protocol remains unaudited.
