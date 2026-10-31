# Protocol and engineering decisions

Material protocol choices below are accepted and locked for v1. Implementations must use `protocol-v1.md`, `vm-spec.md`, `encoding-spec.md`, `dispute-state-machine.md`, `security-model.md`, and `protocol-vectors.json` as normative. A change to consensus-visible behavior requires a new protocol/VM/encoding version, a new verifier deployment, and new cross-language vectors. Do not silently alter v1.

## ADR-0001: Project boundary and stack

- **Status:** Accepted, 2026-10-31
- **Decision:** Independently implement BISECT in a pnpm monorepo using TypeScript off chain; Next.js App Router, React, Tailwind and shadcn/ui for web; wagmi/viem for EVM integration; Solidity/Foundry/OpenZeppelin for contracts; PostgreSQL/Prisma for derived data; Vitest/Playwright for tests; Base Sepolia chain ID `84532` as the initial public test network.
- **Reason:** It follows the project brief and separates user interface, off-chain computation, and on-chain enforcement.
- **Consequences:** No legacy architecture is assumed. A dependency or stack choice does not imply that its component is implemented or deployed.

## ADR-0002: VM v1 semantics

- **Status:** Accepted and locked, 2026-10-31
- **Decision:** Eight `uint64` registers, `uint16` instruction-index PC, boolean halt state, four-byte instructions, at most 128 instructions, exactly eight `uint64` public inputs, the ten-opcode ISA, modulo-`2^64` arithmetic, signed `JNZ` offset relative to the current PC, `HALT` retaining its PC, and post-halt stuttering. Allowed transition counts are exactly `{63,255,1023,4095}`; traces have `N+1` states and must halt within `N` transitions.
- **Reason:** A finite, deterministic, bounded state machine supports reproducible execution and a small one-step verifier.
- **Consequences:** Programs cannot access memory, filesystem, network, clock, randomness, floating point, host calls, or arbitrary JavaScript. Every instruction and possible branch target is validated. See `vm-spec.md`.

## ADR-0003: Canonical encodings and trace commitments

- **Status:** Accepted and locked, 2026-10-31
- **Decision:** Use Solidity standard ABI encoding, Ethereum Keccak-256, and the domain strings `BISECT/{PROGRAM,INPUT,CONTEXT,STATE,LEAF,NODE}/V1`. Bind versions, program/input hashes, transition count, leaf count, exact index, and state into context and leaves. Use an ordered binary Merkle tree with no padding because every trace has a power-of-two number of leaves. Proof siblings are bottom-up and left/right are never sorted.
- **Reason:** These encodings are unambiguous and shareable between TypeScript and Solidity.
- **Consequences:** `encoding-spec.md` and `protocol-vectors.json` are the compatibility gate. Hashing packed fields or changing order is incompatible.

## ADR-0004: Challenge search and game participation

- **Status:** Accepted and locked, 2026-10-31
- **Decision:** Use a left-first Merkle subtree comparison to isolate the lowest state index whose committed states differ. Require equal canonical initial states, then authenticate each party's predecessor/successor at the differing index and verify the prover transition. Permit one active game at a time but allow sequential retries until the original, unextended challenge deadline.
- **Reason:** A correct challenger trace exposes the prover's first invalid transition even if later states reconverge; retries prevent one failed/malicious challenge from permanently finalizing an invalid proposal.
- **Consequences:** The proposer responds first during subtree bisection; challenger then proposer reveal terminal witnesses. Exact response and timeout rules are in `dispute-state-machine.md`.

## ADR-0005: Bond and timeout rules

- **Status:** Accepted and locked, 2026-10-31
- **Decision:** Each verifier deployment fixes immutable native-ETH `bondWei`, `challengeWindowBlocks`, and `turnWindowBlocks` within the ranges in `protocol-v1.md`. Both parties bond exactly `B`. No challenge: proposer receives `B` as credit. Prover-valid game or challenger timeout: challenger `B` is credited to proposer and proposal remains open. Prover-invalid game or prover timeout: both bonds `2B` are credited to challenger and claim is refuted. No fee or treasury. Credits withdraw via caller-only pull payment.
- **Reason:** Every financial path needs explicit integer-unit accounting and finite response deadlines.
- **Consequences:** Deployment parameter selection affects economics and liveness but never changes the VM/encoding semantics. Contract accounting must satisfy `balance >= totalLiabilities`; see the dispute specification.

## ADR-0006: Versioning and upgrade policy

- **Status:** Accepted and locked, 2026-10-31
- **Decision:** A v1 verifier is non-upgradeable. Consensus-visible changes require a new version identifier and verifier deployment; v1 claims are always interpreted with v1 semantics.
- **Reason:** A claim must not change meaning while its challenge window or game is active.
- **Consequences:** No admin pause, migration, or semantic hotfix exists for v1. Fixes to contract implementation require a new reviewed deployment; any correction to normative documents is versioned and accompanied by vectors.

## Open release/operations decisions

These are deployment and service choices, not undefined v1 state transitions:

1. Select actual bond/window values for each testnet deployment and document the rationale, expected block timing, monitoring coverage, and finality policy.
2. Measure worst-case program-validation, proof-verification, bisection, and withdrawal gas on the target EVM before deployment; the specification only bounds work, not gas cost.
3. Define production operations for trace-data archival, RPC redundancy, alerting, isolated challenger signer funding/rotation, and database retention.
4. Publish verifier address, source commit, compiler settings, deployment transaction, and independent audit status only after those events occur.

No such release settings are silently defaulted by this v1 specification.
