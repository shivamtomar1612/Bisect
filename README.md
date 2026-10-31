# BISECT

BISECT is an early-stage optimistic computation verification protocol. A prover will commit to a bounded deterministic execution trace and bond funds; a challenger will be able to dispute a conflicting trace through an interactive bisection game.

**Status: VM v1 implemented; protocol integration is in progress.** The repository includes a bounded deterministic VM with canonical v1 encoding, trace commitments, examples, CLI, and tests. The dispute contract, indexer, challenger service, wallet transactions, and testnet deployment are not implemented. No transaction, gas estimate, or dispute outcome is simulated.

## Repository layout

```text
apps/web          Next.js App Router interface
apps/indexer      Chain event indexing service (planned)
apps/challenger   Dispute automation service (planned)
packages/vm       Bounded deterministic VM, v1 encodings and CLI
packages/merkle   Execution commitment primitives (planned)
packages/sdk      TypeScript client SDK (planned)
contracts         Foundry and Solidity project
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
pnpm contracts:build
pnpm contracts:test
pnpm e2e
pnpm check:all
```

Contract checks require Foundry. Database checks require the local PostgreSQL service. Browser tests require Playwright's Chromium browser (`pnpm exec playwright install chromium`). `pnpm check:all` runs the environment, database, RPC, TypeScript, contract, and browser checks and stops with a nonzero status at the first failure. No check should be described as passing unless it was run successfully in the current environment.

## Protocol status and assumptions

**BISECT protocol v1 is specified and locked.** The VM and its off-chain canonical commitments are implemented and tested against known-answer vectors. Solidity dispute adjudication, financial operations, cross-language contract vectors, and independent audit remain future work. Start with [docs/protocol-v1.md](docs/protocol-v1.md), then read the normative [VM specification](docs/vm-spec.md), [encoding specification](docs/encoding-spec.md), [dispute state machine](docs/dispute-state-machine.md), [security model](docs/security-model.md), and [protocol vectors](docs/protocol-vectors.json). Changes to consensus-visible semantics require versioning and new vectors.

The architecture overview is in [docs/architecture.md](docs/architecture.md), engineering decisions in [docs/decisions.md](docs/decisions.md), requirements and evidence in [docs/requirements.md](docs/requirements.md), and verified progress in [docs/progress.md](docs/progress.md).

This is unaudited research and engineering software. It is not production-secure and must not custody real funds.

## Contributing

Read [AGENTS.md](AGENTS.md), [CONTRIBUTING.md](CONTRIBUTING.md), and [SECURITY.md](SECURITY.md) before making changes.
