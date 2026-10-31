# Phase 7 adversarial security test report

**Result: PASS for the Phase 7 local test gate.** The audited protocol and production Solidity contracts were preserved. Phase 7 adds adversarial vectors, Foundry fuzz coverage, a stateful invariant handler for the operative dispute registry, and regressions for accounting edge cases. No production contract defect was confirmed, so no production contract logic changed. This is test evidence, not an independent audit or a production-security claim.

## Scope reviewed

- `contracts/src/BisectVerifier.sol`: canonical v1 validation, transition execution, state/context hashes, and ordered Merkle inclusion verification.
- `contracts/src/BisectClaimRegistry.sol` and `contracts/src/BisectDisputeRegistryV1.sol`: claim admission, challenge turns, leftmost-difference bisection, deadlines, exact bond settlement, pull credits, and withdrawals.
- `packages/vm`, `packages/merkle`, and `packages/sdk`: deterministic execution and the TypeScript-generated proof inputs consumed by Solidity tests.
- Existing VM, Merkle, claim, dispute, verifier, and local Anvil tests.

The production dispute rules remain locked v1 child-subtree bisection. The new Solidity tests compare exact commitment pairs and do not add midpoint-state semantics.

## Adversarial coverage added

| Area                                      | Coverage and evidence                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Authenticated state and Merkle paths      | Solidity rejects changed predecessor/successor state bytes, changed sibling values, reversed siblings, a changed root, a changed state index, wrong program/input/budget context, and a truncated path. TypeScript runs 48 deterministic seeded traces and checks valid proofs plus state, index, sibling-order, and input tampering.                                                                                                      |
| VM transition parity                      | Solidity fuzz tests cover uint64 add/subtract/multiply wrapping, JNZ conditions, and the full signed `int16` offset range. Invalid targets are checked against both static program-validation and dynamic transition classifications. Existing vectors cover every opcode and the TypeScript-generated ABI/hash encodings.                                                                                                                 |
| Intermediate fraud with matching output   | TypeScript generates same-context roots with one altered internal state at indices `1, 2, 3, 7, 8, 15, 16, 31, 32, 47, 62, 63`. The claimed and authenticated final output remains `42`. For each index, Foundry submits the false trace as prover, runs the ordered child-hash game, authenticates both terminal transitions, and verifies `PROVER_TRANSITION_INVALID`, `REFUTED`, and the exact `2 * bond` challenger credit.            |
| Interval selection and challenger honesty | The twelve generated positions cover both sides of each tested power-of-two boundary and the first/last noninitial states. A two-claim test keeps two games open simultaneously and verifies their bond exposure remains separate. Existing tests also show an alternate challenger trace cannot slash a valid proposer.                                                                                                                   |
| Dispute lifecycle                         | Existing tests cover honest and dishonest participants, invalid initial/terminal witnesses, out-of-turn calls, exact deadline inclusion, stale game IDs, retries, premature/repeated resolution, both timeout outcomes, and active-game finalization fences. The new stateful handler exercises opening, complete bisection, terminal resolution, timeout, finalization, withdrawals, and repeated closed-game attempts across two claims. |
| Escrow and exact wei                      | Tests cover wrong bond values, simultaneous obligations, exact winner credits, successful and repeated withdrawals, a reverting receiver, callback reentrancy against the production derived registry, unknown-claim challenge/timeout calls, and forced ETH. Forced ETH increases surplus only; it creates no credit or liability.                                                                                                        |

The generated interval fixtures are written to `contracts/test/vectors/security-v1.json` by `scripts/generate-phase7-security-vectors.mts`. Solidity consumes those TypeScript VM/Merkle outputs directly; the fixture is regenerated by `pnpm security:vectors` before Foundry tests.

## Stateful accounting invariant

`Phase7DisputeInvariantTest` deploys the operative `BisectDisputeRegistryV1`, submits two independently owned claims, and targets a handler whose fuzz actions act through funded prover/challenger contracts. The invariant checks after each sequence that:

1. `totalLockedBonds` equals the sum of locked proposer bonds and the active games' challenger bonds.
2. `totalLiabilities == totalLockedBonds + totalCredits` and the registry balance covers liabilities.
3. Every credit belongs to one of the two provers or the challenger in the harness; credits plus observed successful withdrawals equal the exact payouts implied by each claim/game outcome.
4. Each claim's rewards go to its own prover; challenger rewards go only to that dispute's challenger.
5. A closed game stays settled and cannot become active again. The handler permits at most one game per claim in this invariant campaign; retry behavior remains covered by a dedicated unit test.

The acceptance run used **32 invariant runs × 80 calls = 2,560 randomized handler calls**, with zero reverts and zero invariant failures. The existing base-registry accounting invariant also passed at the same run/depth settings. This bounded campaign is reproducible using the PowerShell environment settings recorded in `phase-7-acceptance.md`.

## Actual verification results

The final full command was `pnpm check:phase7`, run with `FOUNDRY_INVARIANT_RUNS=32` and `FOUNDRY_INVARIANT_DEPTH=80` in the PowerShell process.

- Biome lint — passed; 82 existing informational suggestions, no errors.
- Biome format check — passed across 118 files.
- TypeScript typecheck — passed for all seven workspace packages with typecheck scripts.
- Vitest — **42 tests passed across 5 files**.
- VM, Merkle, SDK, and Next.js production builds — passed.
- Foundry build — passed using Foundry **1.8.7** and Solidity **0.8.30**.
- Foundry — **55 tests passed across 7 suites**, including all 16 Phase 7 adversarial tests, all existing verifier/registry tests, and both accounting invariants. No Foundry fuzz seed failed. The verifier's fuzz tests each ran 256 cases for arithmetic wrapping, bounded JNZ offsets, full signed offsets, and mutated authenticated states.
- Local Anvil end-to-end flow — passed on chain ID `31337`: 21 mined transactions; six rounds; mismatch index 1; outcome `PROVER_TRANSITION_INVALID`; 2 ETH credited to the challenger; accounting remained solvent. The separately withheld-response scenario timed out the prover and credited 2 ETH. These are local test-ETH observations, not public-testnet measurements.
- `forge fmt` — passed after formatting the Solidity additions.

No protocol counterexample or failing fuzz seed remains. During test construction, twelve interval cases initially revealed child pairs in the wrong party order and correctly reverted with `InvalidChildCommitment`; the vector consumer was corrected to pair each root with its own children. This was a test-fixture orientation error, not a contract defect. A separate initial aggregate run stopped on an import-sort lint diagnostic; the generator was formatted and the complete gate then passed.

## Limits and assumptions

These tests cannot prove Keccak collision resistance, correctness of the EVM/compiler/toolchain, absence of all Solidity bugs, economic viability, or the completeness of all possible adversarial call sequences. The protocol still assumes an honest challenger can discover claims, reconstruct the reference trace, fund bonds and gas, and have transactions included before the block deadlines. It does not guarantee trace archive availability, RPC access, censorship resistance, chain liveness, reorganization/finality, or sequencer/validator security. An unchallenged false trace may finalize after its challenge window. Deployment bond and block-window values are immutable choices and have not been justified for Base Sepolia.

The contracts and protocol remain unaudited. No Base Sepolia deployment, trace archive service, automatic challenger, or production monitoring is established by this report.
