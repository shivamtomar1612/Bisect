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

## ADR-0007: TypeScript VM encoding implementation

- **Status:** Accepted, 2026-10-31
- **Decision:** The VM package uses the lockfile-pinned viem ABI encoder and Ethereum Keccak implementation for canonical v1 commitments rather than maintaining a custom ABI/Keccak implementation. It declares its dependency directly and independently from the SDK.
- **Reason:** The locked formats are Solidity ABI and EVM Keccak; a maintained EVM library reduces custom cryptographic/serialization code while the published known-answer vectors remain the compatibility check.
- **Consequences:** The VM package has no wallet, provider, or contract calls. Any future viem upgrade must keep every encoding/hash vector byte-identical.

## ADR-0008: Ordered TypeScript Merkle package and trace SDK

- **Status:** Accepted, 2026-10-31
- **Decision:** Keep the locked v1 ABI and domain-separated Keccak hash functions in `@bisect/vm` as the canonical hash implementation. `@bisect/merkle` generates traces with VM v1, independently constructs ordered Merkle levels using those functions, and checks its root against the VM-computed root. Inclusion verification uses the state-index bits to preserve left/right order. V1 does not pad; only approved transition counts and their exact power-of-two state counts are accepted. `@bisect/sdk` exposes typed trace, state commitment, proof, and canonical JSON APIs without wallet or contract calls.
- **Reason:** Reuse locked consensus encodings while independently testing tree construction; prevent sorted-pair behavior from changing proof semantics.
- **Consequences:** OpenZeppelin Contracts v5.5.0 `MerkleProof` is not used because its standard proof path uses commutative sorted-pair hashing and does not support the required position-sensitive hash. TypeScript vectors are the compatibility fixture for a future Solidity implementation. The Account Ledger addendum is pending; no custody, escrow, settlement, withdrawal, or database-ledger semantics are introduced.

## ADR-0009: Phase 5 native-ETH claim escrow boundary (superseded for public entrypoints)

- **Status:** Accepted for the initial Phase 5 implementation; public entrypoints superseded by ADR-0011, 2026-10-31
- **Decision:** Implement a non-upgradeable claim registry with monotonic IDs, an exact immutable prover bond, canonical initial/final trace proof checks, duplicate-submission prevention per prover/context/root/output, a fixed block challenge deadline, unchallenged finalization to a caller-only pull credit, and a checks-effects-interactions withdrawal guarded by OpenZeppelin `ReentrancyGuard`. Fees are zero. No administrator can move funds. Reject ordinary ETH transfers; forced ETH remains unallocated surplus. The Base mainnet chain ID is rejected by the constructor; Anvil and Base Sepolia remain allowed.
- **Reason:** Establish the first real bond/accounting layer while keeping keys in external wallets and implementing only the financial behaviors explicitly authorized for this phase.
- **Consequences:** The initial implementation allowed unchallenged finalization before any dispute game existed. Phase 5.5 disables both public claim admission and finalization in the base contract; only a dispute-enabled derived contract may expose the internal claim path. Test harness behavior is not production settlement. Foundry economic parameters are test fixtures only. The Account Ledger addendum remains pending, and no wallet custody or database accounting is introduced.

## ADR-0010: Stateless Solidity v1 transition verifier

- **Status:** Accepted, 2026-10-31
- **Decision:** Implement VM v1 validation, one-step execution, exact ABI/domain-separated hashes, and ordered inclusion verification in a stateless internal Solidity library. Each call recomputes program, input, and execution-context hashes from raw program bytes, fixed public input, and an approved transition budget; it authenticates both adjacent states against the same root before comparing the computed successor. No caller-provided version or context hash is trusted.
- **Reason:** The dispute game needs a small reusable transition-verification primitive whose consensus behavior matches the locked VM/encoding specification and TypeScript implementation.
- **Consequences:** Solidity tests consume deterministic vectors generated from the TypeScript VM/Merkle packages. The library does not store claims, manage games or deadlines, custody funds, settle bonds, expose wallet flows, or claim deployment/audit status. A future integration must preserve these vector results and separately test its full game/accounting state machine.

## ADR-0011: Fail-closed pre-dispute claim registry

- **Status:** Accepted, 2026-10-31
- **Decision:** The Phase 5 base `BisectClaimRegistry` must reject public claim submissions and finalization while the challenge/bisection protocol is absent. Preserve the validated submission and accounting implementation as internal helpers for reuse by a derived Phase 6 contract. Do not add an administrator-controlled readiness switch.
- **Reason:** Endpoint proofs authenticate only the initial and final states. They cannot justify accepting and later releasing a prover bond when an intermediate trace transition may be invalid. Disabling finalization alone could permanently trap user deposits, so admission must also fail closed.
- **Consequences:** The base contract is not deployable as a claim service and cannot accept bonds. Test-only harnesses may expose internal helpers to preserve regression coverage, but tests must label this seam explicitly. Phase 6 is a fresh deployment; no Phase 5 deployment exists to upgrade or migrate.

## ADR-0012: Single-contract dispute and escrow integration

- **Status:** Accepted for Phase 6 design, 2026-10-31
- **Decision:** Implement the first dispute-enabled registry as a derived, non-upgradeable contract that inherits claim storage, withdrawal protection, and accounting helpers. Keep claim and dispute transitions in one contract and one liability ledger. A Phase 6 override may enable submission through `_submitClaim` and finalization through `_finalizeClaimAfterDisputeResolution` only after checking game state and the v1 state machine. Deploy a fresh instance; do not create a privileged external settlement engine.
- **Reason:** A single state machine avoids trusted cross-contract settlement authority, duplicated liability totals, and synchronization risk. There is no live Phase 5 state to migrate.
- **Consequences:** Phase 6 must maintain per-game replay/settlement guards, exact turn/deadline semantics, and claim-to-game accounting. Any ABI replay-fencing additions require review against the locked v1 spec before implementation. This ADR adds no VM, hashing, bisection, or bond-outcome semantic changes.

## Open release/operations decisions

These are deployment and service choices, not undefined v1 state transitions:

1. Select actual bond/window values for each testnet deployment and document the rationale, expected block timing, monitoring coverage, and finality policy.
2. Measure worst-case program-validation, proof-verification, bisection, and withdrawal gas on the target EVM before deployment; the specification only bounds work, not gas cost.
3. Define production operations for trace-data archival, RPC redundancy, alerting, isolated challenger signer funding/rotation, and database retention.
4. Publish verifier address, source commit, compiler settings, deployment transaction, and independent audit status only after those events occur.

No such release settings are silently defaulted by this v1 specification.
