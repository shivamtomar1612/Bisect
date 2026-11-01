# Phase 17 — Base Sepolia release and operations report

**Decision: release preparation is verified locally; public testnet deployment is not complete.** No contract, web app, indexer, database, or challenger service was deployed to Base Sepolia or a hosting provider. The public deployment and financial demonstration are **NO-GO** until the missing signer/funding, reviewed immutable constructor parameters, hosting target, and public service configuration are supplied.

## Release revision and versions

- Audited starting Git revision: `6b86a0a24d4e4222755509bc7e2a88974eb1674c` (Phase 16).
- Runtime and toolchain used: Node.js `v24.19.0`, pnpm `11.25.0`, Foundry Forge/Anvil/Cast `1.8.7`, Solidity `0.8.30`, optimizer enabled for 200 runs, OpenZeppelin Contracts `v5.5.0`, Next.js `16.4.3`, and Prisma `7.10.1`.
- The working tree changes for this report are intended for a separate Phase 17 preparation commit. The audited starting revision is not a deployed build identifier.

## Release gate results

| Gate                               | Result       | Evidence                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frozen pnpm install                | PASS         | `pnpm install --frozen-lockfile` completed with no lockfile changes.                                                                                                                                                                                                                                                                                                  |
| Repository lint                    | PASS         | `pnpm lint` exited 0. Biome reported 16 warnings and 610 informational suggestions, with no errors. The new deployment files also passed focused Biome checks.                                                                                                                                                                                                        |
| Formatting                         | PASS         | `pnpm format:check` checked 195 files with no changes required.                                                                                                                                                                                                                                                                                                       |
| TypeScript typecheck               | PASS         | `pnpm typecheck` completed for all 7 applicable workspace projects.                                                                                                                                                                                                                                                                                                   |
| TypeScript tests                   | PASS         | `pnpm test`: 12 files, 73 tests passed.                                                                                                                                                                                                                                                                                                                               |
| Production build                   | PASS         | `pnpm build` built VM, Merkle and SDK packages, then completed the optimized Next.js 16.4.3 production build.                                                                                                                                                                                                                                                         |
| Solidity compilation               | PASS         | `forge build --force --root contracts` compiled 13 files with solc 0.8.30. One non-failing existing warning remains in the benchmark harness loop.                                                                                                                                                                                                                    |
| Solidity tests                     | PASS         | `pnpm contracts:test`: 59 tests passed across 8 suites, including 256-run fuzz tests and two 256-run / 128,000-call stateful accounting invariants. No failures or counterexamples.                                                                                                                                                                                   |
| Browser suite                      | PASS         | `pnpm e2e`: 27 Chromium tests passed, including wallet-safe states, Studio proofs, dispute replay, responsive screens and accessibility smoke tests.                                                                                                                                                                                                                  |
| PostgreSQL/indexer integration     | PASS locally | `pnpm indexer:test:integration` used actual local Anvil transactions and PostgreSQL. It indexed 19 canonical events after a controlled reorg, balanced all 27 journal postings, and reconciled contract liabilities to the ledger. Details below.                                                                                                                     |
| Database read/write smoke          | PASS locally | `pnpm db:smoke` verified Prisma PostgreSQL read/write (temporary row 20).                                                                                                                                                                                                                                                                                             |
| Base Sepolia RPC identity          | PASS         | `pnpm check:base-sepolia` received chain ID `84532` from the configured public RPC. This is a read-only check.                                                                                                                                                                                                                                                        |
| Docker restart health check        | BLOCKED      | `pnpm check:all` reached its database restart/persistence probe, then Docker Desktop failed `docker exec` with `OCI runtime exec failed ... error starting setns process: fork/exec /proc/self/fd/6: no such file or directory`. The container reports `running unhealthy`, although direct PostgreSQL TCP access, Prisma smoke, and the integration suite succeeded. |
| Public deployment transaction      | NOT RUN      | No locally protected deployer keystore/account or funded deployer was available. No Base Sepolia transaction was broadcast.                                                                                                                                                                                                                                           |
| Hosted web/API/database            | NOT RUN      | No hosting target, cloud credentials, public HTTPS endpoint, managed PostgreSQL, backups, or monitor/alert service is configured.                                                                                                                                                                                                                                     |
| Base Sepolia financial walkthrough | NOT RUN      | No public registry exists; claim, challenge, settlement, withdrawal, and public ledger reconciliation were not attempted.                                                                                                                                                                                                                                             |

## Contracts, economics, and deployment configuration

