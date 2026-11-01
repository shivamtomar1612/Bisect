# Phase 15 — Automated challenger verification

**Status:** Local prototype implemented and exercised against Anvil. **Base Sepolia operation is not enabled or verified.** The contract code and bot remain unaudited.

## Implemented behavior

`apps/challenger` is an optional, separately run TypeScript service. It scans confirmed `ClaimSubmitted` and `ChallengeStarted` events, reads the claim's immutable program, public input, budget, claimed output, context and trace root from `BisectDisputeRegistryV1`, then independently builds the canonical execution using the Phase 2 VM and Phase 3 SDK. It challenges only when the context matches and the authenticated root differs. A matching final output does not excuse an invalid intermediate trace.

For an eligible challenge it creates the real SDK initial-state proof and submits the exact on-chain bond. It follows the locked v1 ordered-child-hash bisection and produces the SDK-derived terminal transition proof. Contract deadlines, move authorization, timeout outcomes, bond settlement and pull credits remain contract-controlled. The bot is an ordinary challenger address and never writes account-ledger records.

## Safety and operations

- Dry-run is the default. Broadcasting requires `BISECT_BOT_BROADCAST=true`, an explicit supported chain and registry address, a dedicated configured signer, and positive total-spend, per-dispute bond and per-transaction gas caps. The bot checks the live chain ID and registry v1 version getters before scanning or writing.
- An unlocked account is permitted only on local Anvil chain `31337`; it is rejected on Base Sepolia. The bot does not read or request user-wallet keys.
- It checks signer balance before each write, bounds gas limit and gas price, records exact wei, uses process locking, and stores checkpoint, attempt, game and transaction state atomically under ignored `.bisect/` paths.
- A durable pending-write record blocks later writes until a transaction receipt is reconciled. Ambiguous submissions are never resent automatically. On an RPC outage, no discrepancy is inferred. Read-cycle retries stop after the configured limit.
- Emergency stop and disable files stop further service actions. On a changed checkpoint hash, event history is replayed from the configured deployment block; challenge attempt and exposure records survive that replay.
- Logs are structured JSONL lifecycle records and omit signing keys. Keep state/log files protected and configure file retention outside the repository.

The bot requires the claim's program and input to be retrievable from chain and its own RPC provider to remain available. The prover trace itself is not downloaded: a differing trace root is enough to challenge under v1, and the prover must reveal child hashes and terminal evidence during the game. The contract applies timeout settlement if a required reveal is withheld.

## Commands

From the repository root:

```powershell
pnpm challenger:help
pnpm challenger status
pnpm challenger inspect <claim-id>
pnpm challenger verify <claim-id>
pnpm challenger dry-run <claim-id>
pnpm challenger start
pnpm challenger stop
```

`start` is a persistent monitor; it is not a deployment command. Do not place a real key in `.env.example`, frontend variables, the state file, or logs. Configure a dedicated signer through a protected process environment or secret manager only after checking the target registry and bond/gas limits.

## Verification evidence

The acceptance run used a fresh local Anvil chain, chain ID `31337`, deployed registry `0x5fbdb2315678afecb367f032d93f642f64180aa3`, real Anvil accounts and mined receipts. No public testnet transaction was sent.

The harness made an honest claim and a dishonest claim whose final output remained `42` but whose intermediate state differed. The bot ignored the honest trace, independently detected the root mismatch, opened a dispute, participated in **6 bisection rounds**, and the real contract returned outcome `3` (`PROVER_TRANSITION_INVALID`). The bot's pull credit was exactly `2,000,000,000,000,000` wei. A third challenge was refused by the total-spend cap; an unfunded signer was refused before transaction submission. Controlled Anvil reorganization was detected and event history replayed without repeating a bond. An unavailable RPC failed closed.

The final transaction/accounting run recorded **19 receipts**, **7,207,265 gas used**, and **12,807,818,065,010,651 wei** in aggregate receipt gas costs across the local scenario. Bot challenge exposure plus its actual gas spend was **2,305,360,716,120,426 wei**. The event replay reconstructed **4,000,000,000,000,000 wei** of deposits, **2,000,000,000,000,000 wei** locked, **2,000,000,000,000,000 wei** withdrawable credits, and **4,000,000,000,000,000 wei** contract custody; the escrow solvency invariant held. These figures are local Anvil measurements, not Base Sepolia observations.

The final repository checks passed: `pnpm test` (71 tests across 11 files), `pnpm lint` (exit 0), `pnpm format:check` (185 files), `pnpm typecheck` (7 workspace projects), `pnpm build` (protocol packages and Next.js production build), `pnpm build:challenger`, `pnpm contracts:build`, and `pnpm contracts:test` (55 tests across 7 Foundry suites). `pnpm challenger:help` also printed the CLI usage. The E2E reconciliation is a direct event replay compared with authoritative contract liability/balance reads. It is not a PostgreSQL indexer test. No database was modified by this phase.

The controlled reorganization scenario replaced a post-checkpoint local test-transfer block. It exercises checkpoint mismatch detection, full event replay, and retained challenge deduplication, but does not simulate removal of the challenge transaction itself.

## Limitations and risks

- No Base Sepolia registry address/deployment block is configured, so public monitoring and public-chain transaction outcomes are unverified.
- The service depends on operator uptime, RPC correctness/availability, timely inclusion, sufficient bot ETH, and chain liveness. A prolonged outage can cause the bot to miss a deadline; the contract can then settle against the missed responder.
- The local JSON state is safety-critical. Protect it from editing or loss; an ambiguous write intentionally blocks automatic action and requires operator reconciliation. There is no multi-host consensus/leader election or external alerting/monitoring backend.
- Full replay after a reorganization is safe against skipped events but may be slow for a long deployment history. Attempts remain deduplicated even if their original transactions are removed; operator review may be needed to resume after such a reorg.
- The local reorganization test does not cover an actual challenge or bisection transaction being removed and re-included on a competing branch.
- The registry address is configured by the operator and checked for v1 version getters, but the bot does not pin an audited runtime bytecode hash. Confirm the deployed address and verified source independently before authorizing a signer.
- Environment-held signer keys can be exposed by a compromised host/process. Use a dedicated low-balance testnet account and a secret manager; this implementation does not integrate an HSM or remote signer.
- Unit and local tests do not establish independent security audit coverage, testnet reliability, data availability guarantees, or production readiness.

## Result

**Phase 15 local acceptance: PASS for the implemented prototype, subject to the limits above.** PostgreSQL-specific reconciliation and Base Sepolia bot operation remain unverified. No Phase 16 work was started.
