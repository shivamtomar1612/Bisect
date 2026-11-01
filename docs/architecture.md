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

The prover posts a fixed deployment bond and a root with authenticated initial and final states. The final proof binds the claimed output, but does not establish every intermediate transition. A dishonest intermediate state remains challengeable even when the final output matches the honest VM result. A challenger independently recomputes the trace from the claim's on-chain program, input, and transition count. V1 challenge admission requires a different context-bound root, the canonical initial-state proof, and an equal bond. Ordered child-hash bisection authenticates the leftmost differing state before the contract verifies the prover's adjacent transition. There is one active game per claim; a challenger that loses does not finalize the claim, so another challenge can retry until the fixed challenge deadline. The original deadline is not extended.

Trace roots contain hashes only; they do not make trace data available. The contract retains the program and input needed to reproduce the canonical trace. For the testnet prototype, provers should publish and retain replay-validated trace artifacts in two independent public locations under the operational profile in [`trace-integrity-specification.md`](trace-integrity-specification.md). This archive is not a consensus dependency or a contract-enforced precondition. If a prover withholds a response after a game opens, the existing v1 timeout settles the game against the missed responder; no archive-based grace period is added.

Each bisection level compares both parties' ordered child hashes and descends left if the left child differs, otherwise right. This finds the leftmost differing state index. Both parties reveal authenticated states at that index and its predecessor. The verifier checks the predecessor agreement and the prover's unique VM successor. Exact turns, timeouts, retry semantics, and settlement amounts are in `dispute-state-machine.md`.

## On-chain accounting

The base contract defines exact native-ETH wei accounting, no fee or treasury, no admin withdrawal, and caller-only pull withdrawals. Its public submission and finalization paths revert when deployed alone, so it accepts no user bond. `BisectDisputeRegistryV1` reuses the internal claim/accounting paths and guards finalization against active games. `totalLiabilities` equals locked bonds plus credits and must not exceed contract balance. Forced ETH is surplus, not user credit. Claim admission, challenge bonds, game settlement, timeouts, and finalization have Foundry coverage and a mined local Anvil end-to-end run.

Phase 7 adds generated intermediate-mismatch vectors and a production-registry invariant handler. The invariant accounts for each prover/challenger bond and beneficiary credit across two claims, complete games, timeouts, finalization, and withdrawals. Tests also exercise callback reentrancy, reverting recipients, unknown-claim settlement attempts, and forced ETH. This remains local test evidence; it does not establish an independent audit or chain-level liveness/data availability.

## Services

- **VM package:** bounded VM v1 execution, canonical ABI/Keccak encodings, fixed-length trace generation, and CLI are implemented and tested against TypeScript vectors.
- **Merkle package:** ordered, position-sensitive v1 roots and bottom-up inclusion proofs are implemented. The package reuses the VM's locked ABI/hash functions, independently builds the tree, and compares its root with the VM result.
- **SDK:** typed trace creation, state commitments, proof creation/verification, JSON-safe trace/proof import/export, generated base and dispute-registry ABIs, and viem reader/writer wrappers are implemented. No deployed address or wallet custody is bundled.
- **Trace data availability:** the SDK can export/import and replay-check bounded canonical traces. No archive provider, publication manifest, or retention monitor is implemented; the prototype publication/retention profile and timeout behavior are specified in `trace-integrity-specification.md`.
- **Solidity claim registry:** the base contains fail-closed shared accounting; `BisectDisputeRegistryV1` enables authenticated claim admission, exact-bond challenges, leftmost child-hash bisection, terminal one-step verification, deterministic timeout outcomes, pull-credit settlement, retries, and finalization. Foundry tests and a real-transaction local Anvil run cover the full path. No testnet deployment or independent audit is claimed.
- **Solidity verifier library:** bounded v1 program validation, one-step execution, domain-separated canonical hashing, and ordered inclusion proofs are implemented and checked against TypeScript-generated vectors.
- **Indexer and read API:** `apps/indexer` scans the configured registry from its deployment block, persists block/log identity and raw event bytes, confirms only after the configured descendant depth, resumes from a hash-checked checkpoint, and detects/replays bounded reorganizations. Its GET-only API exposes paginated public chain-derived records and never authorizes a wallet or moves value.
- **PostgreSQL and journal:** Prisma stores normalized wallet, claim, dispute, bond, settlement, withdrawal, event, checkpoint, account, posting, and reconciliation records. Confirmed financial events produce an exact-wei append-only double-entry journal; deferred PostgreSQL constraints enforce balance and append-only triggers prevent edits. Reorg corrections append inverse journal entries while derived views are replayed from canonical confirmed events. Contract state remains authoritative.
- **Automated challenger:** `apps/challenger` is an optional, separate TypeScript service. It reads confirmed claim/game events, replays each canonical v1 VM context with the SDK, ignores matching roots, and can answer a valid mismatch through the existing registry. Dry-run is the default; signing requires a dedicated explicit bot signer, a broadcast opt-in, positive wei/gas caps, and a verified supported chain ID. It never reads user wallets or writes the database ledger. Ambiguous transactions stay durably reserved until receipt reconciliation, and reorg detection replays registry events from the deployment block while preserving challenge-attempt records.
- **Indexer limitations:** the Phase 8 prototype polls one registry per process, assumes one active writer for each configured chain/contract, and halts on reorganizations deeper than the configured bound. Confirmation depth is an operational threshold, not finality. Base Sepolia has no configured deployed address in this repository; only a real local Anvil deployment is currently exercised.
- **Web application:** the Phase 10 landing page and read-only workspace retain the Phase 9 design system. The dashboard, claims explorer, disputes explorer, and claim detail read confirmed data from the Phase 8 API when `BISECT_INDEXER_API_URL` is configured. The indexer adds an aggregate overview and claim-detail endpoint; search/status filters and cursor navigation use the paginated API. API unavailability is shown as an error state rather than an empty result or fabricated zero. The Account Ledger route remains a read-only future layout. The frontend does not sign transactions or initiate withdrawals. There is no configured Base Sepolia deployment in this repository.
- **PostgreSQL:** stores derived service records only; contract state remains authoritative.

