# BISECT

BISECT is an early-stage optimistic computation verification protocol. A prover will commit to a bounded deterministic execution trace and bond funds; a challenger will be able to dispute a conflicting trace through an interactive bisection game.

**Status: VM v1, ordered Merkle commitments, the Solidity one-step verifier, the integrated v1 dispute registry, and a local PostgreSQL event indexer/ledger are implemented and locally tested.** The registry runs interactive leftmost-difference bisection, verifies the disputed step, and settles native-ETH bonds into pull credits. The indexer exposes confirmed chain-derived read models and an append-only double-entry journal with reconciliation. The project is unaudited and has not been deployed to Base Sepolia; no production-security claim is made. The automatic challenger and wallet UI remain pending.

## Repository layout

```text
apps/web          Next.js App Router interface
apps/indexer      Chain event indexing, read-only API, PostgreSQL models and ledger
apps/challenger   Dispute automation service (planned)
packages/vm       Bounded deterministic VM, v1 encodings and CLI
packages/merkle   Ordered v1 trace roots, state commitments, and proofs
packages/sdk      Typed trace/proof SDK and generated registry ABI/client wrappers
contracts         Foundry verifier and bonded claim registry
docs              Architecture, requirements, decisions, and progress
scripts           Repository maintenance scripts
tests/e2e         Browser-level tests
```

## Requirements

- Node.js `24.19.0` and pnpm `11.25.0` (see `.node-version` and `package.json`)
- Foundry `v1.8.7` for Solidity compilation and local Anvil
- Docker Desktop with its Linux engine for local PostgreSQL
- PostgreSQL 17.11 for the database integration checks
- A Base Sepolia RPC endpoint for read-only testnet configuration checks

See [docs/development-setup.md](docs/development-setup.md), [docs/windows-wsl-setup.md](docs/windows-wsl-setup.md), and [docs/database-setup.md](docs/database-setup.md) for setup. Copy `.env.example` to `.env` and replace the local development database password. Never commit `.env`, private keys, or seed phrases.

## Start

```sh
pnpm install
pnpm dev
```

The web app is at <http://localhost:3000>. It currently identifies the project phase and target chain; it does not connect a wallet or send transactions.

## VM CLI

Programs can be supplied as canonical bytecode, .hex/.bin files, readable .asm files, or built-in examples:

    pnpm bisect vm validate example:addition
    pnpm bisect vm inspect example:sum
    pnpm bisect vm disassemble example:fibonacci
    pnpm bisect vm run example:addition --input '["7","5","0","0","0","0","0","0"]' --budget 63
    pnpm bisect vm trace example:nonterminating --input '["1","0","0","0","0","0","0","0"]' --budget 63 --output trace.json

The run command requires HALT within the selected protocol budget. Trace generation also supports a bounded non-halting trace for challenger-side analysis and marks it as not halted within budget. uint64 values in JSON should be decimal strings; unsafe JSON numbers are rejected. See packages/vm/README.md for API and error details.

## Checks

```sh
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
pnpm check:phase3
pnpm merkle:vectors
pnpm contracts:build
pnpm contracts:test
pnpm phase6:anvil
pnpm contracts:vectors
pnpm check:phase4
pnpm check:phase5
pnpm check:phase6
pnpm check:phase8
pnpm e2e
pnpm check:all
```

Contract checks require Foundry. Database checks require the local PostgreSQL service. Browser tests require Playwright's Chromium browser (`pnpm exec playwright install chromium`). `pnpm check:all` runs the environment, database, RPC, TypeScript, contract, and browser checks and stops with a nonzero status at the first failure. No check should be described as passing unless it was run successfully in the current environment.

`pnpm phase6:anvil` builds the VM, Merkle package, and dispute contract; starts an isolated local Anvil chain; deploys the registry; mines a complete dishonest-prover challenge using two unlocked local test accounts; verifies event/accounting results; withdraws the challenger credit; and stops Anvil. It uses no testnet or private key.

`pnpm check:phase8` runs the TypeScript and contract checks, starts local PostgreSQL if needed, applies Prisma migrations, and runs a real Anvil-to-PostgreSQL event-indexer integration scenario. The scenario uses actual local test-ETH transactions and verifies confirmation gating, restart/replay idempotence, API pagination, journal balance, reconciliation, and a controlled reorganization. It does not use Base Sepolia or establish deployment readiness.

## Indexer and ledger

The indexer requires explicit `INDEXER_RPC_URL`, `INDEXER_CHAIN_ID`, `INDEXER_CONTRACT_ADDRESS`, and `INDEXER_DEPLOYMENT_BLOCK` settings. It checks the RPC chain ID and refuses a checkpoint if the configured deployment block or confirmation depth changes. The default policy confirms blocks after six descendants; this is an operator-selected testnet policy, not protocol finality. Run `pnpm indexer:dev` to poll, `pnpm indexer:api` to serve read-only HTTP endpoints on `127.0.0.1:8787`, `pnpm indexer:run` for one poll, and `pnpm indexer:reconcile` to compare indexed liabilities with registry reads at the confirmed checkpoint. Database setup and posting semantics are in [docs/ledger-reconciliation.md](docs/ledger-reconciliation.md).

## Protocol status and assumptions

**BISECT protocol v1 is specified and locked.** The VM, off-chain canonical commitments, Merkle proofs, Solidity one-step verifier, bonded claim admission, interactive dispute game, timeout settlement, pull withdrawals, and Phase 8 event indexer/read ledger are implemented. `BisectClaimRegistry` by itself remains fail-closed; `BisectDisputeRegistryV1` is the integrated registry. Local Foundry, Anvil, and PostgreSQL checks provide development evidence only; Base Sepolia deployment, an automatic challenger, wallet UI, and independent audit remain outstanding. The ledger is a derived read model; on-chain contract state remains authoritative. See [docs/phase-6-report.md](docs/phase-6-report.md) and [docs/phase-8-report.md](docs/phase-8-report.md) for actual verification evidence.

The architecture overview is in [docs/architecture.md](docs/architecture.md), engineering decisions in [docs/decisions.md](docs/decisions.md), requirements and evidence in [docs/requirements.md](docs/requirements.md), and verified progress in [docs/progress.md](docs/progress.md).

This is unaudited research and engineering software. It is not production-secure and must not custody real funds.

## Contributing

Read [AGENTS.md](AGENTS.md), [CONTRIBUTING.md](CONTRIBUTING.md), and [SECURITY.md](SECURITY.md) before making changes.
