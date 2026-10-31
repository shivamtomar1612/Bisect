# Phase 6A verification report

**Result: PASS for locked-v1 trace-integrity behavior and local verification.** The Phase 6 contract already authenticated the leftmost differing trace state and verified the prover's adjacent transition. Phase 6A documented that behavior, made same-output fraud coverage explicit, added output-mismatch and withheld-response regressions, and extended the mined Anvil demonstration. No Solidity state transition, bisection rule, timeout, or bond outcome changed.

## Protocol and data-availability findings

- Matching the claimed final output does not prove intermediate trace validity. Claim admission checks the initial state and halted final state/output; an altered intermediate state changes the context-bound ordered root and remains challengeable.
- Locked v1 challenge admission takes a different context-bound root and the canonical index-zero proof. It does not accept a caller-selected midpoint or mismatch index. The child-hash game authenticates the leftmost mismatch before terminal state proofs and one-step verification.
- The claim stores the program, public input, budget, root, and output. A challenger can reconstruct the canonical trace without downloading the proposer's trace artifact. The SDK trace creator executes the actual deterministic VM and generates context-specific roots/proofs.
- The contract does not execute every challenger transition at challenge opening. An honest challenger supplies a valid trace from the same on-chain context; an arbitrary different root cannot slash a valid proposer through terminal proof because the contract checks the proposer's unique successor. The challenger risks its exact bond and a valid proposer is credited that bond when its transition is valid.
- A root contains hashes and provides no availability. The testnet prototype publication, two-location retrieval, replay validation, and retention policy is specified in `trace-integrity-specification.md`; no archive service or manifest monitor exists in this repository.
- A prover that withholds a required response after a game opens can be timed out after the strict v1 deadline. A challenger that withholds a response loses its bond to the prover. There is no archive-based grace period. An unchallenged invalid claim can finalize if no honest challenge is included before the challenge deadline.

## Regression coverage

The Foundry dispute suite now includes explicit assertions for a fraudulent intermediate state with the correct final output, an alternate root with a different final output that loses against a valid proposer, a forged initial membership path, and a prover that withholds its first required response. It checks exact-deadline behavior, refutation/credit amounts, repeat-settlement rejection, and escrow solvency. Existing tests reject terminal proofs using wrong program, input, budget, root, state index, or siblings. There are no midpoint-state proofs in v1; the relevant wrong-context terminal proof cases are tested.

The same-output fraud vector remains TypeScript-generated from the real VM/Merkle packages. The different-output challenger vector changes only the final committed state and is also generated from canonical encoding and ordered tree functions.

## Verification results

- `pnpm check:phase6` — **passed, exit 0**. This ran Biome lint and formatting, all seven workspace typechecks, 41 Vitest tests, VM/Merkle/SDK/Next.js builds, Next.js production build, Foundry build, vector regeneration, all Foundry suites, and the expanded mined Anvil flow.
- Foundry — **36 tests passed** across five suites: 10 dispute registry, 8 verifier, 16 claim registry, 1 OpenZeppelin smoke, and 1 accounting invariant. The invariant ran 256 cases and 128,000 handler calls with zero reverts or invariant failures. The verifier's two fuzz tests each ran 256 cases.
- `pnpm phase6:anvil` — passed on a fresh local chain (chain ID `31337`) with 21 successful mined transactions and real Anvil test ETH.

## Mined Anvil outcomes

The first claim commits to a false state at index 1 while retaining the honest final output `42`. The challenger independently computes the valid trace under the same program/input/budget. Ordered bisection takes six rounds; the terminal verifier refutes the claim and credits the challenger both bonds. The challenger withdraws the credit successfully.

The same run submits a second fraudulent intermediate trace at a distinct budget. The prover supplies no first child response. After mining beyond the inclusive turn deadline, the challenger submits `claimTimeout`; the game records `PROVER_TIMEOUT` and credits both bonds. This credit remains pull-based in the contract, so the final registry state has zero locked bonds and exactly `2 ETH` in credits/liabilities and contract balance.

| Measurement                                                   |            Observed result |
| ------------------------------------------------------------- | -------------------------: |
| Proof-based mismatch rounds / state index                     |                      6 / 1 |
| Successful mined transactions                                 |                         21 |
| Total receipt gas                                             |                  7,208,817 |
| Total execution fees                                          | 12,598,258,770,680,943 wei |
| Proof-based terminal resolution gas                           |                    199,088 |
| First game's withdrawal gas                                   |                     40,198 |
| Withheld-response timeout gas                                 |                     98,310 |
| First-game challenger credit, withdrawn                       |                      2 ETH |
| Withheld-game challenger credit                               |                      2 ETH |
| Final locked bonds / credits / liabilities / registry balance |  0 / 2 ETH / 2 ETH / 2 ETH |
| Final accounting invariant                                    |                       true |

Measurements are from local mined receipts and Anvil state reads, not Base Sepolia. Transaction fees vary between local runs because effective gas prices vary.

## Remaining assumptions and risks

- Data archives, a public claim-to-artifact manifest, retrieval monitoring, and retention automation are operational requirements only; they are not implemented or enforced on chain.
- An honest challenger must be able to read the claim context, recompute the bounded trace, fund the bond/gas, monitor deadlines, and get each transaction included. RPC outage, censorship, block liveness, or reorganization can still cause failure or a timeout.
- Because the challenge deadline is finite, a false claim can finalize if no valid challenge reaches the chain in time. The v1 protocol provides no independent data-availability committee or challenge extension.
- The prototype retention assumption is two independent public copies until terminal finality plus at least 30 days. The deployment must define its finality policy and verify actual storage availability.
- The protocol and contracts remain unaudited and are not deployed to Base Sepolia. This report does not establish production security or meaningful-fund readiness.

**Readiness:** Phase 6A local trace-integrity verification is complete. Base Sepolia use remains **NO-GO** until deployment parameters, trace archive operations, independent audit, and chain-specific monitoring/finality procedures receive separate review.
