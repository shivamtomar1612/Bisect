# BISECT architecture

**Protocol status:** v1 semantics are specified and locked in `protocol-v1.md`. This is a design document, not evidence that the VM, Merkle package, dispute contract, indexer, or challenger is implemented. Changes to locked semantics require explicit versioning as described in `docs/decisions.md`.

## System boundary

```text
TypeScript VM and trace builder
        │ canonical states + Keccak Merkle root
        ▼
Proposer wallet ── claim + bond ──> immutable v1 verifier contract
                                      ▲              │
Challenger wallet ─ challenge/game ──┘              ├─ public claim/game events
                                                     ▼
                                      indexer / PostgreSQL / web UI
                                      (derived, not authoritative)
```

The off-chain TypeScript implementation executes only the finite register-machine ISA in `vm-spec.md`. The Solidity verifier validates the bounded program encoding and claim endpoints, manages claim/game deadlines and bonds, and verifies authenticated states plus one VM transition. A client, indexer, or database cannot override contract state.

## Locked execution model

VM v1 has eight `uint64` registers, `uint16` instruction-index PC, boolean halted flag, fixed four-byte instructions, at most 128 instructions, and exactly eight `uint64` public inputs. It has no memory or host calls. Program/input/state encoding, domain-separated Keccak-256 hashes, fixed transition counts `{63,255,1023,4095}`, fixed power-of-two trace leaves, proofs, and vectors are fixed in `vm-spec.md` and `encoding-spec.md`.

The initial state is uniquely derived from input. A successful execution halts within its selected transition budget and repeats the halted state through the final trace index. The output is final register zero. Off-chain and Solidity implementations must match `protocol-vectors.json` byte-for-byte before protocol integration.

## Locked claim and dispute model

The prover posts a fixed deployment bond and a root with authenticated initial and final states. The final proof binds the claimed output. A challenge requires a different trace root, canonical initial-state proof, and an equal bond. There is one active game per claim; a challenger that loses does not finalize the claim, so another challenge can retry until the fixed challenge deadline. The original deadline is not extended.

Each bisection level compares both parties' ordered child hashes and descends left if the left child differs, otherwise right. This finds the leftmost differing state index. Both parties reveal authenticated states at that index and its predecessor. The verifier checks the predecessor agreement and the prover's unique VM successor. Exact turns, timeouts, retry semantics, and settlement amounts are in `dispute-state-machine.md`.

## On-chain accounting

The immutable verifier uses exact native-ETH wei amounts. It has no fee, treasury, admin withdrawal, upgrade path, or cancel path. Locked deposits transition to pull-payment credits under explicit settlement rules. `totalLiabilities` equals all locked bonds plus all credits and must never exceed contract balance. Withdrawal is caller-only, checks-effects-interactions, and protected with OpenZeppelin `ReentrancyGuard`. Forced ETH is surplus, not user credit.

## Services

- **VM/Merkle packages:** canonical encoding, bounded execution, trace construction, and Merkle membership proofs. Planned; no production functionality is claimed yet.
- **Verifier contract:** authority for claims, games, deadlines, and credits. Specified, not yet implemented/deployed.
- **Challenger:** independently recomputes traces, watches claims, and answers games with an isolated signer. Planned; availability and key custody are operator responsibilities.
- **Indexer:** consumes public events and handles reorgs; data is derived and rebuildable. It is not a correctness authority.
- **Web application:** will show actual wallet/RPC states and contract events; it must not fabricate transactions, gas, proofs, or dispute results.
- **PostgreSQL:** stores derived service records only; contract state remains authoritative.

## Trust and release assumptions

The protocol assumes Keccak-256 collision resistance, correct EVM/Solidity semantics, a non-upgradeable verifier, chain liveness, transaction inclusion, and an honest challenger able to observe the challenge window and act within the turn windows. It does not guarantee off-chain trace data availability, censorship resistance, or finality; chain reorg/finality and window values must be published per deployment. See `security-model.md`.

Base Sepolia (chain ID `84532`) is the initial testnet target; local Anvil is the development chain. Local and public chain configuration are kept distinct. No contract address, deployment, audit, or production readiness is claimed.
