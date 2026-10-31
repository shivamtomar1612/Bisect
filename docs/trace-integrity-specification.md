# BISECT trace integrity and data availability profile

**Status:** Phase 6A operational and test specification for the locked protocol v1 dispute game. This document clarifies trace integrity and prototype data handling; it does not change VM v1, encoding v1, the v1 challenge witness, child-hash bisection, turn deadlines, or bond outcomes.

## 1. Security objective

A valid final output does not establish that every committed intermediate state follows the VM. A prover can commit to a trace with a false intermediate state and later return to the correct result. Claim admission authenticates the canonical initial state and a halted final state whose register zero equals the claimed output. Those endpoint checks alone do not authenticate intermediate transitions.

For example, a program can write `5`, then `42`, then halt. A trace that substitutes `9` at state index 1, but later returns to `42`, has the same claimed final output as the valid trace and a different execution root. An honest challenge must still identify the first differing state and run the one-step verifier on the prover's state transition.

The required safety result is:

```text
If the prover's committed trace contains an invalid transition, and an honest
challenger's challenge and required responses are included before their block
deadlines, the prover cannot win by presenting a matching final output.
```

This is conditional on the hash, EVM, encoding, chain-liveness, and participant-response assumptions in `security-model.md`. It is not a guarantee of challenge discovery, transaction inclusion, or data availability.

## 2. Canonical trace and context

The claim's on-chain record is authoritative for the exact raw program, eight-value public input, transition count `N`, context hash, proposer trace root, claimed output, prover, and deadlines. The context hash binds protocol, VM, and encoding versions; program identity; public input; and `N`/leaf count. A challenger must construct its trace from those exact values using VM v1.

The trace contains exactly `N+1` states indexed `0..N`. Each leaf binds the execution context, its exact state index, and canonical state encoding. Ordered child hashing is position-sensitive. The allowed proof depth is derived from the stored `N`; callers do not choose an independent context, program version, proof depth, or encoding.

An execution root commits to those leaf hashes. It does **not** contain the states, make them retrievable, prove each state transition, or prove that an off-chain archive exists.

## 3. Minimum witness to establish a mismatch

An honest challenger performs the following work:

1. Read the claim directly from the registry or a verified RPC, including program, input, `N`, root, output, claim status, and challenge deadline.
2. Execute the stored program and input with the Phase 2 VM v1 for exactly `N` transitions. Confirm the final state is halted and its register zero equals the claim output. Build the challenger's ordered root and retain the trace/tree data.
3. If the recomputed root equals the claim root, do not challenge: under the collision-resistance and canonical-encoding assumptions, the committed state sequence equals the canonical execution. If roots differ, submit the challenger root, exactly `H=log2(N+1)` siblings authenticating the canonical index-zero state, and the exact challenger bond before the challenge deadline.
4. At each v1 bisection level, reveal the ordered left and right child subtree hashes for the selected subtree. The contract requires each pair to hash to that participant's current parent. The prover responds first, then the challenger. V1 descends left whenever left child hashes differ; otherwise it descends right. This preserves the common low boundary and selects the leftmost differing state index `k`.
5. At `k`, provide membership proofs under the participant's own root for states `S[k-1]` and `S[k]`, with exactly `H` siblings each. The contract checks the selected successor leaf, verifies both predecessors are equal, and runs the VM v1 one-step verifier on the prover's authenticated transition. The challenger wins only if the prover transition is invalid, a terminal commitment inconsistency is proven, or the prover times out.

The mismatch is authenticated at the end of the existing bisection game. V1 does not take a caller-selected midpoint state or accept an unauthenticated “mismatch index” at challenge opening. It opens on a distinct context-bound root plus the canonical initial-state proof; the game then authenticates the selected differing state. This is why same-output intermediate fraud is challengeable without changing the locked admission witness.

### Challenger trace validity boundary

An honest challenger **must** independently compute and retain a valid VM v1 trace under the claim's exact context. The existing SDK trace API executes the VM and derives the root and proofs from that trace. The contract checks the challenger root's context-bound initial proof and later checks all revealed membership paths against that same root and the stored claim context.

V1 does not attempt to execute every challenger transition on-chain at challenge opening. An arbitrary different root may open a game if its initial proof is valid. It cannot slash a valid proposer merely by being malformed: the proposer wins the terminal adjudication when its authenticated transition is the unique valid successor. The challenger's full-trace validity is therefore an honest-client rule, while the adjudicator's safety rests on proving the proposer's transition. A dishonest challenger can lose its bond and consume a bounded game; it cannot make a valid proposer lose a proof-based adjudication.

## 4. Context and witness rejection rules

The following must fail without consuming a turn, changing financial state, or extending a deadline:

