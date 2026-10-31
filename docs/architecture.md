# Architecture and protocol semantics (draft v0.1)

This document records the initial semantics that future implementations must preserve. It is a design baseline, not a security review or finalized protocol specification. Changes that affect commitments, game outcomes, or money require an ADR and corresponding tests.

## Goals and non-goals

BISECT is intended to let a prover publish a commitment to a bounded deterministic computation and bond funds, while a challenger can contest a conflicting result. An interactive game should reduce disagreement to one machine step, which a small on-chain verifier can check.

The first protocol is not a general-purpose EVM, arbitrary JavaScript sandbox, cross-chain bridge, validity proof system, or production custody system. The initial VM must use a small, explicitly specified instruction set with integer-only state and fixed execution bounds.

## Actors and trust assumptions

- **Prover:** supplies a program and input, executes it under the agreed VM version, publishes a trace commitment and proposed output, and posts the required bond.
- **Challenger:** observes a proposal, executes the same deterministic program, and posts a conflicting commitment plus its bond.
- **Verifier contract:** stores proposal/game state, enforces turns and deadlines, verifies a terminal one-step transition, and updates internal credits.
- **Watchers/indexer:** may observe public chain data and alert or automate a challenge. They are not trusted for correctness.
- **Chain:** Base Sepolia (chain ID `84532`) is the initial deployment target. Chain finality, reorg, gas, and RPC assumptions must be stated per release.

The chain and hash function are assumed to provide their documented security properties. Correctness must not depend on an indexer, web server, challenger service, or database being honest or online.

## VM and trace model

1. Program and input are byte strings in a versioned, canonical encoding. Malformed encodings are rejected before execution.
2. VM state is a fixed-width tuple: program counter, bounded integer registers, bounded memory, and halt status. Exact widths and maximum memory/instruction count remain a design gate.
3. Instructions are selected from a finite ISA. Each opcode has one total transition function, defined overflow behavior, and explicit gas-independent VM cost. No floating point, wall clock, randomness, filesystem, network, native calls, or host-language evaluation is allowed.
4. Execution begins at step 0 in a canonical initial state. A trace is the ordered sequence of states `s[0] ... s[n]`; one transition is `s[i] -> s[i+1]`. The maximum `n` is a protocol constant or a bounded per-program value.
5. A successful execution halts within the bound and yields a canonical output derived from final state. Exceeding a bound is a deterministic failure result, never an unbounded execution.
6. VM version is committed alongside program and input. A dispute cannot silently change the instruction semantics after commitment.

## Commitment model (proposed)

The working design is a domain-separated Merkle commitment to canonical state encodings, with the VM version, program hash, input hash, trace length, and encoding version bound into a public execution identifier. Leaf and internal-node domains must differ. Proof shape, empty/padding leaves, tree arity, hash choice, and calldata limits are unresolved and must be settled before writing the Solidity verifier.

All hashes and encodings must be reproducible byte-for-byte across TypeScript and Solidity. The implementation must publish cross-language test vectors. Hashes are commitments, not evidence that the prover executed correctly.

## Proposal lifecycle (proposed)

`None -> Proposed -> Challenged | Finalized | Expired`

- A proposal binds prover, VM version, program/input identifiers, trace commitment, trace length, result, bond, and a challenge deadline.
- Only a valid, bounded proposal with the exact required bond can be opened.
- A timely conflicting challenge opens one game and locks the challenger bond. How multiple challengers are handled is unresolved.
- If no challenge arrives by the deadline, the proposal may finalize and the prover may reclaim or receive the configured bond according to the eventual economic design.
- A finalized proposal cannot be reopened. A closed game cannot be replayed.

## Bisection game (proposed)

The two parties commit to trace endpoints over a common interval. At each round, the responder reveals the midpoint state and an inclusion proof. The opponent either accepts the midpoint or supplies a conflicting midpoint commitment, shrinking the disputed interval. The interval must shrink monotonically; its length is a power-of-two padded or otherwise canonically split so that a valid game reaches a single transition in a bounded number of rounds.

At terminal width one, the contract obtains the predecessor state, successor state, and any required program data, verifies Merkle inclusion against the party's committed root, and applies the specified single-step transition. The party whose committed transition is invalid loses. Exact response order, midpoint rules, proofs, malformed-response behavior, and timeout ownership are unresolved and must be specified before contract implementation.

## Bond accounting (proposed)

- Use integer wei values only. Deposits, locked bonds, credits owed, and total accounted ETH must be explicit state variables or derivable without ambiguity.
- Enforce `contract balance >= total liabilities` for every state transition. Forced ETH must not create user credit.
- Update internal credits before exposing withdrawals; use pull payments, checks-effects-interactions, and OpenZeppelin reentrancy protection where appropriate.
- Define exact outcomes for valid/invalid step, timeout, cancellation, duplicate challenge, and failed withdrawal before enabling money movement.
- Avoid iterating over users or games during settlement. Any loops must have protocol-level static bounds.

No bond size, fee, reward split, timeout interval, or payout amount is finalized by this draft.

## Off-chain services and UI

- The indexer consumes canonical contract events with reorg-aware checkpoints; it is a query/alerting aid, not a source of truth.
- The challenger service may calculate and submit a response only when configured with an explicitly isolated signer. It must fail closed on stale or ambiguous chain data.
- The web app uses wagmi/viem for real wallet and chain interactions. It must show pending, confirmed, reverted, and unavailable states from actual RPC/wallet data and must not fabricate gas or transaction status.
- PostgreSQL stores derived/indexed records only. Contract state remains authoritative.

## Release gates

Before a testnet release: finalize the protocol decisions; implement typed encoders and cross-language vectors; test all state transitions and economic boundaries; fuzz the VM and verifier; run Foundry, TypeScript, and e2e suites; review deployment configuration; and document the deployed address and exact source commit. Testnet deployment does not imply audit or production readiness.
