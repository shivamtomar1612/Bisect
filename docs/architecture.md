# BISECT architecture

**Protocol status:** v1 semantics are specified and locked in `protocol-v1.md`. VM execution, ordered trace roots/proofs, typed off-chain SDK APIs, and the Solidity one-step verifier are implemented. Phase 5 escrow/accounting helpers exist, but the base `BisectClaimRegistry` rejects claim submissions and never finalizes because there is no dispute game. A derived test harness exercises shared paths only; it is not a production deployment. Phase 6 must provide a complete integrated dispute registry before claims or bonds are enabled. Changes to locked semantics require explicit versioning as described in `docs/decisions.md`.

## System boundary

```text
TypeScript VM and trace builder
        │ canonical states + Keccak Merkle root
        ▼
Proposer wallet ── claim + bond ──> Phase 6 dispute registry (planned)
                                      ▲                         │
Challenger wallet ─ challenge/game ──┘                         ├─ public claim/game events
                                                                ▼
                                                 indexer / PostgreSQL / web UI
                                                 (derived, not authoritative)
```

The off-chain TypeScript implementation executes only the finite register-machine ISA in `vm-spec.md`. The Solidity verifier validates bounded programs and one-step transitions. The Phase 5 base contains endpoint validation and accounting internals, but public claim admission and finalization fail closed. It does not admit challenges or manage dispute-game outcomes. A client, indexer, or database cannot override contract state.

## Locked execution model

VM v1 has eight `uint64` registers, `uint16` instruction-index PC, boolean halted flag, fixed four-byte instructions, at most 128 instructions, and exactly eight `uint64` public inputs. It has no memory or host calls. Program/input/state encoding, domain-separated Keccak-256 hashes, fixed transition counts `{63,255,1023,4095}`, fixed power-of-two trace leaves, proofs, and vectors are fixed in `vm-spec.md` and `encoding-spec.md`.

The initial state is uniquely derived from input. A successful execution halts within its selected transition budget and repeats the halted state through the final trace index. The output is final register zero. Off-chain and Solidity implementations must match `protocol-vectors.json` byte-for-byte before protocol integration.

## Locked claim and dispute model

The prover posts a fixed deployment bond and a root with authenticated initial and final states. The final proof binds the claimed output. A challenge requires a different trace root, canonical initial-state proof, and an equal bond. There is one active game per claim; a challenger that loses does not finalize the claim, so another challenge can retry until the fixed challenge deadline. The original deadline is not extended.

Each bisection level compares both parties' ordered child hashes and descends left if the left child differs, otherwise right. This finds the leftmost differing state index. Both parties reveal authenticated states at that index and its predecessor. The verifier checks the predecessor agreement and the prover's unique VM successor. Exact turns, timeouts, retry semantics, and settlement amounts are in `dispute-state-machine.md`.

## On-chain accounting

The base contract defines exact native-ETH wei accounting, no fee or treasury, no admin withdrawal, and caller-only pull withdrawals. Its public submission and finalization paths revert while the dispute protocol is absent, so it accepts no user bond. A dispute-enabled derived deployment may reuse `_submitClaim`, `_recordIncomingBond`, `_moveLockedBondToCredit`, and `_finalizeClaimAfterDisputeResolution`; it must add proof-authorized game transitions and guard finalization against active games. `totalLiabilities` equals locked bonds plus credits and must not exceed contract balance. Forced ETH is surplus, not user credit. Challenge bond accounting and game settlement remain unimplemented.

## Services

- **VM package:** bounded VM v1 execution, canonical ABI/Keccak encodings, fixed-length trace generation, and CLI are implemented and tested against TypeScript vectors.
- **Merkle package:** ordered, position-sensitive v1 roots and bottom-up inclusion proofs are implemented. The package reuses the VM's locked ABI/hash functions, independently builds the tree, and compares its root with the VM result.
- **SDK:** typed trace creation, state commitments, proof creation/verification, JSON-safe trace/proof import/export, generated claim-registry ABI, and viem reader/writer wrappers are implemented. No deployed address or wallet custody is bundled.
- **Solidity claim registry base:** endpoint-authenticated submission internals, exact-bond escrow accounting, immutable windows, duplicate prevention, liability views, and pull withdrawals are present. Public submission and finalization revert until a dispute-enabled derived implementation exists. Foundry harnesses exercise internal paths only; they do not establish production settlement. The challenge/game contract is not implemented.
- **Solidity verifier library:** bounded v1 program validation, one-step execution, domain-separated canonical hashing, and ordered inclusion proofs are implemented and checked against TypeScript-generated vectors.
- **Challenger:** independently recomputes traces, watches claims, and answers games with an isolated signer. Planned; availability and key custody are operator responsibilities.
- **Indexer:** consumes public events and handles reorgs; data is derived and rebuildable. It is not a correctness authority.
- **Web application:** will show actual wallet/RPC states and contract events; it must not fabricate transactions, gas, proofs, or dispute results.
- **PostgreSQL:** stores derived service records only; contract state remains authoritative.

## Trust and release assumptions

The protocol assumes Keccak-256 collision resistance, correct EVM/Solidity semantics, a non-upgradeable verifier, chain liveness, transaction inclusion, and an honest challenger able to observe the challenge window and act within the turn windows. It does not guarantee off-chain trace data availability, censorship resistance, or finality; chain reorg/finality and window values must be published per deployment. See `security-model.md`.

Base Sepolia (chain ID `84532`) is the initial testnet target; local Anvil is the development chain. Local and public chain configuration are kept distinct. No contract address, deployment, audit, or production readiness is claimed.

The standalone Account Ledger addendum has not been authored yet. Phase 5's on-chain financial scope is limited to native-ETH protocol bonds and pull credits defined by the current task and `dispute-state-machine.md`; no wallet custody or database ledger exists.