- A challenge root equal to the claim root, or a challenge initial state other than the exact canonical state.
- A missing, truncated, reordered, altered, or wrong-root initial proof.
- A bisection child pair that does not hash in left/right order to that party's selected parent, or a pair not corresponding to the currently selected tree position.
- A terminal proof with a wrong state index, root, program, public input, transition count, proof depth, state encoding, or sibling path.
- A terminal predecessor mismatch or a prover successor that differs in any state field from the VM v1 result.

VM and encoding versions are constants in the v1 verifier, not caller-supplied challenge metadata. The caller cannot select a different version. Program/input/budget substitutions change the context hash and therefore cannot reuse a valid state proof under the stored claim root.

No `midpoint` state proof is part of the locked child-hash v1 protocol. Tests for “wrong-context midpoint proofs” must be interpreted as wrong-context initial or terminal membership proofs; adding midpoint-state bisection would require a separately versioned protocol and is outside Phase 6A.

## 5. Trace publication and retrieval for the testnet prototype

The Solidity registry stores the program and public input required to reproduce the canonical trace, plus the commitment and claim metadata. It does not store a trace archive or an archive URL. Phase 6A does not add a storage service or make archive publication an on-chain precondition.

For a Base Sepolia prototype, operators should use this publication profile:

1. Before submitting a claim, execute the VM locally and export the canonical JSON trace using the SDK. Parse the exported artifact again with the SDK so it replays the program, validates all states, recomputes the context and root, and confirms the output.
2. Publish the exact artifact through two independently operated, publicly retrievable locations before sending `submitClaim`. After the transaction confirms, publish a small public manifest keyed by `(chainId, registryAddress, claimId, traceRoot)` that lists the artifact locations, schema version, context hash, transition count, and a transport checksum. The manifest and locations are discovery aids; none are consensus inputs.
3. A retriever reads the claim from the contract, fetches the artifact, checks its transport checksum, and imports it with the SDK. Accept it as a matching trace only if replayed program, input, budget, context hash, and root equal the on-chain values. A transport checksum or URL alone is not a proof.
4. Keep both copies available until the claim is terminal and the deployment's published finality depth has passed; retain them for at least 30 further days for testnet incident review. If a claim is still open or a dispute is active, retention continues regardless of age. Each deployment must publish its actual finality policy and retention contact.

This publication policy is an operator assumption, not an enforced contract rule. No archive provider, manifest service, or retention monitor is implemented by this phase. Public claims already reveal their program and input, and testnet trace artifacts must not contain secrets or private user data.

## 6. What happens when data is unavailable

### Before a challenge

The prover's trace artifact is not necessary for a challenger to recompute the reference execution: the bounded program, input, and transition count are on-chain. The challenger can independently compute its own root and compare it with the stored root. If the roots differ, v1 permits challenge opening with the exact initial-state proof and bond. Thus withholding the proposer's off-chain artifact does not block the proof path, provided the chain data and challenger implementation are available.

If the challenger cannot obtain the claim context from a reliable RPC/index source, cannot compute the bounded trace, lacks funds, or cannot get its challenge included by the deadline, there is no availability fallback. An invalid claim can finalize after the challenge window if no challenge is active. This is an explicit monitoring and chain-liveness risk.

### During an active game

The active responder must reveal the required child hashes or terminal membership proofs by the inclusive turn deadline. If the prover withholds its required response, anyone may call `claimTimeout` only after `block.number > deadlineBlock`; the locked v1 outcome refutes the claim and credits both bonds to the challenger. If the challenger withholds its response, its bond is credited to the prover and the claim returns to `OPEN`. Credits remain pull-based and are settled once.

There is no extra grace period, data-availability committee, archive oracle, or automatic extension. Adding one would change the party at risk, timing, or financial outcome and therefore needs a new protocol version and an explicit economic/security analysis. RPC outage, censorship, reorganization, or a challengeer's own missing proof data can still cause an honest participant to miss a deadline.

## 7. Test requirements and implementation status

Phase 6A regression coverage must demonstrate:

- A valid trace with the claimed output is accepted and wins a challenge based on an alternate root.
- A dishonest intermediate state is refuted even when the prover's final output equals the honest output.
- A different-output challenger cannot slash a valid proposer.
- Forged or wrong-context initial/terminal witnesses are rejected without bond movement.
- Withheld proposer data reaches the existing strict timeout boundary and settles both bonds once; repeated settlement is rejected.
- A mined local Anvil run exercises both proof-based same-output fraud resolution and a real timeout for a withheld proposer response.

These tests establish local contract behavior only. They do not establish Base Sepolia availability, an operational archive, honest monitoring, chain inclusion, or production security.
