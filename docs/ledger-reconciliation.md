# Phase 8 indexer, journal, and reconciliation

## Scope and authority

The Phase 8 service is a read-only projection of one configured `BisectDisputeRegistryV1` deployment. The contract and its canonical chain state remain authoritative. The indexer cannot submit transactions, change contract balances, authorize a wallet, or use an address filter as proof of ownership. API responses are public chain-derived data and are not a substitute for a fresh contract read when making a financial decision.

The standalone Account Ledger addendum remains pending. This document specifies only the operational journal needed to represent the existing v1 native-ETH bond and withdrawal-credit events. It adds no custody, protocol fee, settlement outcome, or on-chain rule.

## Chain ingestion and confirmation

Configuration must explicitly identify `INDEXER_RPC_URL`, `INDEXER_CHAIN_ID`, `INDEXER_CONTRACT_ADDRESS`, and `INDEXER_DEPLOYMENT_BLOCK`. The service verifies the RPC chain ID, records the deployment block, and refuses to resume if the persisted deployment block or confirmation depth differs from configuration. `INDEXER_SCAN_RANGE` defaults to 500 blocks, `INDEXER_CONFIRMATIONS` to 6 descendants, `INDEXER_MAX_REORG_DEPTH` to 128 blocks, and the poll interval to 4 seconds. Bounds are validated at startup.

For an observed head `H` and configured depth `D`, block `B` is confirmed only after `H >= B + D`; the indexer advances the confirmed checkpoint to `H - D`. `D` must be at least one; zero-confirmation operation is rejected. Thus the default means six descendant blocks, not six total blocks including the event block. This is an operational risk threshold, not EVM finality or a consensus guarantee. Until confirmation, blocks and events have `OBSERVED` status and do not create journal entries, settlements, withdrawals, or confirmed read-model rows. Confirmed records are exposed only after their block is within the confirmed checkpoint.

Each scanned block retains chain ID, height, hash, parent hash, and timestamp. Each log retains chain ID, block number/hash, transaction hash/index, log index, normalized contract address, event name, decoded JSON payload, raw topics, raw data, and status. The database uniqueness key is `(chainId, blockHash, transactionHash, logIndex)`, which makes replay of the same canonical log idempotent while preserving logs from competing block hashes.

The checkpoint stores deployment height, last scanned height/hash, confirmed height, and confirmation depth. On restart the indexer checks the stored tip against RPC. A mismatch causes a bounded parent-hash walk to a common ancestor. Events and blocks above the ancestor are marked `ORPHANED`; raw event records and journal history are preserved. The journal receives inverse postings for any orphaned financial journal entry. Derived claim, dispute, deposit, allocation, settlement, and withdrawal tables are rebuilt by replaying canonical confirmed logs. If no common ancestor is found within `INDEXER_MAX_REORG_DEPTH`, the worker stops with an operator-visible error rather than guessing.

Operate one indexer writer per chain/contract checkpoint. The prototype does not implement a distributed leader lease. Multiple writers may collide on database uniqueness constraints and should not be deployed as active replicas. Polling is used; the implementation does not depend on websocket subscriptions. RPC providers must support historical block headers and `eth_getLogs` from the configured deployment block.

## Normalized records

Prisma models cover wallet account identity scoped by chain, canonical block/log records, indexer checkpoints, claim and dispute projections, bond deposits and allocations, settlement and withdrawal records, ledger accounts, journal transactions/postings, and reconciliation history. EVM `uint256` amounts are stored as PostgreSQL `NUMERIC(78,0)` and manipulated as `bigint` or validated decimal integer strings. JavaScript `Number` is rejected for wei values. PostgreSQL checks reject nonpositive postings and negative reconciliation totals; unique indexes prevent duplicate event projection and duplicate posting tuples.

The projection consumes the registry events declared in `BisectClaimRegistry.sol` and `BisectDisputeRegistryV1.sol`: `ClaimSubmitted`, `ChallengeStarted`, `DisputeChildrenRevealed`, `BisectionLevelResolved`, `TerminalEvidenceRevealed`, `GameResolved`, `GameTimedOut`, `GameBondCredited`, `ClaimFinalized`, and `Withdrawal`. An unknown or malformed event is an error; it is not silently discarded. The financial journal is sourced only from the bond-lock, bond-credit, finalization, and withdrawal events. `GameBondCredited` is the game-payout event used for ledger recognition; `GameResolved` and `GameTimedOut` update dispute state but do not create a second payout.

## Double-entry conventions

Accounts are scoped by chain and registry address. Asset accounts use normal debit balances; locked and withdrawable liabilities use normal credit balances. Every journal transaction has at least two positive postings and equal total debit and credit. A deferred PostgreSQL constraint checks balance at transaction commit, and database triggers reject updates/deletes to journal transactions and postings.

