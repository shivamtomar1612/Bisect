# BISECT architecture

**Protocol status:** v1 semantics are specified and locked in `protocol-v1.md`. VM execution, ordered trace roots/proofs, typed off-chain SDK APIs, the Solidity one-step verifier, and the integrated Phase 6 bisection/settlement registry are implemented and locally tested. `BisectClaimRegistry` remains a fail-closed accounting base; the operative entrypoints are in `BisectDisputeRegistryV1`. The protocol has not been deployed to Base Sepolia or independently audited. Changes to locked semantics require explicit versioning as described in `docs/decisions.md`.

## System boundary

```text
TypeScript VM and trace builder
        │ canonical states + Keccak Merkle root
        ▼
Proposer wallet ── claim + bond ──> BisectDisputeRegistryV1
                                      ▲                         │
Challenger wallet ─ challenge/game ──┘                         ├─ public claim/game events
                                                                ▼
                                                 indexer / PostgreSQL / web UI
                                                 (derived, not authoritative)
```

The off-chain TypeScript implementation executes only the finite register-machine ISA in `vm-spec.md`. The Solidity verifier validates bounded programs and one-step transitions. The Phase 5 base contains endpoint validation and accounting internals and continues to fail closed by itself. The Phase 6 derived registry explicitly enables claims, games, settlement, and finalization. A client, indexer, or database cannot override contract state.

## Locked execution model

VM v1 has eight `uint64` registers, `uint16` instruction-index PC, boolean halted flag, fixed four-byte instructions, at most 128 instructions, and exactly eight `uint64` public inputs. It has no memory or host calls. Program/input/state encoding, domain-separated Keccak-256 hashes, fixed transition counts `{63,255,1023,4095}`, fixed power-of-two trace leaves, proofs, and vectors are fixed in `vm-spec.md` and `encoding-spec.md`.

The initial state is uniquely derived from input. A successful execution halts within its selected transition budget and repeats the halted state through the final trace index. The output is final register zero. Off-chain and Solidity implementations must match `protocol-vectors.json` byte-for-byte before protocol integration.

## Locked claim and dispute model

The prover posts a fixed deployment bond and a root with authenticated initial and final states. The final proof binds the claimed output. A challenge requires a different trace root, canonical initial-state proof, and an equal bond. There is one active game per claim; a challenger that loses does not finalize the claim, so another challenge can retry until the fixed challenge deadline. The original deadline is not extended.

Each bisection level compares both parties' ordered child hashes and descends left if the left child differs, otherwise right. This finds the leftmost differing state index. Both parties reveal authenticated states at that index and its predecessor. The verifier checks the predecessor agreement and the prover's unique VM successor. Exact turns, timeouts, retry semantics, and settlement amounts are in `dispute-state-machine.md`.

## On-chain accounting

The base contract defines exact native-ETH wei accounting, no fee or treasury, no admin withdrawal, and caller-only pull withdrawals. Its public submission and finalization paths revert when deployed alone, so it accepts no user bond. `BisectDisputeRegistryV1` reuses the internal claim/accounting paths and guards finalization against active games. `totalLiabilities` equals locked bonds plus credits and must not exceed contract balance. Forced ETH is surplus, not user credit. Claim admission, challenge bonds, game settlement, timeouts, and finalization have Foundry coverage and a mined local Anvil end-to-end run.

## Services

- **VM package:** bounded VM v1 execution, canonical ABI/Keccak encodings, fixed-length trace generation, and CLI are implemented and tested against TypeScript vectors.
- **Merkle package:** ordered, position-sensitive v1 roots and bottom-up inclusion proofs are implemented. The package reuses the VM's locked ABI/hash functions, independently builds the tree, and compares its root with the VM result.
- **SDK:** typed trace creation, state commitments, proof creation/verification, JSON-safe trace/proof import/export, generated base and dispute-registry ABIs, and viem reader/writer wrappers are implemented. No deployed address or wallet custody is bundled.
- **Solidity claim registry:** the base contains fail-closed shared accounting; `BisectDisputeRegistryV1` enables authenticated claim admission, exact-bond challenges, leftmost child-hash bisection, terminal one-step verification, deterministic timeout outcomes, pull-credit settlement, retries, and finalization. Foundry tests and a real-transaction local Anvil run cover the full path. No testnet deployment or independent audit is claimed.
- **Solidity verifier library:** bounded v1 program validation, one-step execution, domain-separated canonical hashing, and ordered inclusion proofs are implemented and checked against TypeScript-generated vectors.
- **Challenger:** the service that automatically watches claims and answers games remains planned. Local test tooling uses Anvil's unlocked test accounts only; no user keys are stored.
- **Indexer:** consumes public events and handles reorgs; data is derived and rebuildable. It is not a correctness authority.
- **Web application:** will show actual wallet/RPC states and contract events; it must not fabricate transactions, gas, proofs, or dispute results.
- **PostgreSQL:** stores derived service records only; contract state remains authoritative.

## Trust and release assumptions

The protocol assumes Keccak-256 collision resistance, correct EVM/Solidity semantics, a non-upgradeable verifier, chain liveness, transaction inclusion, and an honest challenger able to observe the challenge window and act within the turn windows. It does not guarantee off-chain trace data availability, censorship resistance, or finality; chain reorg/finality and window values must be published per deployment. See `security-model.md`.

Base Sepolia (chain ID `84532`) is the initial testnet target; local Anvil is the development chain. Local and public chain configuration are kept distinct. No contract address, deployment, audit, or production readiness is claimed.

The standalone Account Ledger addendum has not been authored yet. Phase 5's on-chain financial scope is limited to native-ETH protocol bonds and pull credits defined by the current task and `dispute-state-machine.md`; no wallet custody or database ledger exists.
