# BISECT optimistic execution protocol v1

**Status: LOCKED.** This document plus `vm-spec.md`, `encoding-spec.md`, `dispute-state-machine.md`, `security-model.md`, and `protocol-vectors.json` defines protocol version 1. Implementation MUST follow these documents exactly. A change to VM transitions, encodings, commitment construction, challenge outcomes, deadlines, or bond accounting requires a new protocol/VM/encoding version and new vectors. No contract implementation or audit is implied by this specification.

## 1. Purpose and scope

A prover commits to a fixed-length execution trace of a bounded deterministic VM program, binds the trace to the public program/input/budget, posts a native-ETH bond, and claims the final `R[0]`. Any address other than the prover may challenge during the challenge window with a different trace root and proof of the canonical initial state. The contract uses a leftmost-difference Merkle bisection to identify the first differing state, then verifies the prover's one-step transition from the shared predecessor. The prover's bond remains locked after a game where its transition is valid; it is credited to the prover only after the challenge window expires and the claim is finalized.

VM semantics are normative in `vm-spec.md`; all bytes and hashes are normative in `encoding-spec.md`; contract/game transitions and exact bond outcomes are normative in `dispute-state-machine.md`. `security-model.md` states assumptions and limits. The machine-readable compatibility vector is `protocol-vectors.json`.

## 2. Version and deployment configuration

This protocol uses `PROTOCOL_VERSION=1`, `VM_VERSION=1`, and `ENCODING_VERSION=1`. It runs on an EVM chain; Base Sepolia chain ID `84532` is the initial test network, but chain identity is not part of the execution trace hash. A deployed verifier MUST be non-upgradeable for the lifetime of its claims. A different VM/protocol version uses a distinct verifier deployment and versioned events.

The verifier constructor signature is `constructor(uint96 bondWei, uint32 challengeWindowBlocks, uint32 turnWindowBlocks)` and fixes three immutable configuration values:

- `bondWei`: `1..2^96-1` wei; both prover and challenger must send exactly this value.
- `challengeWindowBlocks`: `1..1,000,000` blocks.
- `turnWindowBlocks`: `1..100,000` blocks per expected response.

Values are per verifier deployment, never per claim, and cannot change after construction. A constructor outside these ranges reverts. These parameters affect incentives/liveness, not VM or hash semantics. A release MUST publish their deployed values and its chain-specific finality/monitoring assumptions.

## 3. Program, claim, and trace

The prover submits a statically valid program (1..128 four-byte instructions), exactly eight `uint64` public inputs, a transition count `N` from `{63,255,1023,4095}`, a `traceRoot`, a `uint64 claimedOutput`, and state membership proofs for indexes 0 and `N`. The verifier stores the exact bytecode, input, `N`, root, output, prover, and `challengeDeadline`. It validates the bytecode with the rules in `vm-spec.md`; verifies index 0 equals `{pc=0, halted=false, registers=input}`; verifies index `N` is halted and its `R[0]` equals `claimedOutput`; and requires exactly `bondWei`.

The trace contains exactly `N+1` states. The Merkle leaf count equals this state count (64, 256, 1024, or 4096); no padding is permitted. Each leaf hash binds the execution context, its exact state index, and the state. The context binds all three versions, program hash, input hash, `N`, and leaf count. The exact construction is in `encoding-spec.md`.

The verifier checks program syntax and the two endpoints, not every transition at submission. A false intermediate transition is adjudicated optimistically by challenges. The proposer is solely responsible for ensuring its execution halts by `N`; a trace with no halt by the budget is invalid.

## 4. Challenge and adjudication overview

During the challenge window, a non-prover may submit a different root and a valid proof that its index-0 state is the same canonical initial state, with exactly `bondWei`. Only one game is active per claim at a time. Once a game proves the prover's selected transition valid, or the challenger times out, the challenger loses its bond to the prover and the claim returns to `OPEN`; another address (including the same address) may challenge again until the original challenge deadline. The deadline is not extended by a game.

During a game the parties reveal child hashes for the current Merkle subtree. The prover responds first, then the challenger. Each pair of child reveals is checked against the parties' current parent hashes. If left-child hashes differ, the game descends left; otherwise it descends right. This left-first rule locates the smallest state index `k` where the two committed states differ. Because both roots prove the same index-0 state, `1 <= k <= N` and the two states at `k-1` are equal under the hash assumptions.

