# BISECT v1 security model

**Status: specification and partial implementation; unaudited.** The Phase 5 base retains claim validation, escrow/accounting, and pull-withdrawal code, but its public claim and finalization entrypoints revert while the dispute game is absent. A test-only derived harness exercises internal logic; it is not a production contract. Endpoint proofs alone do not make a trace correct.

## 1. Protected properties

Under the assumptions below, a complete implementation of the locked v1 protocol aims to ensure. The current Phase 5 base accepts no claims and provides none of these on-chain guarantees yet:

- A finalized proposal has a unique program/input/VM/budget context and an authenticated initial and final state; its final output equals final `R[0]`.
- If the committed proposer trace contains an invalid transition, an honest challenger with the correct trace can refute it if the challenge and all required responses are included before their respective deadlines.
- A valid proposer is not slashable by a challenger merely for supplying an arbitrary conflicting root; the prover wins if its isolated successor matches the unique VM v1 transition.
- Locked bonds are not paid twice and cannot be withdrawn by a third party. Withdrawals are pull-based and nonreentrant.

Even in a completed v1 implementation, finalization without a successful challenge is not a proof that every transition was valid. It is acceptance under an optimistic monitoring/challenge assumption.

## 2. Cryptographic assumptions

The protocol assumes Ethereum Keccak-256 collision and second-preimage resistance for all domain-separated hashes. It assumes Solidity/EVM `abi.encode` and `keccak256` behave according to their specifications and that independent TypeScript and Solidity implementations match the vectors. Merkle proofs establish membership only under these assumptions; a hash is not evidence of correct execution by itself.

The protocol assumes no feasible attack makes distinct child pairs map to the same internal node hash, or distinct state/context/index tuples map to the same leaf hash. Terminal commitment-inconsistency settlement is defined for defensive determinism, but such a branch indicates a hash break, implementation defect, or incompatible verifier and is outside normal security guarantees.

## 3. Chain and finality assumptions

The contract executes on an EVM chain; Base Sepolia (chain ID `84532`) is the initial test target. The verifier uses `block.number`, not wall-clock timestamps, for the challenge window and response deadlines. It assumes blocks continue to be produced and transactions from an honest participant can be included within the configured windows. A block halt pauses deadlines and dispute progress.

An EVM reorganization may undo submissions, responses, timeout claims, payouts, or withdrawals. The contract does not itself establish finality. Clients and operators must apply a chain-specific confirmation/finality policy before treating an event or balance change as durable. A Base RPC endpoint, sequencer, relayer, or indexer is not trusted to decide correctness, but RPC censorship/outage can prevent timely actions.

`challengeWindowBlocks` must be chosen long enough for independent observers to discover a proposal, retrieve/recompute its context, build a challenge, and have the transaction included. `turnWindowBlocks` must be long enough for a participant to compute a bounded response, obtain an inclusion path, and submit it. The protocol fixes allowed ranges, not a universal wall-clock duration; each deployment must publish a justified value and monitoring assumptions.

## 4. Participant honesty and availability

### Prover

The prover may commit to a false trace or output. The endpoint checks reject an incorrect initial state, non-halted final state, or output mismatch, but do not check every intermediate transition. A prover that responds to an honest challenge loses if the isolated successor is invalid. A prover that fails to respond before a deadline loses the claim and both active bonds. If no honest challenge is submitted in time, a false proposal may finalize.

### Challenger

Any non-prover address may challenge with a different root and canonical initial-state proof. A challenger need not claim a valid final state; only the prover's transition is adjudicated. A dishonest challenger that fails to demonstrate a proposer fault loses its bond to the prover. A challenger that does not respond in time loses its bond. The single-active-game rule allows a bond-backed challenger to delay another game's start until its current game ends; failed challenges pay their bond to the prover and do not close the challenge window.

### Watchers and data availability

The complete trace is not stored on chain. The verifier stores the program and claim context; the trace commitment stores hashes only. A challenger must independently execute the program and retain its own trace/tree data to produce its root, child hashes, states, and Merkle proofs. Because the claim's program, input, and budget are on chain, the challenger can reconstruct the canonical reference trace even if the prover's off-chain trace artifact is unavailable. The proof of a dishonest intermediate trace is authenticated during v1 bisection and terminal adjudication; matching final outputs do not bypass that check. Proposer data are revealed only as each game turn requires. A party that withholds a required active-game response loses by timeout. A root that is never challenged does not make its underlying trace data available to anyone.

