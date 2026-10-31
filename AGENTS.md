# BISECT engineering rules

These rules apply to all code, documentation, tests, contracts, and operational tooling in this repository.

## Project boundaries

- Build an independently implemented BISECT protocol. Do not import, copy, or depend on the Fuel codebase.
- Keep off-chain code in TypeScript, smart contracts in Solidity, and the repository in a pnpm workspace.
- Define and review protocol semantics before implementing them. Record material design choices and unresolved questions in `docs/decisions.md`.
- Keep the VM deterministic, bounded, and reproducible. Never execute arbitrary JavaScript, shell commands, or host callbacks as VM instructions.
- Distinguish implemented, tested, deployed, audited, and planned work. Never present a mock or placeholder as a working integration.

## Security and correctness

- Never fake transactions, gas measurements, cryptographic proofs, challenge results, or chain state.
- Validate and bound all external inputs, including calldata, API requests, event data, database records, and environment configuration.
- Make contract state transitions, deadlines, bond accounting, and payout rules explicit. Prefer pull payments and checks-effects-interactions; use OpenZeppelin security utilities where appropriate.
- Add security-focused tests for every financial operation and state transition before enabling it.
- Never commit private keys, API secrets, credentials, seed phrases, or real `.env` files. Use `.env.example` with safe placeholders.
- Do not claim production security, audit coverage, or testnet deployment without evidence. The protocol is unaudited until an independent audit is completed and documented.
- Use exact integer units for token values. Never use floating point for money, gas, block heights, or VM state.

## Engineering practice

- Prefer small, boring, maintainable changes with clear names and narrow responsibilities.
- Use strict TypeScript and explicit Solidity compiler settings. Avoid `any`, unsafe casts, silent fallbacks, and unbounded loops.
- Document assumptions, limits, and failure behavior at the boundary where they matter.
- Keep secrets out of logs. Avoid collecting more user or chain data than a feature requires.
- Keep formatting and lint rules consistent. Do not suppress a rule without a local explanation.
- Keep dependencies pinned by the lockfile; review dependency and compiler changes deliberately.
- Tests must be deterministic and independently executable. Never claim a check passed unless it actually ran and exited successfully.

## Required phase closeout

At the end of each phase:

1. Run applicable unit, security, integration, and end-to-end tests.
2. Run lint, typechecking, build validation, and contract compilation where available.
3. Fix failures introduced by the phase and report pre-existing/environmental blockers separately.
4. Update `docs/progress.md` with implemented files, actual command outcomes, blockers, and remaining risks.
5. Commit coherent changes when Git identity and repository permissions permit; report if a commit could not be made.

## Current project stage

Protocol v1 is specified and locked. The TypeScript VM v1, canonical off-chain encodings, trace-root/Merkle proof helpers, examples, CLI, stateless Solidity one-step verifier, Phase 5 escrow base, and Phase 6 `BisectDisputeRegistryV1` are implemented. The integrated registry has Foundry state-machine/accounting tests and a mined local Anvil end-to-end test. This does not establish Base Sepolia deployment, independent audit, production security, automatic challenger availability, browser wallet integration, or trace data availability. `BisectClaimRegistry` by itself remains fail-closed; the derived dispute registry is the operative implementation. The Account Ledger addendum remains pending. PostgreSQL is for derived service records only, not protocol financial authority. Keep implementation, local verification, deployment, and audit status distinct.
