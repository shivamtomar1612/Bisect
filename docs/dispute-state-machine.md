# BISECT v1 dispute state machine

**Status: locked for protocol v1.** This document normatively defines calls, phases, deadlines, bisection, terminal adjudication, retries, and bond settlement. All currency is native ETH in integer wei. VM and hash definitions are in `vm-spec.md` and `encoding-spec.md`.

## 1. Immutable deployment parameters

The non-upgradeable verifier constructor is `constructor(uint96 bondWei, uint32 challengeWindowBlocks, uint32 turnWindowBlocks)` and fixes `bondWei` (`1..2^96-1`), `challengeWindowBlocks` (`1..1,000,000`), and `turnWindowBlocks` (`1..100,000`). All are immutable. Deadline values are stored as `uint256`; deadline addition uses checked arithmetic and overflow reverts. A deployment must publish these values. Each deposit must equal `bondWei` exactly; underpayment, overpayment, and zero value revert.

Let `B=bondWei`. `H=log2(N+1)` and is one of `6,8,10,12`. There is one active game per claim, but a claim can have successive games until its original challenge deadline. A failed challenge never extends that deadline.

## 2. Claim phases and stored state

Only `submitClaim` and `challenge` are payable, and each requires its exact bond. `revealChildren`, `revealTerminal`, `claimTimeout`, `finalize`, and `withdraw` are nonpayable and reject attached value. Plain ETH transfers and unknown selectors revert. ETH forced into the contract by EVM mechanisms is accepted as unaccounted surplus and never credited to a user.

The first claim ID is `1`; each successful submission uses the current `nextClaimId`, then increments it by one with checked arithmetic. Each monotonically assigned `claimId` has one status:

- `OPEN`: proposer bond is locked and no game is active. The challenge deadline may be in the future or may have passed while a game was active.
- `GAME_ACTIVE`: proposer and one challenger each have `B` locked in the active game.
- `FINALIZED`: no game is active and the challenge deadline passed; proposer bond became proposer credit.
- `REFUTED`: a terminal proof showed the proposal invalid, a terminal consistency fault occurred, or the prover timed out; both active bonds became challenger credit.

Claim data are immutable after submission: prover address, exact program bytes, eight public input values, `N`, `traceRoot`, claimed output, program/input/context hashes, and `challengeDeadline`. The proposer bond remains locked until finalization or refutation. The verifier stores a `uint256 gameNumber` per claim initialized to zero; the first successful challenge increments it to one. It also stores one active game's challenger address/root, current two subtree hashes, current subtree index base/height, pending first party's child pair, terminal selected leaf hashes/index when reached, current responder, `deadlineBlock`, and (after the challenger terminal turn) its two states. At game close, clear all active-game fields; the next successful challenge increments `gameNumber` and initializes a fresh game from the claim roots.

## 3. External operations

The API names below are normative behavior; Solidity may choose equivalent ABI struct syntax without changing the required fields or validation.

### 3.1 `submitClaim(program, input[8], N, traceRoot, claimedOutput, initialProof, finalProof)`

Preconditions: exact `B`; `N` is one of the four allowed transition counts; program passes all v1 static validation; proof sibling count is exactly `H`; verifier is non-upgradeable v1.

The verifier computes versioned hashes/context and checks:

1. `initialProof` at index 0 reconstructs `traceRoot` and proves exactly `{pc:0, halted:false, registers:input}`.
2. `finalProof` at index `N` reconstructs the same `traceRoot` and proves `halted=true` and `registers[0]=claimedOutput`.

On success, store the claim and exact program bytes, lock `B`, set `challengeDeadline=block.number+challengeWindowBlocks`, set status `OPEN`, emit `ClaimSubmitted`, and return the new ID. `totalCredits` and `totalLiabilities` are zero at deployment; this deposit increases total liabilities by `B`. All failed checks revert atomically and lock no ETH.

### 3.2 `challenge(claimId, challengerRoot, initialState, initialProof) -> gameNumber`

Preconditions: claim status `OPEN`; `block.number <= challengeDeadline`; caller is not the prover; exact `B`; `challengerRoot != traceRoot`; initial proof has exactly `H` siblings and proves at index 0 the exact canonical initial state under the claim's context.

