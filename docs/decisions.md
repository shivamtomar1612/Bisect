# Protocol decisions

This log records decisions that constrain implementation. Unresolved items are explicit design gates, not defaults for engineers to guess.

## ADR-0001: Project boundaries and initial stack

- **Status:** Accepted, 2026-10-31
- **Decision:** Build BISECT independently as a pnpm monorepo using TypeScript for off-chain services, Next.js App Router/React/Tailwind/shadcn conventions for the web client, wagmi/viem for wallet and EVM integration, Solidity/Foundry/OpenZeppelin for contracts, PostgreSQL/Prisma for derived service data, and Vitest/Playwright for tests. Target Base Sepolia, chain ID 84532.
- **Reason:** This follows the project brief and separates user interface, off-chain helpers, and on-chain enforcement.
- **Consequences:** The repository has no assumed legacy architecture. This stack choice does not imply deployed or implemented functionality.

## ADR-0002: VM execution model

- **Status:** Accepted in principle; constants and ISA pending
- **Decision:** The VM will be a small deterministic finite instruction set with integer-only state, canonical encoding, explicit overflow behavior, and statically bounded instruction and memory use. No arbitrary JavaScript or host execution.
- **Reason:** On-chain one-step verification must have reproducible semantics and bounded resource use.
- **Consequences:** ISA, widths, memory model, cost model, max trace, and failure semantics must be finalized before VM code is relied on by a contract.

## ADR-0003: State commitment direction

- **Status:** Proposed; proof format unresolved
- **Decision:** Use a domain-separated Merkle commitment to canonical trace states, binding the root to VM version, program/input hashes, trace length, and encoding version.
- **Reason:** Enables logarithmic membership proofs during bisection.
- **Consequences:** Hash function, tree shape, padding, state serialization, and proof limits require a dedicated ADR and cross-language test vectors before implementation.

## Open decisions (block contract implementation)

1. Exact VM instruction set, register/memory widths, maximum steps, and halt/error semantics.
2. Canonical state/program/input encoding and hash function.
3. Merkle tree arity, padding, leaf indexing, and proof encoding.
4. Proposal/challenge lifecycle including duplicate and concurrent challengers.
5. Bisection midpoint protocol, response order, turn deadlines, and timeout winner.
6. Exact terminal proof inputs and one-step verifier interface.
7. Bond amounts, fee/reward split, withdrawal policy, cancellation, and expired game rules.
8. Reorg/finality policy and accepted Base Sepolia RPC sources.
9. PostgreSQL retention and signer isolation/rotation model.