The sole intended deployment target is `BisectDisputeRegistryV1`, the integrated claim registry, verifier, dispute protocol, escrow, and pull-withdrawal contract. `BisectClaimRegistry` is deliberately fail-closed; the Phase 16 direct-execution benchmark is test-only. The dispute registry has no owner or upgrade/administrator withdrawal path. The Foundry script checks chain ID `84532`, validates explicit constructor environment values before casting, deploys one registry, and reads back its version and immutable configuration. It never reads a private key from an environment variable.

The constructor requires a nonzero `uint96` bond, a challenge window of 1–1,000,000 blocks, and a turn window of 1–100,000 blocks. The contract has no protocol fee. The proposed demonstration values (`0.001` test ETH, `3,600` challenge blocks, `120` turn blocks) are documented for review only; they have **not** been approved as a public deployment policy and are not defaults in the script. Block windows do not promise wall-clock durations.

`deployments/base-sepolia.json` explicitly remains `not-deployed`, with null address, deployer, constructor values, transaction, block, and runtime-code hash. No placeholder address is used as a deployment. The frontend and indexer address settings remain unset. Existing generated ABIs are retained; no ABI was claimed to be deployed or explorer verified.

## Actual local deployment-script checks

The deployment and read-only verifier were exercised against isolated loopback Anvil only. Anvil was configured with chain ID `84532` for this check; that does not make it Base Sepolia.

- Script simulation completed without broadcasting.
- A separate local Anvil broadcast deployed `BisectDisputeRegistryV1` successfully at `0x5fbdb2315678afecb367f032d93f642f64180aa3` in local block 1. Local transaction hash: `0xe83bb18571c8aeeb795c12053a86e99528ff94cfdefc76304dbea572550fad09`.
- The read-only verifier checked that local receipt, runtime code, canonical block, six local confirmations, protocol/VM/encoding versions and constructor values, then returned `verified-read-only` with `writesSubmitted: false`.
- A separate Anvil run on chain ID `8453` reverted with `WrongChain(84532,8453)` as intended.

These are local-only results. The local address and transaction hash must never be entered into the Base Sepolia manifest, frontend, indexer or explorer links.

## Local financial/indexer evidence

The integration run used an isolated Anvil chain ID `1765369107` and PostgreSQL, not Base Sepolia. It recorded 17 initial events and 19 final confirmed canonical events after replay; the read models contained 2 claims, 3 disputes, 5 deposits, 4 settlements, and 2 withdrawals. The append-only journal had 13 transactions and 27 postings after a controlled reorganization; postings balanced and reconciliation returned `MATCH`. Final local contract balance, indexed locked amount, indexed withdrawable credit, and surplus were each zero. The reorg produced an append-only reversal and replacement withdrawal, and restart/replay idempotence and read-only API pagination/validation passed.

This confirms local integration behavior only. It is not evidence of a Base Sepolia event, financial settlement, user withdrawal, or public-service reliability.

## Secrets, repository, and address checks

- No deployment private key, seed phrase, or deployer secret was read or added. The local `.env` is Git-ignored and not tracked; the tracked environment file is `.env.example`, which contains placeholders only.
- No production registry address is configured. The deployment manifest carries explicit null values. ABI/test-vector zero bytes are encoding fixtures, not contract address configuration.
- The repository's Git author is configured locally as Shivam (`shivamtomar1612@gmail.com`). No credential or GitHub authentication settings were changed.
- No public deployment, explorer verification, remote service, or GitHub release was initiated.

## Exact remaining actions

1. On the developer's machine, create/import a dedicated Base Sepolia deployer into an encrypted Foundry keystore; do not paste its key into chat, `.env`, or source control. Fund the public address with Base Sepolia test ETH and provide only that public address.
2. Review and approve the immutable bond, challenge window, and turn window values. The candidate values above remain proposals.
3. Run the documented chain check and deployment simulation. Review sender, constructor values, transaction data, and current fees; only then broadcast from the local keystore. Capture the successful receipt and deployed code.
4. Run `pnpm verify:base-sepolia-deployment` against the public RPC and record the actual canonical receipt/address/hash/block/code hash. Explorer source verification is separate and must be confirmed publicly.
5. Select and authorize hosting/database providers, configure secret storage, TLS, restricted networking, migrations, backups, alerts and restart policies. Publish the web app only after it is configured with the verified registry address.
6. With two dedicated test accounts and actual receipts, perform and reconcile a bonded claim, challenge, bisection, settlement credit, and user-signed withdrawal. Keep the automated challenger disabled until separately configured and funded.

Until those actions finish, **Phase 17 deployment acceptance is PARTIAL and public testnet demonstration readiness is NO-GO**. The contract suite is local verification, not an independent security audit. The protocol remains unaudited, and testnet deployment would not imply production security.