No challenger final-state or output claim is required. The challenger root commits to `N+1` context-bound leaves by the fixed tree shape. Only the on-chain revealed paths are needed for adjudication. On success, lock challenger `B`, allocate the next monotonically increasing per-claim `gameNumber`, set status `GAME_ACTIVE`, active root to `challengerRoot`, `height=H`, `baseIndex=0`, prover/challenger current nodes to their roots, expected responder to the prover, and `deadlineBlock=block.number+turnWindowBlocks`; emit `ChallengeStarted` and return `gameNumber`.

An arbitrary challenger tree that has a valid initial proof is permitted. It cannot win against a valid proposer under the hash and VM assumptions: the first differing transition will validate for the proposer. Failed challenges transfer their bond to the prover and do not finalize/refute the claim. This allows a later honest challenger to retry.

### 3.3 `revealChildren(claimId, gameNumber, leftHash, rightHash)`

Preconditions: status `GAME_ACTIVE`; phase is bisection; caller is the exact expected responder; `block.number <= deadlineBlock`.

Let `parent` be that party's current subtree hash. Require `nodeHash(leftHash,rightHash)==parent`; otherwise revert without consuming the turn. Store that party's ordered child hashes. The prover always reveals first at each level, the challenger second.

- After the first party succeeds: change expected responder to the other party and set `deadlineBlock=block.number+turnWindowBlocks`.
- After the second party succeeds, their child pairs are both known. If prover-left differs from challenger-left, select the left children. Otherwise select the right children. At least one pair MUST differ because the parent hashes differ; if neither differs, revert `NO_DIFFERING_CHILD` without changing the state.
- On selecting left, keep `baseIndex`. On selecting right, set `baseIndex += 2^(height-1)`. Set each current node to its selected child and decrement `height`.
- Clear the pending child-pair slot. If new `height>0`, expect the prover and set a fresh turn deadline. If new `height=0`, set `differentIndex=baseIndex`, retain both distinct selected leaf hashes, enter terminal phase, expect the challenger, and set a fresh turn deadline.

Because left is always chosen when it differs, this process isolates the **smallest** differing state index. The initial state proofs ensure the result is at least one.

### 3.4 `revealTerminal(claimId, gameNumber, transitionProof)`

Preconditions: claim status `GAME_ACTIVE`; phase is terminal; caller is the exact expected responder; `block.number <= deadlineBlock`. Both state indexes are implicit: `differentIndex-1` and `differentIndex`. Proof arrays must each have exactly `H` siblings.

1. The challenger responds first. Its proofs must authenticate both states to `challengerRoot` under the claim context. Its `nextState` leaf hash at `differentIndex` must equal the challenger leaf hash selected by bisection. Store the challenger previous/next states, then expect the prover and reset the turn deadline.
2. The prover responds second. Its proofs must authenticate both states to the proposal root. Its `nextState` leaf hash at `differentIndex` must equal the prover leaf selected by bisection.
3. If the two authenticated previous states differ, or if the two authenticated next states are equal despite distinct selected leaf hashes, classify this as `TERMINAL_COMMITMENT_INCONSISTENCY`: the challenger wins and the claim becomes `REFUTED`. This branch is unreachable if the Merkle/hash assumptions and bisection implementation hold.
4. Otherwise compute `expected = step(program, previousState)` under VM v1. If no successor exists, or `expected != proverNextState` field-for-field, the proposal is invalid: challenger wins and claim becomes `REFUTED`. Otherwise the proposal's transition is valid: prover wins this game, challenger loses, and the claim returns to `OPEN`.

The verifier does not require the challenger's next state to be a valid successor. The challenger wins only by proving a proposal fault (or prover timeout), so a dishonest challenger cannot slash a valid proposal merely by committing to malformed trace data.

Any malformed proof, unexpected index, wrong root, wrong leaf hash, wrong caller, or late response reverts without changing state. The respondent may retry until its deadline. A reverted transaction does not extend the deadline.

### 3.5 `claimTimeout(claimId, gameNumber)`

Permissionless. Preconditions: claim `GAME_ACTIVE` and `block.number > deadlineBlock`.

