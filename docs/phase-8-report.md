# Phase 8 verification report

**Result: PASS for the local indexer, PostgreSQL journal, read API, and reconciliation prototype. PARTIAL for public-network operation:** Base Sepolia RPC chain ID was reachable and verified, but this repository has no deployed registry address or deployment block, so no Base Sepolia contract logs were indexed. This work does not establish production readiness or an independent audit.

## Implemented

- Added an explicit one-registry indexer configuration with chain ID validation, deployment-block backfill, polling, block-hash checkpoints, configurable descendant confirmations, idempotent event keys, and bounded common-ancestor recovery.
- Persisted raw topics/data plus decoded registry event payloads. `OBSERVED`, `CONFIRMED`, and `ORPHANED` block/log statuses distinguish provisional records from confirmed financial projections.
- Added normalized Prisma records for wallets, claims, disputes, deposits/allocations, settlements, withdrawals, blocks/events/checkpoints, ledger accounts, journal transactions/postings, and reconciliation runs. Database checks enforce positive exact-wei entries, deferred debit/credit balance, and append-only journal history.
- Added an exact-wei double-entry journal sourced from confirmed financial events. Deposit and lock are recorded once; settlement transfers liabilities internally; withdrawals reduce the wallet credit liability and custody asset. Fees are disabled.
- Added a read-only, validated, paginated HTTP API for account overview, wallet activity, claims, disputes, deposits, locked bonds, penalties, settlements/rewards, withdrawals, indexer status, and reconciliation. Address parameters filter public data and never authorize value movement.
- Added same-block reconciliation against registry locked bonds, credits, total liabilities, solvency, contract balance, each known wallet credit, and journal duplicate/balance checks.
- Added `docs/ledger-reconciliation.md`, Phase 8 CI coverage, root scripts, configuration examples, and ADR-0015.

## Database migrations

Prisma reports **8 migrations applied, schema up to date**:

1. `20261031000000_health_check` (existing baseline)
2. `20261031202211_phase8_indexer_ledger`
3. `20261031203220_raw_chain_log_data`
4. `20261031204027_persist_confirmation_policy`
5. `20261031204311_ledger_normal_side`
6. `20261031204500_ledger_normal_side`
7. `20261031204519_dispute_read_model_phase`
8. `20261031204600_unique_journal_postings`

The migration deploy command completed without deleting or resetting existing data. Prisma Client generation and schema validation passed.

## Actual integration evidence

The local integration test started an isolated Anvil chain, deployed the actual `BisectDisputeRegistryV1` artifact, submitted claims and challenges from funded Anvil accounts using real local test ETH, and indexed emitted logs into the running PostgreSQL database. The final full-gate run used chain ID `1453966104`, registry `0x5fbdb2315678afecb367f032d93f642f64180aa3`, deployment block `1`, and a test confirmation depth of two descendants.

Observed results from the passing run:

- 17 real registry events confirmed initially; 19 canonical confirmed events after the controlled reorganization and replacement withdrawal.
- 2 claims, 3 disputes, 5 bond deposits, 4 settlements, and 2 canonical withdrawals projected.
- 10 initial journal transactions with 21 balanced postings before the reorganization. The reorg added one inverse entry, and the replacement withdrawal was journaled; final total: 13 journal transactions and 27 postings. PostgreSQL constraints and an explicit balance query found no unbalanced entry.
- The dishonest prover's bond was projected as `SLASHED`; locked amounts and wallet credits matched the contract.
- Before the controlled withdrawal reorg, the challenger credit and contract balance were each `2000000000000000` wei, with zero locked liabilities and zero surplus. Reverting the confirmed withdrawal orphaned its log, appended one reversal, and restored that credit exactly. A replacement withdrawal brought final contract balance, locked liabilities, withdrawable credits, and unallocated surplus to `0` wei.
- Reconciliation returned `MATCH` before and after the reorganization and replacement withdrawal.
- Replaying twice and starting a fresh indexer process created no duplicate journal entries.
- The integration test exercised every public read route, claim and wallet-activity cursor pagination, invalid limit/address/cursor/status rejection, GET-only behavior, and journal immutability/balance database constraints.