## Phase 15 automated challenger

The bot uses the actual claim program, public input, transition budget, trace root, and context stored by the contract. It independently computes the exact canonical trace, checks the context binding, and treats only a different root as challenge evidence; matching final outputs do not hide an intermediate trace mismatch. Its challenge root and bisection/terminal evidence are generated by the existing VM and Merkle SDK. It follows the existing v1 child-hash bisection and contract timeout/settlement rules without changing contract authority.

Operational writes are disabled unless explicitly configured. The bot applies per-dispute bond, total exposure, per-transaction gas, balance, and retry limits; transactions use the configured signer as an ordinary challenger. A durable pending-write record prevents another write while a sent transaction is unresolved. The bot can inspect/dry-run claims, monitor games, issue emergency stop/disable controls, and emits JSONL lifecycle logs. Local Anvil testing demonstrates a real test-ETH dispute and an event-derived reconciliation against live escrow reads. No Base Sepolia registry address or public deployment is configured.

## Phase 11 Program Studio

The browser Program Studio consumes the Phase 2 VM and Phase 3 SDK. It validates BISECT assembly, exactly eight decimal-string uint64 inputs, and one approved transition budget before execution. The VM runs locally in the browser without evaluating user JavaScript or contacting a chain. The Studio displays every bounded trace through a virtualized state list, generates and verifies context-bound state proofs, and exports canonical artifacts with uint64 values preserved as decimal strings.

For halted runs, the Studio can prepare the exact Phase 5 ClaimSubmission tuple, its authenticated initial/final endpoint proofs, and viem-encoded submitClaim calldata using the generated integrated-registry ABI. The configured prover bond remains a separate msg.value and is not invented. Preparing or exporting data never requests a wallet signature or submits a transaction. A separate explicitly test-only fixture proves membership for a deliberately modified intermediate trace while showing that its first VM transition is invalid and its final output remains unchanged; that altered root cannot be used for a claim.

## Phase 16 gas benchmark

`pnpm phase16:benchmark` executes matched deterministic workloads against a benchmark-only Solidity direct runner and the existing `BisectDisputeRegistryV1` on an isolated local Anvil chain. The direct runner calls the v1 verifier's bounded program validator and exact transition routine; it is not a protocol contract. Claim, challenge, bisection, terminal verification, timeout, finalization, and withdrawal costs are read from real local transaction receipts. Bond principal is tracked as collateral separately from receipt gas costs, and the runner checks the escrow invariant after each financial operation.

Generated receipt data and SVG charts live in `docs/benchmarks/`; the web dashboard serves a copy labeled as a local Anvil snapshot, not Base Sepolia activity. The benchmark reports one six-instruction loop and one configuration only. It cannot establish Base Sepolia fees, universal break-even behavior, or production economics. See `phase-16-report.md` for the sample, lifecycle definitions, results, and limitations.

## Trust and release assumptions

The protocol assumes Keccak-256 collision resistance, correct EVM/Solidity semantics, a non-upgradeable verifier, chain liveness, transaction inclusion, and an honest challenger able to observe the challenge window and act within the turn windows. It does not guarantee off-chain trace data availability, censorship resistance, or finality; chain reorg/finality and window values must be published per deployment. See `security-model.md`.

Base Sepolia (chain ID `84532`) is the initial testnet target; local Anvil is the development chain. Local and public chain configuration are kept distinct. No contract address, deployment, audit, or production readiness is claimed.

The standalone Account Ledger addendum has not been authored. Phase 8's off-chain journal is deliberately derived from the existing native-ETH bond and pull-credit events; it adds no on-chain financial semantics, wallet custody, fee, or settlement authority. Its conventions and reorganization treatment are documented in `ledger-reconciliation.md`.