- If the expected responder is the challenger, challenger times out: credit challenger bond `B` to the prover; unlock no proposer bond; clear game; set claim `OPEN`.
- If the expected responder is the prover, prover times out: credit both bonds `2B` to the challenger; clear locks; set claim `REFUTED`.

The caller receives no reward. Exact deadline equality is still timely for the expected responder; timeout is only valid in a later block.

### 3.6 `finalize(claimId)`

Permissionless. Preconditions: claim `OPEN` and `block.number > challengeDeadline`. Credit the locked proposer `B` to the prover and set `FINALIZED`. If a game is active, finalization reverts. A game can continue after the challenge deadline; if the prover wins, the returned claim can be finalized immediately. If the challenger wins, the claim is already `REFUTED`.

There is no cancel or claim-edit operation. A claim with no successful challenge remains `OPEN` after the deadline until anyone calls `finalize`; the proposer bond is locked until then.

### 3.7 `withdraw()`

Caller withdraws only its entire own credit to `msg.sender`. If zero, revert. Under `nonReentrant`, effects happen first: set caller credit to zero and decrement total credits/liabilities, then send exact wei. If the call fails, the transaction reverts and restores accounting. There are no arbitrary-recipient withdrawals and no admin withdrawal path.

## 4. Exact settlement table

`B` is the exact bond per party. No fees or rounding apply.

| Result                                       |          Prover locked bond | Challenger locked bond | Claim result |
| -------------------------------------------- | --------------------------: | ---------------------: | ------------ |
| Challenge window expires with no active game |      `B` credited to prover |                   none | `FINALIZED`  |
| Terminal proof: prover transition valid      |              remains locked | `B` credited to prover | `OPEN`       |
| Challenger times out at any response         |              remains locked | `B` credited to prover | `OPEN`       |
| Terminal proof: prover transition invalid    | `2B` credited to challenger |         included above | `REFUTED`    |
| Terminal commitment inconsistency            | `2B` credited to challenger |         included above | `REFUTED`    |
| Prover times out at any response             | `2B` credited to challenger |         included above | `REFUTED`    |

In the first three rows, a later challenge may still occur if `block.number <= challengeDeadline`; after that deadline the claim can be finalized. Earlier failed challengers' credits do not affect the locked proposer bond. Credit changes are pull-payment liabilities, not immediate ETH transfers.

## 5. Accounting invariant

The verifier tracks `totalCredits` and `totalLiabilities`. Every deposit increases liabilities by its exact value. Moving a locked bond into a credit changes the composition of liabilities but not `totalLiabilities`. A withdrawal decreases liabilities and contract ETH by the same amount. After each successful operation:

```text
totalLiabilities = all locked proposer bonds
                 + all locked active challenger bonds
                 + totalCredits
address(this).balance >= totalLiabilities
```

Direct plain ETH transfers revert. Forced ETH is unaccounted surplus: it changes neither credits nor liabilities. No settlement loops over claimants or games; loops are limited to at most 128 program instructions or 12 proof siblings/tree levels.

## 6. Events and replay rules

The implementation MUST emit enough indexed events to reconstruct claim/game status without making an indexer authoritative. The v1 registry emits `ClaimSubmitted`, `ChallengeStarted`, `DisputeChildrenRevealed`, `BisectionLevelResolved`, `TerminalEvidenceRevealed`, `GameResolved`, `GameTimedOut`, `GameBondCredited`, `ClaimFinalized`, and `Withdrawal`. The two terminal-evidence events identify each responder, the selected index, predecessor state hash, and selected successor leaf hash; `GameResolved` records the exact winner, outcome, claim status, and credit movement. Events MUST NOT include private key material. Contract storage/views remain authoritative.

Claim IDs are monotonic and never reused. Finalized and refuted claims are terminal. A closed game cannot be replayed; every mutating game call includes its `gameNumber`, which is checked against the active game before processing. This is an ABI replay fence only: it does not alter any v1 proof, turn, deadline, bisection, or settlement rule. A new game has a new counter within that claim and fresh turn data but the same fixed claim context/deadline. Only one game is active at a time.
