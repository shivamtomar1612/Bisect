# Phase 6 security checklist

Use this checklist as a release gate for the dispute-enabled claim registry. An unchecked item means the integrated contract is not ready to accept bonds. This is a test/review checklist, not an audit certificate.

## Before enabling admission

- [ ] Review every externally callable function, mutability, payable value, caller role, status precondition, and revert behavior.
- [ ] Derive program, input, execution context, proof depth, and all versions from stored/canonical values; never trust arbitrary context metadata.
- [ ] Preserve exact VM v1 validation, current-PC-relative `JNZ`, modulo-`2^64` arithmetic, halted stuttering, state encoding, Keccak domains, and ordered Merkle proofs.
- [ ] Require a different challenger root, the exact bond, the stored claim context, and a canonical initial-state proof before accepting challenger funds.
- [ ] Test all four trace budgets and exact proof depths; reject truncated/extended proofs, wrong indices, swapped siblings, wrong roots, contexts, programs, inputs, or budgets.
- [ ] Enforce one active game per claim and monotonically distinguish retries. Stale calls from a closed/prior game cannot mutate current game state.
- [ ] Preserve both the common low boundary and disputed high boundary through every bisection level. Descend left whenever left children differ; otherwise require right children differ and descend right.
- [ ] At terminal reveal, authenticate both adjacent states for both roots at indices `k-1,k`; require common predecessor and verify the prover's unique successor field-for-field.
- [ ] Include the same-output fraudulent-intermediate regression vector. Confirm the honest trace and malicious trace share terminal state/output while roots differ and the first transition is invalid.
- [ ] Confirm arbitrary challenger successor data cannot refute a valid prover transition.

## Deadlines and state transitions

- [ ] Challenge is accepted through the inclusive challenge deadline; no new challenge is accepted after it.
- [ ] A response is accepted at exact turn deadline; timeout only after the deadline.
- [ ] Successful responses update the responder/deadline exactly once; reverts do not consume or extend turns.
- [ ] Prover always responds first in bisection levels; challenger responds first at terminal reveal.
- [ ] Challenger timeout/valid prover transition: credit only challenger bond to prover, keep proposer bond locked, return claim to `OPEN`.
- [ ] Prover timeout/invalid transition/terminal inconsistency: credit exactly both bonds to challenger, unlock once, and mark `REFUTED`.
- [ ] Retry uses the original unextended challenge deadline. Games may complete after it; finalization cannot proceed while any game is active.
- [ ] Finalization requires `OPEN`, expired original deadline, proposer bond locked, and no active game. Repeated finalization fails.
- [ ] Challenge-game identity, terminal resolution, timeout, claim status, bond locks, and credit movement change atomically.

## Financial invariants

- [ ] Every incoming bond is exactly `bondWei`, and no failed call retains attached ETH.
- [ ] Each proposer/challenger bond is associated with exactly one claim/game lock.
- [ ] Every lock has exactly one terminal path; no bond can be credited twice or silently omitted.
- [ ] `totalLiabilities == totalLockedBonds + totalCredits` after every successful operation.
- [ ] `address(this).balance >= totalLiabilities` holds under forced ETH and arbitrary valid operation sequences.
- [ ] All settlement changes are contract-state-derived; no owner, relayer, indexer, database, or caller-selected winner can assign credit.
- [ ] Withdrawals remain caller-only, pull-based, checks-effects-interactions, nonreentrant, and failure-atomic.
- [ ] Failed recipient, reentrancy, repeated withdrawal, unauthorized settlement, duplicate challenge, and double-finalization tests pass.
- [ ] Foundry invariant tests cover multi-claim/multi-game sequences, concurrent credits, timeouts, retries, and forced surplus ETH.

## Required verification evidence

- [ ] Foundry build and all deterministic tests pass with pinned compiler and dependency versions.
- [ ] Fuzz tests cover state-machine transitions, timeout boundaries, proof indices, arithmetic, and malformed calldata.
- [ ] Invariant tests execute with documented run/depth values and no unexplained invariant or handler failures.
- [ ] TypeScript-generated vectors verify in Solidity for every opcode, boundaries, fraud fixture, roots, state bytes, and hashes.
- [ ] `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm e2e`, `forge fmt --check`, `forge build`, and `forge test` pass.
- [ ] Gas measurements are from actual local EVM executions and reported with compiler, optimizer, call inputs, and environment; do not call them Base Sepolia measurements.
- [ ] Fresh deployment constructor values, chain ID, verification source, ABI, event naming, and RPC/finality policy are reviewed before any testnet deployment.
- [ ] Independent security review is complete before any meaningful value is at risk. Testnet success is not audit evidence.

## Operational and availability assumptions

- [ ] Provers/challengers can archive full traces and proof material; contract roots do not make trace data available.
- [ ] Independent challengers monitor the entire challenge period, can submit transactions, and have enough isolated testnet ETH for bonds and gas.
- [ ] Turn/challenge windows are justified against realistic trace computation, RPC reliability, chain inclusion, and finality.
- [ ] Indexers are rebuildable and non-authoritative; event consumers handle reorgs and duplicate delivery.
- [ ] No private keys, mnemonics, RPC secrets, or credentials enter the repository, logs, contract, or client bundle.
- [ ] The Account Ledger addendum remains a separate prerequisite for any database financial journal, custody, or wallet product work.