| Chain movement                                            | Debit                                                              | Credit                                          | Journal treatment                                                                                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Prover bond accepted and locked (`ClaimSubmitted`)        | Registry ETH custody (asset)                                       | Claim-specific prover locked liability          | One journal transaction. This is the ETH receipt and bond lock together; no second deposit transaction is posted.                             |
| Challenger bond accepted and locked (`ChallengeStarted`)  | Registry ETH custody (asset)                                       | Claim/game-specific challenger locked liability | One journal transaction; no duplicate deposit posting.                                                                                        |
| Prover wins a game (`GameBondCredited`, outcomes 1–2)     | Claim/game challenger locked liability                             | Prover wallet withdrawable liability            | Reclassifies the challenger bond to the prover's pull credit; no ETH leaves custody.                                                          |
| Challenger wins a game (`GameBondCredited`, outcomes 3–5) | Claim prover locked liability and game challenger locked liability | Challenger wallet withdrawable liability        | Reclassifies both bonds to one challenger credit. The read model labels the prover deposit `SLASHED`; the challenger's deposit is `RELEASED`. |
| Claim finalizes (`ClaimFinalized`)                        | Claim prover locked liability                                      | Prover wallet withdrawable liability            | Reclassifies the prover bond into the pull credit.                                                                                            |
| Wallet withdraws (`Withdrawal`)                           | Wallet withdrawable liability                                      | Registry ETH custody (asset)                    | Reflects ETH leaving escrow and reducing the liability.                                                                                       |
| Protocol fee                                              | None                                                               | None                                            | Fees are disabled. Forced/unsolicited ETH is an unallocated contract surplus and is not journaled as user property.                           |

The aggregate registry custody asset is debited only when a bond enters and credited only when a withdrawal leaves. Settlement is an internal liability reallocation and cannot create an asset. The database never sends ETH. The contract's invariant remains `balance >= locked liabilities + withdrawable liabilities`; surplus ETH is not assigned to users.

## Reconciliation

`pnpm indexer:reconcile` reads the checkpoint's exact confirmed block, verifies that its hash still matches RPC, then reads the contract balance, `totalLockedBonds`, `totalCredits`, `totalLiabilities`, `accountingInvariantHolds`, and each indexed wallet's `withdrawableCredit` at that same block number. It compares those values against confirmed journal balances, verifies `totalLiabilities = totalLockedBonds + totalCredits`, checks insolvency, and queries the journal for duplicate postings and unbalanced transactions. A match records the block number and hash; a mismatch or failed RPC/database read is persisted in `ReconciliationRun` and surfaced by `/v1/reconciliation`.

`unallocatedSurplusWei` is reported when actual contract ETH is above recognized liabilities. No database task can correct an on-chain balance. If a reconciliation mismatch occurs, operators should stop treating the indexed view as current, preserve the database/event evidence, rerun indexing and reconciliation, and investigate the named discrepancy before any deployment decision.

The current reconciliation reads at most 1,000 known wallet accounts in one run. More than 1,000 produces an explicit discrepancy; it is not silently truncated and reported as a match. A provider that serves incorrect but internally consistent historical data, a compromised database/RPC, or a chain reorganization beyond the configured recovery bound remains outside what this service can prove.

## Read-only API

The API binds to `127.0.0.1:8787` by default (`INDEXER_API_HOST` and `INDEXER_API_PORT` are validated configuration). It accepts GET requests only, caps pages to 100 rows, validates addresses, filters, cursors, and unknown query parameters, and serializes integer amounts as decimal strings. Routes are:

- `GET /healthz` and `GET /v1/indexer/status`
- `GET /v1/accounts/:address/overview`
- `GET /v1/wallets/:address/activity`
- `GET /v1/claims`, `GET /v1/disputes`
- `GET /v1/deposits`, `GET /v1/locked-bonds`, `GET /v1/penalties`
- `GET /v1/settlements`, `GET /v1/rewards`, `GET /v1/withdrawals`
- `GET /v1/reconciliation`

An address in a path or query is only a public-data filter. There is no account authentication or value-moving API in this service.

## Local development and verification

1. Configure `.env` for the local PostgreSQL service, then run `pnpm db:up`, `pnpm db:generate`, and `pnpm db:deploy`.
2. Set the four required `INDEXER_*` chain/registry variables for a real deployed registry before starting the indexer.
3. Run `pnpm indexer:dev` to poll, `pnpm indexer:api` to serve reads, `pnpm indexer:run` for one poll, or `pnpm indexer:reconcile` to create a reconciliation record.
4. Run `pnpm indexer:test:integration` with PostgreSQL available and Foundry built. It launches a fresh local Anvil process, deploys the actual registry with funded local test accounts, indexes mined logs, replays after a child-process restart, and uses `evm_snapshot`/`evm_revert` for a controlled reorganization.

The local integration uses a test confirmation depth of two to keep the scenario fast. It does not connect to Base Sepolia or prove deployment, finality, independent audit, or production readiness. See `phase-8-report.md` for the observed run evidence.
