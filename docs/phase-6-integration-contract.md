# Phase 6 integration contract

This records the integration boundary for the implemented v1 dispute registry. It follows the locked v1 state machine and Phase 5 accounting base. No account-ledger addendum exists; this document does not define a database ledger or wallet custody.

## 1. Deployment and trust boundary

`BisectDisputeRegistryV1` is a fresh, non-upgradeable contract derived from `BisectClaimRegistry`. Claim storage, active-game storage, bond accounting, and withdrawals live in the same contract. There is no independently trusted settlement contract, privileged winner setter, owner withdrawal, upgrade path, or readiness toggle. The inherited Phase 5 public `submitClaim` and `finalize` fail closed; the derived contract explicitly overrides them.

The integrated contract is the sole financial authority. TypeScript clients, the indexer, PostgreSQL, and challenger services may prepare data but cannot select a winner or alter a balance. Solidity must use the existing `BisectVerifier` and exact VM v1 / encoding v1 semantics.

## 2. Public operations

The following behavior is required by `dispute-state-machine.md`; Solidity may use equivalent struct encoding while preserving all validation and state changes.

| Operation                                                        | Caller/value                          | Required behavior                                                                                                                                                                        |
| ---------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `submitClaim(submission)`                                        | Any prover; exactly `B` wei           | Override the base revert and call `_submitClaim` only after the integration is complete. Authenticate canonical initial and halted terminal proofs as the base helper does.              |
| `challenge(claimId, challengerRoot, initialProof) -> gameNumber` | Non-prover; exactly `B` wei           | Require `OPEN`, `block.number <= challengeDeadline`, a distinct root, exact canonical initial state/proof for stored context, and no active game. Lock challenger bond and start a game. |
| `revealChildren(claimId, gameNumber, leftHash, rightHash)`       | Exact expected responder; no value    | Authenticate ordered children against that party's current parent. Prover responds first at each level; challenger responds second.                                                      |
| `revealTerminal(claimId, gameNumber, transitionProof)`           | Expected terminal responder; no value | Challenger reveals first; prover second. Authenticate both indexed states against the party's own root and selected leaf. Verify only the proposer's transition.                         |
| `claimTimeout(claimId, gameNumber)`                              | Permissionless; no value              | After `block.number > deadlineBlock`, apply the locked timeout result for the party that failed to respond.                                                                              |
| `finalize(claimId)`                                              | Permissionless; no value              | Override the base fail-closed method. Require `OPEN`, original deadline passed, proposer bond locked, and **no active game** before `_finalizeClaimAfterDisputeResolution`.              |
| `withdraw()`                                                     | Credit owner; no value                | Preserve inherited caller-only pull withdrawal, checks-effects-interactions, and reentrancy protection.                                                                                  |

The v1 dispute specification stores a monotonically increasing `gameNumber` per claim. Every game-specific write includes and checks the currently active game number. ADR-0013 records this ABI replay fence; it does not change any locked v1 state transition, proof, deadline, or settlement rule.

## 3. Stored state and cross-field invariants

Each claim retains the existing immutable program, input, transition count `N`, trace root, output, hashes, prover, deadline, and proposer-bond lock. A game record must bind:

- Claim ID and monotonically increasing game number.
- Challenger address and root; proposer root comes from the immutable claim.
- Active game status and exact challenger-bond lock.
- Current subtree base index, height, and both parties' current subtree hashes.
- The first responder's ordered pending child pair, expected responder, and turn deadline.
- Terminal differing index and selected leaf hashes when height reaches zero.
- Challenger predecessor/successor states after the challenger terminal response.
- A one-time settlement/closed marker so no game bond can be credited twice.

Cross-field invariants:

1. `GAME_ACTIVE` iff exactly one game is active for that claim and its challenger bond is included in `totalLockedBonds`.
2. A claim's proposer bond remains locked until `FINALIZED` or `REFUTED`.
3. No terminal result or timeout can be settled twice; closed games reject all writes.
4. A failed/reverted operation changes neither game state nor aggregate accounting.
5. Every accepted payable operation accounts for exactly `B` wei only after all admission checks pass; any revert returns the attached value atomically.
6. `totalLiabilities == totalLockedBonds + totalCredits`, and contract balance is at least total liabilities after every successful operation.

## 4. Bisection algorithm

The accepted trace has `N+1` leaves, a power of two. Let `H = log2(N+1)`, `baseIndex=0`, `height=H`, and both current nodes initially be the claim and challenger roots. The canonical initial-state proofs make index zero a common low boundary. The two roots must differ.

At every level, require the exact expected responder and `block.number <= deadlineBlock`. That responder supplies ordered `(left,right)` child hashes and must satisfy `nodeHash(left,right) == itsCurrentNode`. The prover supplies its pair first; the challenger supplies its pair second. Once both are recorded:

