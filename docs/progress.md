# Development progress

## 2026-10-31 — BISECT protocol v1 specification lock

### Completed

- Read the repository engineering rules, requirements matrix, architecture, and decisions before design work.
- Locked VM v1 semantics, program validation, transition/error behavior, and fixed-length traces in `docs/vm-spec.md`.
- Locked ABI serialization, Keccak-256 domain separation, context/state/leaf/node hashing, proof ordering, and final output binding in `docs/encoding-spec.md`.
- Specified proposal, single-active-game/retry behavior, leftmost-difference bisection, response deadlines, terminal proof, exact bond outcomes, accounting, and withdrawal paths in `docs/dispute-state-machine.md`.
- Added the protocol summary/invariants/non-goals, threat assumptions, and cross-language vector fixture in `docs/protocol-v1.md`, `docs/security-model.md`, and `docs/protocol-vectors.json`.
- Updated architecture, decision log, requirements traceability, README, and Windows/database verification records to match the locked protocol and current Phase 0 results.
- No VM or dispute implementation was started. v1 is specified, not implemented, deployed, or audited.

### Verification

- Protocol vector check using viem `2.57.13` — passed: canonical input ABI bytes, all domain hashes, program/input/context hashes, sampled states/leaves, 64-leaf root, and final-state inclusion proof reproduced from the formulas.
- `docs/protocol-vectors.json` — parsed successfully as JSON and independently recomputed against the locked formulas.
- `pnpm check:all` — passed with exit code 0 after specification edits. It includes frozen install, environment and Docker checks, PostgreSQL/Prisma migration/read/write/restart persistence, lint, format, typecheck, Vitest, Next production build, Base Sepolia and Anvil RPC, Foundry build/test, and Playwright.

### Readiness and limits

- Protocol v1 is locked for implementation. Consensus-visible changes require a new version and vectors.
- Future implementation gates remain: cross-language tests, VM bounds/fuzz tests, Solidity state/accounting tests, gas analysis, real Base Sepolia deployment evidence, and independent audit.

## 2026-10-31 — Phase 0 foundation and environment verification

### Completed

- Established the pnpm workspace, strict TypeScript settings, Biome, Vitest, Playwright, Next.js scaffold, project guidance, protocol documentation, and requirements traceability matrix.
- Added a minimal Foundry project and pinned OpenZeppelin Contracts `v5.5.0` submodule; repository-local Foundry `1.8.7` compiles and runs the import smoke test.
- Added local PostgreSQL Compose configuration, a minimal Prisma `7.10.1` health-check schema/migration, read/write smoke test, and restart persistence verification.
- Added local Anvil and Base Sepolia (`84532`) read-only RPC checks, reproducible root commands, environment documentation, and CI workflows.
- Installed Docker Desktop `4.97.0`; the Linux engine is running on WSL 2. PostgreSQL `17.11-alpine3.24` is healthy with a named volume and loopback-only port binding.
- Kept `.env` and Foundry binaries under ignored paths. No keys or live credentials are configured.
- Reviewed pnpm install scripts; only Prisma engines, Prisma CLI, and esbuild at locked versions are allowed. Three optional native accelerators remain denied.
- Configured repository-local Git identity and committed the foundation.

### Verification

- `pnpm check:all` — passed with exit code 0 after the restart-check script formatting fix. The aggregate runs frozen install, tool checks, Docker, PostgreSQL, Prisma, lint, format, typecheck, unit tests, production build, Base Sepolia RPC, Anvil RPC, Foundry build/tests, and Playwright.
- Database checks passed: Compose startup and health, Prisma schema validation and generation, migration applied and subsequently reported in sync, Prisma authenticated read/write before and after container restart, and a marked row survived restart and was then deleted by the check.
- Contract checks passed: Foundry `1.8.7`, Solidity `0.8.30`, OpenZeppelin ReentrancyGuard smoke test (1 passed).
- RPC checks passed: Base Sepolia chain ID `84532`; local Anvil chain ID `31337`.
- Browser test passed: Playwright Chromium, 1 test. Unit test passed: Vitest, 1 test.
- CI workflow YAML parsed with PyYAML `6.0.3`; GitHub-hosted CI has not been executed from this workstation.
- `docker compose ps` reports PostgreSQL healthy and bound only to `127.0.0.1:5432`.

### Readiness and remaining scope

- **Phase 0 is ready to close; the environment is ready to proceed to Phase 1.** All checks in `pnpm check:all` passed.
- WSL 2 works for Docker Desktop. `wsl --list --verbose` shows Docker Desktop's internal distribution but no developer Ubuntu distro. An Ubuntu install attempt returned `Wsl/InstallDistro/ERROR_ALREADY_EXISTS` without registering Ubuntu. This is nonblocking because the app and verified Foundry workflow run natively on Windows; no WSL distributions or data were removed.
- No Phase 1 protocol implementation has started. VM execution, Merkle commitments, dispute resolution, indexer/challenger behavior, wallet transactions, and testnet deployment remain planned.
- Protocol questions remain in `docs/decisions.md`. No protocol contract is deployed, and no independent security audit has been performed. The project is not production-secure.

## Initial scaffold notes

The repository was empty at initial setup. The initial foundation created one requirements integrity unit test and one browser test that checks the current phase is described honestly. The initial CI includes separate TypeScript, PostgreSQL, and Foundry jobs; it does not deploy on pushes.
