# Phase 10 product landing page, overview, and explorers

## Result

**PASS for the local read-only product experience and its Phase 8 indexer integration. PARTIAL for Base Sepolia data:** the repository has no configured public registry deployment, so this phase did not index or display Base Sepolia activity. The product is a testnet prototype; the protocol remains unaudited. Phase 11 was not started.

## Delivered

- Replaced the project-status front page with a product landing page explaining bounded off-chain execution, prover trace commitments, active challengers, ordered child-hash bisection, and the disputed on-chain step. It describes trace retrieval and challenger-liveness assumptions and labels the diagram as illustrative rather than live protocol activity.
- Added a server-rendered `/dashboard` view. It reads claim/dispute counts, finalized claims, locked test-ETH exposure, recent confirmed contract events, indexed chain, registry, checkpoint, confirmation depth, and lag from `GET /v1/overview`. Missing or malformed data is represented as unavailable/error rather than invented zeroes.
- Connected claims and disputes explorers to the existing paginated Phase 8 endpoints. Search and status filters use the API; lists show participants, claim/program context and trace commitments, deadlines, bond amounts, bisection progress, confirmed settlements, and canonical event references. Claim IDs link to server-rendered `/claims/{claimId}` details.
- Kept Account Ledger as a read-only Phase 9 route. No transaction signing, claim submission, challenge, or withdrawal interaction was added.
- Restricted explorer transaction/address links to Base Sepolia chain ID 84532. Other/local chain records are identified as non-Base-Sepolia and do not link to Basescan.
- Added an additive Prisma migration and `bisectionRounds` dispute read-model projection so the explorer can report rounds from indexed `BisectionLevelResolved` events. Existing chain data was not reset.
- Added strict server-side read API response validation, a 5-second request timeout, no-store fetches, and local HTTP/remote HTTPS URL validation. The endpoint is configured with server-only `BISECT_INDEXER_API_URL`; it is never exposed as `NEXT_PUBLIC_*`.
- Declared the already-used Tailwind CSS v4 package (`tailwindcss` 4.3.3) directly in the web workspace. A clean development compile exposed that the stylesheet imported Tailwind without a direct workspace dependency; the lockfile now records it explicitly.

## Real local integration evidence

`pnpm phase10:web-integration` passed against an isolated Anvil chain and the running PostgreSQL/indexer API. The final run submitted actual local test-ETH transactions through the integration harness, indexed canonical events, and loaded the populated web views in Chromium. It used chain ID `1168104142` and local registry `0x5fbdb2315678afecb367f032d93f642f64180aa3`; this is local Anvil evidence, not Base Sepolia activity.

The run observed 17 real registry events initially and 19 canonical events after the controlled reorganization. The final projections included 2 claims, 3 disputes, 5 bond deposits, 4 settlements, and 2 withdrawals. It verified API reads, pagination/filtering/validation, idempotent replay, reconciliation, and populated dashboard, claims, disputes, and claim-detail routes. At 375px, it also verified that populated claim and dispute tables scroll within their own containers without widening the page. The journal remained balanced, and reconciliation matched the contract after replay/reorganization.

Four browser captures from that run are stored in [`docs/phase-10-evidence`](phase-10-evidence/):

- [Dashboard with local Anvil data](phase-10-evidence/dashboard-anvil.png)
- [Claims explorer with local Anvil data](phase-10-evidence/claims-anvil.png)
- [Disputes explorer with local Anvil data](phase-10-evidence/disputes-anvil.png)
- [Claim detail with local Anvil data](phase-10-evidence/claim-detail-anvil.png)

These examples show local test balances, not production or public testnet funds. In particular, no Base Sepolia registry address or deployment block is configured in this repository.

## Verification

| Command                          | Observed result                                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm install --frozen-lockfile` | Passed; lockfile policy verification succeeded and workspace dependencies were already satisfied.                                                      |
| `pnpm lint --reporter=summary`   | Exit 0; 286 informational Biome suggestions, no blocking diagnostics.                                                                                  |
| `pnpm format:check`              | Passed; 153 files checked.                                                                                                                             |
| `pnpm typecheck`                 | Passed across all 7 applicable workspace projects.                                                                                                     |
| `pnpm test`                      | Passed; 58 tests in 8 files.                                                                                                                           |
| `pnpm build`                     | Passed for VM, Merkle, SDK, and Next.js production build. `/` prerendered; dashboard, claim explorer/detail, and dispute explorer render dynamically.  |
| `pnpm e2e`                       | Passed; 10 Chromium tests, including landing-page explanation, API-unavailable states, navigation, mobile overflow, and wallet-not-connected behavior. |
| `pnpm web:a11y`                  | Passed; 1 Chromium accessibility smoke test for control names and light/dark contrast.                                                                 |
| `pnpm phase10:web-integration`   | Passed; populated web views verified against real local Anvil transactions and the Phase 8 PostgreSQL-backed API.                                      |
| `pnpm db:deploy`                 | Passed; additive `20261101000000_dispute_bisection_rounds` migration applied without database reset.                                                   |

Playwright output included non-fatal Windows `NO_COLOR`/`FORCE_COLOR` and slow-filesystem notices. They did not fail tests.

The first clean development-server integration attempt exposed the missing direct Tailwind dependency and stale generated Next.js development cache. The workspace dependency was added and only that generated cache was moved aside; a fresh Tailwind compilation and the populated browser integration then passed. No source files or database data were removed.

## Remaining limits

- The web app is read-only. Account Ledger is a future layout and does not query or authorize withdrawal actions.
- A Merkle root does not provide trace data. Landing copy states the publication/retrieval assumption; Phase 10 does not add an archive service or data-availability guarantee.
- The dashboard is only as fresh as the configured indexer's confirmed canonical checkpoint and configured confirmation policy. Confirmation depth is not finality.
- No Base Sepolia registry address is configured, so no public-network claims, disputes, explorer links, or financial exposure were available for verification.
- Browser tests and local Anvil evidence do not establish an independent audit, production security, testnet deployment, censorship resistance, or participant liveness.