The controlled reorganization orphaned withdrawal transaction `0xf8b65341732d4d44d9be4ca21af01e0f97c4a5ab500cbac8fa19fd826be612b7`; replacement withdrawal transaction `0xc33a740e1ca5f32bb4963872421aabfe353527f2701d20e809cb7e7a36829c68` was mined on the replacement history. These are local Anvil transactions and are not Base Sepolia transactions.

## Commands and outcomes

| Command/check                                                         | Result                                                                                                                                          |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                      | Passed; workspace lockfile consistent.                                                                                                          |
| `pnpm --filter @bisect/indexer db:validate`                           | Passed.                                                                                                                                         |
| `pnpm --filter @bisect/indexer db:generate`                           | Passed with Prisma 7.10.1.                                                                                                                      |
| `pnpm --filter @bisect/indexer db:deploy` and `prisma migrate status` | Passed; 8 migrations applied, no pending migrations.                                                                                            |
| `pnpm db:health`                                                      | Passed; PostgreSQL accepted connections.                                                                                                        |
| `pnpm lint`                                                           | Passed with exit code 0; 158 informational suggestions, zero warnings, and zero errors.                                                         |
| `pnpm format:check`                                                   | Passed.                                                                                                                                         |
| `pnpm typecheck`                                                      | Passed across all seven applicable workspace projects.                                                                                          |
| `pnpm test`                                                           | Passed: 51 tests across 6 files.                                                                                                                |
| `pnpm build`                                                          | Passed for VM, Merkle, SDK, and Next.js production build.                                                                                       |
| `pnpm contracts:build`                                                | Passed with Foundry 1.8.7 / Solidity 0.8.30.                                                                                                    |
| `pnpm contracts:test`                                                 | Passed: 55 Foundry tests, including verifier fuzz tests and two stateful accounting invariants (256 runs and 128,000 calls each; zero reverts). |
| `pnpm indexer:test:integration`                                       | Passed against actual local PostgreSQL and Anvil transactions; details above.                                                                   |
| `pnpm check:phase8`                                                   | Passed as the full Phase 8 gate after the final API and confirmation-boundary changes.                                                          |
| `pnpm check:base-sepolia`                                             | Passed; public RPC returned chain ID `84532`. No registry address/deployment was available to index.                                            |
| `pnpm check:environment`                                              | Passed for Node.js 24.19.0, pnpm 11.25.0, Forge/Anvil/Cast 1.8.7, Docker 29.9.2, and Compose 5.6.1.                                             |
| CI YAML parse                                                         | Passed locally. GitHub-hosted CI has not been run from this workstation.                                                                        |

## Limits and remaining risks

- Six descendant blocks is a configurable service confirmation threshold, not proof of finality. A deeper reorganization than the configured limit stops indexing for operator review.
- The prototype assumes one active indexer writer per chain/registry. No distributed leader lease or multi-provider quorum is implemented.
- Correct backfill depends on the configured RPC provider serving complete historical headers and logs. Reconciliation detects many omissions and accounting errors but cannot prove an RPC or database is honest.
- Reconciliation currently checks at most 1,000 wallet identities per run and returns a discrepancy beyond that limit rather than claiming a partial match.
- Read models can be rebuilt; journal history is append-only. Raw orphaned event records remain in PostgreSQL, but services and operators still need backups, access controls, monitoring, and retention policy.
- Base Sepolia has no deployed address configured. The successful local integration does not establish testnet behavior or production security.
- Contract balances remain authoritative. The indexer and API are informational and never correct on-chain state.

**Phase 8 gate: PASS for local development; testnet indexing readiness: PARTIAL pending an actual deployment address/block and production operations review.**