```text
if proverLeft != challengerLeft:
    choose left children
    keep baseIndex
else:
    require proverRight != challengerRight
    choose right children
    baseIndex += 2^(height - 1)
height -= 1
```

Replace each party's current node with the selected child, clear pending pairs, and start a fresh prover turn unless `height == 0`. Since left is always chosen whenever it differs, this isolates the smallest differing leaf index `k`. Equal left-subtree hashes preserve a common low state boundary; no sorted-pair hashing is permitted.

## 5. Terminal adjudication and outcomes

At `height == 0`, `k=baseIndex` must be greater than zero because index zero was authenticated equal. The terminal states are implicitly at indices `k-1` and `k`; each proof has exactly the depth implied by `N` and is verified with the stored execution context.

1. Challenger reveals both states first; authenticate them to `challengerRoot`, and require its state at `k` hashes to the selected challenger leaf.
2. Prover reveals both states second; authenticate them to the proposer root, and require its state at `k` hashes to the selected prover leaf.
3. If authenticated predecessor states differ, or distinct selected leaves authenticate to equal next states, apply the specified terminal commitment-inconsistency result: challenger wins and claim becomes `REFUTED`.
4. Otherwise execute exactly one transition of the stored program from the common predecessor. If there is no valid successor or the computed successor differs field-for-field from the prover's state at `k`, challenger wins and claim becomes `REFUTED`; credit both locked bonds (`2B`) to challenger pull credit.
5. If the prover's transition is valid, challenger loses; credit its `B` bond to prover, keep prover's `B` locked, and return claim to `OPEN`.

The challenger successor is authenticated but need not be a valid VM successor. A challenger wins only by proving a prover fault or prover timeout. An invalid challenge cannot slash a valid proposer.

The fraud vector in `contracts/test/vectors/claim-registry-v1.json` is a required cross-language test: state index 1 is altered, making the first transition invalid, while a later `MOVI 42` yields the same halted output as the honest execution. A terminal-output-only check would miss it; bisection and the one-step verifier must reject the proposer trace.

## 6. Deadlines, retries, and claim finality

- Challenge entry is inclusive: `block.number <= challengeDeadline`.
- A responder may act at exact `deadlineBlock`; timeout is permissionless only when `block.number > deadlineBlock`.
- Every successful response sets the next turn deadline to `block.number + turnWindowBlocks` with checked arithmetic.
- A challenger timeout credits challenger `B` to prover, keeps proposer bond locked, closes the game, and returns claim to `OPEN`.
- A prover timeout credits `2B` to challenger, closes the game, and sets claim to `REFUTED`.
- A valid prover transition has the same economic result as challenger timeout.
- A losing challenge does not extend the original challenge deadline. Another challenge may begin if the original deadline has not passed.
- An active game may continue after the original challenge deadline. Finalization waits for it to close. A returned `OPEN` claim may then finalize immediately if its original deadline has passed.
- A successful prover-fault proof refutes the claim immediately; it is never finalizable.

These are locked semantics from `dispute-state-machine.md`; implementation convenience is not grounds to change them.

## 7. Events and client-facing observability

The implementation preserves `ClaimSubmitted`, `ClaimFinalized`, and `Withdrawal` and emits `ChallengeStarted`, `DisputeChildrenRevealed`, `BisectionLevelResolved`, `TerminalEvidenceRevealed`, `GameResolved`, `GameTimedOut`, and `GameBondCredited`. These events carry claim/game identity, participants, roots or selected index, responder/deadline, outcome, and exact credit movements. Both accepted terminal responses emit evidence hashes. The Foundry and mined-Anvil tests decode these events and compare them with the closed game, claim state, credits, and withdrawal. Events do not carry full traces, proof paths, or private key material; contract storage remains authoritative and event consumers must handle reorgs.

Events are not an alternate accounting ledger. On-chain mappings and aggregate liabilities remain authoritative; off-chain consumers must handle chain reorgs.

## 8. Account Ledger boundary

The Account Ledger addendum was confirmed as not yet authored. This phase design therefore defines only protocol bonds, credits, and authoritative Solidity events/reads. It does not specify wallet custody, hosted signers, database double-entry accounting, indexing reconciliation rules, or user withdrawal UX. Those topics require their separately authorized addendum before financial-ledger implementation.

## 9. Phase 6 implementation status

The contract and generated ABI are in `contracts/src/BisectDisputeRegistryV1.sol` and `packages/sdk/src/abis/bisectDisputeRegistryV1.ts`. TypeScript generates `contracts/test/vectors/dispute-v1.json`; Foundry consumes it for state-machine tests. `packages/sdk/scripts/phase6-anvil.mts` runs the complete game with two unlocked local Anvil accounts and mined transactions. Exact verification results and remaining limitations are recorded in `docs/phase-6-report.md`. No Base Sepolia deployment or independent audit is claimed.
