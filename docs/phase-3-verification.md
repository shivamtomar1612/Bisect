# Phase 3 verification — Merkle commitments and off-chain SDK

**Date:** 2026-10-31

**Scope:** Ordered trace commitments, inclusion proofs, JSON artifacts, SDK APIs, and deterministic Solidity-compatibility vectors. The Phase 2 VM implementation was not changed. No Solidity claim registry or account ledger contract was started.

## Ledger addendum status

The Account Ledger addendum has not been authored; the project owner confirmed it is a planned addition. Phase 3 therefore uses only the locked protocol v1 specifications and the verified Phase 2 VM. This phase adds no wallet custody, escrow, bond settlement, withdrawals, or database ledger functionality. The ledger design remains pending separate authorization before Phase 5.

## Implemented files

- `packages/merkle/src/index.ts` implements deterministic VM-backed trace commitments/root generation, canonical ABI state commitments, an ordered position-sensitive binary tree, bottom-up inclusion proofs, strict proof/artifact validation, and canonical JSON import/export.
- `packages/merkle/package.json`, `tsconfig.json`, and `tsconfig.build.json` define the workspace dependency, package exports, strict typecheck, and production build.
- `packages/sdk/src/trace.ts` and `packages/sdk/src/index.ts` expose typed root/trace generation, state commitment, proof creation/verification, and trace/proof import/export.
- `packages/sdk/package.json`, `tsconfig.json`, and `tsconfig.build.json` define package exports and dependency/build order.
- `packages/merkle/fixtures/merkle-v1-vectors.json` contains standard-budget first/middle/last proofs and a 4096-leaf maximum-budget proof. Vectors include ABI input/state bytes, context and program hashes, state and leaf hashes, bottom-up siblings, roots, and positive/negative verification expectations.
- `scripts/generate-merkle-vectors.mts` and `pnpm merkle:vectors` regenerate the checked-in vectors deterministically.
- `tests/unit/merkle.test.ts` and `tests/unit/sdk-trace.test.ts` cover normal, boundary, invalid, and serialization cases.
- `vitest.config.mts` maps workspace APIs to TypeScript source for clean-checkout tests; the root build now compiles VM → Merkle → SDK → web.
- `docs/decisions.md`, `docs/architecture.md`, `docs/requirements.md`, package READMEs, and the root README reflect the implemented Phase 3 scope.

## Locked format and implementation notes

The implementation preserves `docs/encoding-spec.md` without changing v1 semantics. Keccak-256, Solidity `abi.encode`, and the VM's existing versioned hash functions define context, state, leaf, and node hashes. The Merkle package independently builds the ordered tree and checks its root against the Phase 2 VM result. Proof verification uses each state-index bit to choose `nodeHash(current,sibling)` or `nodeHash(sibling,current)`; it never sorts siblings.

V1 does not pad leaves. Its approved budgets yield exactly 64, 256, 1024, or 4096 states, with proof depths 6, 8, 10, or 12. A one-leaf tree is not a valid v1 trace and is rejected through the approved-budget validation.

Proof verification requires caller-supplied program, public input, transition count, and expected root. It checks program/input/context identity, exact leaf count and depth, canonical state bytes, indexed leaf, sibling path, and trusted root. It proves membership only; it does not establish the correctness of every VM transition or an on-chain dispute result.

All `uint64` values in artifacts are canonical decimal strings. The full trace is bounded by 4096 states; artifacts are deterministic but can be large. Trace parsing replays the bounded VM before accepting the artifact. Proof parsing checks field encodings and reconstructs the root.

### OpenZeppelin behavior check

The installed OpenZeppelin Contracts submodule reports tag `v5.5.0`. In `contracts/lib/openzeppelin-contracts/contracts/utils/cryptography/MerkleProof.sol`, `processProof` calls `Hashes.commutativeKeccak256`; the file documents that proof pairs are sorted and that noncommutative proof hashing is unsupported. BISECT v1 is position-sensitive, so this helper is not used. The regression test confirms `nodeHash(left,right) != nodeHash(right,left)` for the selected v1-compatible test hashes.

## Verification outcomes

Commands and observed outcomes from the Phase 3 implementation closeout:

- `pnpm install --frozen-lockfile` — **PASS**, exit code 0; all 8 workspace projects were already up to date.
- `pnpm merkle:vectors` — **PASS**, exit code 0; the real VM-backed generator wrote the fixture and Biome formatted it.
- `pnpm lint` — **PASS**, exit code 0; Biome checked 93 files. It emitted 47 informational `useLiteralKeys` suggestions for guarded record access; no lint errors remained.
- `pnpm format:check` — **PASS**, exit code 0; Biome checked 93 files with no changes required.
- `pnpm typecheck` — **PASS** inside the full gate; all 7 packages with typecheck scripts completed, including Merkle and SDK.
- `pnpm test` — **PASS**, 40 tests in 4 files.
- `pnpm build` — **PASS** inside the full gate; VM, Merkle, and SDK TypeScript builds completed and Next.js 16.4.3 compiled, typechecked, and generated its static pages.
- `pnpm check:phase3` — **PASS**, exit code 0; the complete lint, format, typecheck, unit test, and production build sequence completed.

Coverage includes first/middle/last indexes; all path hashes and exact depths; maximum-budget index 4095; nonhalting bounded challenger traces; uint64 maximum-value round trips; altered states/siblings, reversed sibling order, wrong index/root/program/input/budget, malformed and truncated proofs; root repeatability; and the explicit v1 no-single-leaf boundary.

Foundry contract compilation, database, Playwright, and live Base Sepolia RPC checks are outside this Phase 3 package change. No contract source or deployment configuration was modified. No Solidity parity result is claimed.

## Remaining risks

- The TypeScript vector fixture is ready for Solidity compatibility testing but has not yet been reproduced by Solidity code.
- Merkle membership does not prove intermediate execution correctness; an on-chain verifier and interactive dispute implementation remain future work.
- Data availability, challenger monitoring, chain inclusion, block liveness, and Keccak collision resistance remain the assumptions in `docs/security-model.md`.
- The repository is unaudited. These tests are deterministic implementation checks, not formal verification.

## Phase 4 readiness

**GO for Phase 4 cryptographic compatibility and verifier work.** The locked v1 definitions, bounded TypeScript VM, Merkle implementation, and test vectors are available as compatibility gates. This decision does not start Phase 4 or authorize ledger/custody features. The Account Ledger addendum remains pending before Phase 5. Phase 3 did not establish Solidity parity; that remains a compatibility task for the next phase.
