# Phase 12 wallet and ledger status

**Status: PARTIAL.** The wallet, claim, withdrawal, and ledger application paths are implemented and browser-tested for safe unavailable states. Real financial browser transactions and indexed account activity remain unverified until a verified deployment is configured or a dedicated local Anvil wallet test is completed.

## Implemented

- The browser uses an external EIP-1193 wallet. BISECT never receives a private key or recovery phrase. Wallet connection, permission revocation where supported, and wallet-approved chain switching are available.
- Claim submission consumes the Program Studio's canonical Phase 5 payload, reads the live contract bond, and sends the exact payable value. Withdrawal reads the live contract credit and calls the pull-based `withdraw()` function. Both wait for a successful receipt before displaying confirmation. Wallet rejection, RPC failure, reversion, wrong chain, missing contract, and insufficient bond balance are surfaced as errors.
- The Account Ledger distinguishes external wallet balance, contract withdrawable credit, locked prover/challenger bonds, confirmed deposits and withdrawals, rewards and penalties. Confirmed activity is paginated, filterable, and exportable as CSV. Chain credit and indexed credit are shown separately to expose indexer lag.
- The read-only web API proxies the Phase 8 indexer with wallet-address and pagination validation. It calculates exact wei totals using bigint and does not authorize value movement.

## Configuration

Set `NEXT_PUBLIC_BISECT_CHAIN_ID=84532`, `NEXT_PUBLIC_BISECT_RPC_URL=https://sepolia.base.org`, and `NEXT_PUBLIC_BISECT_REGISTRY_ADDRESS` to the verified deployed registry address when it exists. The address is intentionally absent now. For local Anvil testing, set chain ID `31337`, a local RPC URL, and the locally deployed registry address. Set the existing indexer API URL for financial history. These are public frontend values; never put a private key in a `NEXT_PUBLIC_` variable.

## Verification boundary

No Base Sepolia deployment address was supplied, so real public testnet claim and withdrawal transactions cannot be verified yet. No completed transaction or balance is fabricated. The browser will disable claim submission when the registry address is missing. The Solidity registry, indexer, and protocol remain unaudited.

## Checks executed

- `pnpm --filter @bisect/web typecheck`: passed after the final ledger input-validation edit.
- `pnpm test`: passed, 58 tests in 8 files.
- `pnpm --filter @bisect/web build`: passed twice, including after the final Studio copy and registry bytecode checks; Next.js produced the dynamic account ledger API and frontend routes.
- `pnpm e2e`: passed, 18 existing Chromium tests against the production server.
- `pnpm exec playwright test tests/e2e/phase12-wallet.spec.ts tests/e2e/program-studio.spec.ts`: passed, 11 Chromium tests against the final production build, including 3 new Phase 12 checks.
- An HTTP request to `/api/account-ledger?address=invalid` returned 400 as designed.
- Targeted Biome checks on the 7 changed frontend files passed after import sorting and formatting. Repository-wide `pnpm lint` and `pnpm format:check` failed because the Windows working tree has CRLF line endings in 154+ otherwise untouched files. The phase did not rewrite those files.
- `pnpm contracts:test`: passed, 55 Foundry tests across 7 suites, including 256-run solvency and dispute accounting invariants.

Local Anvil browser wallet transactions, real indexed Phase 12 financial history, and Base Sepolia receipts have not been verified in this phase. Those acceptance checks remain open.

## Follow-up once deployment exists

Record the verified address and deployment block, rebuild the frontend with the public environment variables, connect an externally controlled testnet wallet, then verify a claim deposit and pull withdrawal with real receipts and indexed records. Check that the configured chain ID, RPC, registry bytecode, and indexer deployment all match before enabling the UI.