At the terminal index, the challenger reveals its states at `k-1` and `k` with membership proofs, then the prover reveals its states at those indexes with proofs. The predecessor states MUST match. The verifier computes the unique VM v1 successor from the predecessor. If the prover's state at `k` equals that successor, the prover wins the game; otherwise the prover loses and the claim is refuted. The challenger's successor is authenticated but need not itself be a valid transition: a challenger only wins by demonstrating that the proposal is invalid or by the prover's timeout.

Each expected response is due by its `deadlineBlock` inclusive. A response is timely iff `block.number <= deadlineBlock`; timeout can be claimed by anyone iff `block.number > deadlineBlock`. An invalid response reverts without changing the turn or deadline. The full state machine, including retry and timeout behavior, is in `dispute-state-machine.md`.

## 5. Lifecycle and bonds

Claim lifecycle:

```text
NONE --submit(+B)--> OPEN --finalize after deadline--> FINALIZED
                         |                               (B credited prover)
                         +--challenge(+B)--> GAME_ACTIVE
                                                |
            proposer valid / challenger timeout --+--> OPEN
                   (B challenger credited prover)
            proposer invalid / proposer timeout --+--> REFUTED
                         (2B credited challenger)
```

There is no cancel path, no fee, no treasury share, no direct push payout, and no ERC-20 bond. All amounts are integer wei. Settlement creates withdrawable credits. `withdraw()` pays only the caller's own credit using checks-effects-interactions and OpenZeppelin `ReentrancyGuard`; failure reverts and restores the credit. Direct ETH transfers are rejected; forced ETH is surplus and creates no user credit.

The verifier maintains `totalLiabilities = outstanding locked bonds + total user credits`. Every successful transition preserves `address(this).balance >= totalLiabilities`. Finalization, challenge loss, game loss, and timeout only move value from locked bonds to credits; withdrawal reduces both contract balance and liabilities by the same amount. Exact outcomes for every path are specified in `dispute-state-machine.md`.

## 6. Required protocol invariants

1. **Deterministic execution:** identical program bytes, input values, and `N` produce identical states at every index.
2. **Unambiguous step index:** each leaf includes its `uint16` state index and execution context; proofs for another index/context do not verify except under a Keccak collision/second-preimage break.
3. **Exact membership:** a valid proof reconstructs the committed root from the domain-separated leaf and ordered siblings.
4. **Unique initial state:** the claim and every challenge prove the sole initial state derived from the eight public input values.
5. **Final output binding:** claim submission proves `S[N].halted=true` and `S[N].R[0]=claimedOutput`.
6. **Cross-language agreement:** TypeScript and Solidity MUST use `vm-spec.md`, `encoding-spec.md`, and `protocol-vectors.json` without adaptation.
7. **Unique successor:** for a valid program and any unhalted fetchable state, VM v1 defines exactly one successor; halted states stutter uniquely.
8. **Honest challenge can isolate a fault:** an honest challenger commits its locally computed valid trace. If the proposal has a bad transition, the leftmost differing state has a shared predecessor and a proposer successor different from `step(P,S[k-1])`; that is the terminal proof.
9. **Bounded termination:** there are at most 12 bisection levels, 24 child-hash responses, and 2 terminal witness responses per game. Every turn expires after the immutable turn window. Under chain inclusion/liveness and an honest participant submitting in time, each game resolves by proof or timeout.
10. **Explicit bond settlement:** each deposit is exactly `B`; no-challenge finalization credits `B` to the prover; a prover-valid result or challenger timeout credits challenger `B` to the prover; a prover-invalid result or prover timeout credits `2B` to the challenger; credits are withdrawn by pull payment.

## 7. Non-goals

VM v1 is not a general-purpose computer, EVM/WASM interpreter, proof-of-execution system, validity proof, arbitrary-language sandbox, resource-priced compute market, multi-prover aggregation service, cross-chain bridge, censorship-resistant data-availability layer, DAO, insurance fund, or production custody system. It does not define application-level semantics for user programs beyond the ISA. PostgreSQL/indexers/UI are not correctness authorities. This specification does not assert implementation, deployment, audit, or production security.
