# Phase 4 — Solidity verifier and cross-language consistency

**Date:** 2026-10-31

**Scope result:** PASS for the stateless VM v1 one-step and ordered Merkle verifier.
**Protocol readiness:** PARTIAL. The claim/game contract, financial integration, deployment, and audit are outside this phase.

## Implementation

- `contracts/src/BisectVerifier.sol` is a stateless internal library with full bounded v1 program validation, exact one-step VM execution, uint64 wrapping arithmetic, current-PC-relative signed `JNZ`, `HALT` and halted-state stuttering, canonical ABI encodings/hashes, context reconstruction, and ordered index-bit Merkle verification.
- `verifyOneStep` accepts the raw bytecode, fixed eight-word public input, approved transition count, root, adjacent state index, predecessor/successor states, and two proofs. It derives program/input/context commitments itself, validates every instruction, authenticates both adjacent states with exact proof depths, verifies the canonical initial state at index zero, executes one transition, and compares every successor field.
- The verifier stores no state. It accepts no caller-supplied VM/version/context hash. Program and hash domains are fixed to v1. The public ABI uses typed `uint16`, `bool`, `uint64[8]`, and `bytes32[]` fields.
- `scripts/generate-phase4-vectors.mts` generates `contracts/test/vectors/verifier-v1.json` from the TypeScript VM and hash implementation. Foundry reads this exact fixture; the contracts test command regenerates it before testing.
- `contracts/test/BisectVerifier.t.sol` tests cross-language bytes/hashes/roots/proofs and adversarial cases. Fuzz tests exercise uint64 add/subtract/multiply wrapping and signed JNZ offsets.
- `contracts/foundry.toml` pins Solidity `0.8.30` and grants read access only to `./test/vectors` for the shared JSON fixture. The verifier does not use OpenZeppelin's sorted-pair Merkle helper.

## Cross-language coverage

The generated fixture contains 17 valid transition cases: every opcode, arithmetic wrap/underflow, taken and untaken branches, HALT entry/stuttering, all four approved trace budgets and depths, plus a 128-instruction/4096-state maximum-boundary case. For both adjacent states it records the exact 320-byte ABI encoding, state hash, context/index-bound leaf hash, ordered sibling path, and common root.

Eight TypeScript-classified invalid-program cases are shared with Solidity: empty, oversized, wrong instruction width, unknown opcode, invalid register, nonzero reserved operand, fallthrough out of range, and jump target out of range. Solidity tests also reject authenticated but invalid successor and PC states, modified sibling proofs, wrong program/input/budget/index, and truncated proofs.

## Verification results

- `pnpm contracts:build` — **PASS**, Foundry compiled with pinned Solc `0.8.30`.
- `pnpm contracts:test` — **PASS**, 9 Foundry tests across 2 suites; both fuzz tests ran 256 cases each.
- Cross-language test — **PASS**, all 17 valid TypeScript-generated vectors reproduced identical program/input/context/state/leaf hashes and state ABI bytes in Solidity and verified both state proofs plus the one-step transition.
- Malformed-program test — **PASS**, Solidity error enum values matched TypeScript validation categories for all eight generated invalid programs.
- Worst-case verifier call — **256,018 gas** measured inside Foundry for a valid 128-instruction program and two 12-sibling proofs. This is the harness call measurement in the local Foundry test environment, not a deployed transaction estimate.
- `pnpm check:phase4` — **PASS**, exit code 0. The aggregate completed lint, formatting, typechecks, 40 TypeScript tests across four files, VM/Merkle/SDK/Next.js builds, Foundry contract compilation, vector regeneration, and all Foundry tests.

The standalone Foundry gas test reports higher whole-test gas because it includes fixture loading, JSON parsing, contract setup, and assertion work. The 256,018 figure is measured around the verifier harness call itself.

## Security boundary and remaining blockers

- Membership proofs authenticate two states under one root; this one-step verifier does not authenticate a whole execution or establish the root's data availability.
- `traceRoot` is an input to the stateless library. The future game contract must pass the root stored for the active claim; the library checks proofs against that root but cannot establish its authority on its own.
- The implementation does not include claim storage, proposal/final-state checks, game transitions, response deadlines, bonds, credits, withdrawals, wallet flows, or a deployed contract. Existing financial-ledger design documents were preserved.
- The Account Ledger addendum has not been authored. Phase 5 work that depends on that design remains unauthorized until the project owner separately provides and approves it.
- No independent security audit or Base Sepolia deployment was performed. The Solidity library and integration path remain unaudited.

## Phase decision

**PASS** for the Phase 4 scoped Solidity VM transition verifier and ordered Merkle inclusion verifier, with cross-language test evidence. **PARTIAL** for the complete BISECT optimistic protocol because the claim/game integration is not implemented. **NO-GO for Phase 5 financial implementation** until the planned Account Ledger addendum is supplied and separately authorized.