For the testnet prototype, the operational publication and retention profile is in `trace-integrity-specification.md`: replay-validated artifacts should be mirrored to two independent public locations before claim submission, but neither the archive nor its manifest is a contract precondition. If the challenger cannot retrieve an artifact, it can recompute the reference trace from on-chain values; if a responder cannot produce a required proof after a game opens, existing v1 turn timeouts apply. There is no archive-based grace period. This profile is not an implemented archive service or an on-chain availability guarantee.

The protocol does not guarantee off-chain archive availability, decentralized storage, censorship resistance, or automatic discovery. Indexers, websites, and challenger services are optional aids and are not trusted. Operators should persist program/input/trace data independently and monitor chain events directly.

## 5. Economic, MEV, and resource risks

- The immutable bond sets the cost of a challenge and the reward for refuting a proposal. If too small, rational monitoring may be uneconomic; if too large, honest access is restricted. No universal value is asserted.
- A front-runner can occupy the single active-game slot with a challenge. A failed challenge transfers its bond to the prover; it does not prevent later challenges once the game ends and does not extend the original challenge deadline. A last-moment valid challenge may extend practical finalization until its bounded game resolves.
- Block producers/sequencers may reorder or censor challenge, response, timeout, finalization, or withdrawal transactions. This can cause an honest party to miss a block deadline. The protocol cannot guarantee inclusion.
- Program validation loops over at most 128 instructions. Trace trees have at most 4096 leaves and 12 siblings per inclusion proof. A game has at most 12 bisection levels, 24 child-hash responses, and two terminal witness responses. These bounds do not guarantee a particular gas price or that every EVM deployment will fit its block gas limit; target-chain gas measurements and testing are required before deployment.
- Storing program bytes (at most 512 bytes) and claim/game state incurs storage and calldata costs. Many claims can still consume chain state; v1 defines no global quota, storage rent, or pruning mechanism.
- Solidity defects, incorrect accounting, compiler/toolchain defects, constructor misconfiguration, or an unreviewed dependency can defeat all protocol-level reasoning. Financial operations require adversarial tests, invariant tests, and independent audit before any real-value use.

## 6. Contract and key assumptions

The v1 verifier is non-upgradeable and has no privileged pause, arbitrary recovery, or admin withdrawal path. Deployment parameters are immutable. Plain ETH transfers revert; forced ETH is unallocated surplus. Bond accounting uses `totalLiabilities` and pull credits; withdrawal uses checks-effects-interactions and `ReentrancyGuard`.

Prover/challenger wallets must protect their signing keys. Challenger automation should use an isolated key with only the funds needed for bonds and gas. The protocol does not define a hosted key-management service, wallet recovery, signer rotation, gas sponsorship, or private relay trust model. Never place keys in repository files, client bundles, command logs, or indexer records.

## 7. Non-goals and limitations

V1 does not prevent censorship, chain reorganizations, Sybil identities, false claims that go unchallenged, unavailable off-chain data, frontend deception, validator bugs, or economic griefing beyond the explicit bond rules. It does not provide confidentiality (program/input and claims are public), privacy, a validity proof, execution billing, resource fairness, an insurance pool, or protection against a majority/consensus failure of the target chain.

The protocol is a research specification. It is not an audit, legal/economic review, production deployment, or recommendation to risk funds. Testnet success would not establish production security.

## 8. Claim registry implementation boundary

The initial Phase 5 implementation accepted bonds and finalized after the challenge window using only endpoint proofs; that allowed an invalid intermediate trace, including a fraud trace with the honest final output, to be finalized. Phase 5.5 corrected this by making both public `submitClaim` and `finalize` revert in the base `BisectClaimRegistry`. Phase 6 adds the explicitly dispute-enabled derived `BisectDisputeRegistryV1`, which implements the locked child-hash game and settlement path and is covered by Foundry tests and a local mined Anvil run. The base contract alone remains unusable as a claim service. The derived implementation is unaudited, has not been deployed to Base Sepolia, and should not be treated as production-secure.

The implementation's current zero-fee policy and bond/window values are deployment immutables. Foundry tests use a `1 ETH` bond, a five-block challenge window, and a three-block turn window solely as deterministic fixtures; they are not recommended Base Sepolia economics. The separate Account Ledger addendum remains pending and is not silently inferred by this contract.
