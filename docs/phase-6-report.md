# Phase 6 verification report

**Result: PASS for the scoped Phase 6 implementation and local verification.** The v1 claim registry, interactive dispute game, financial settlement, SDK ABI, Foundry tests, and mined Anvil demonstration are implemented. **Base Sepolia deployment and production use remain NO-GO:** the contracts are unaudited, and no public-chain deployment was performed.

## Protocol behavior

The implementation follows the owner's decision to preserve locked v1 bisection. At each level, prover and challenger authenticate ordered left/right child-subtree hashes; the game descends to the left child when those hashes differ and otherwise to the differing right child. It does not search by submitting midpoint states. `challenge` follows the locked v1 admission rule: a distinct execution-context-bound root and a proof of the canonical initial state. It does not require a challenger terminal-state witness at opening. The selected differing state is authenticated during the later terminal turn.

`BisectDisputeRegistryV1` inherits the Phase 5 exact-wei accounting, ReentrancyGuard withdrawal, and claim validation helpers. It enables claim submission only in the derived game contract. Each claim permits one active game; successful prover responses leave the claim open for another challenge until the unchanged claim deadline. Terminal proof or timeout selects the outcome on-chain. Settlement moves bond liabilities to pull credits; it does not send ETH automatically. A monotonically increasing `gameNumber` on mutating game calls is an ABI replay fence documented in ADR-0013 and does not change protocol v1 outcomes.

No private keys are stored. The Anvil test uses its own unlocked local accounts and test ETH. No wallet custody, database financial ledger, or Account Ledger behavior was introduced; the Account Ledger addendum remains pending.

## Implementation files

- `contracts/src/BisectDisputeRegistryV1.sol` — claim admission, challenge opening, bisection turns, terminal proof verification, deadlines, retries, bond settlement, finalization, and events.
- `contracts/test/BisectDisputeRegistryV1.t.sol` — dispute, proof, timing, retry, and accounting tests.
- `scripts/generate-phase6-dispute-vectors.mts` and `contracts/test/vectors/dispute-v1.json` — TypeScript-generated honest/fraudulent trace roots, child pairs, and terminal proofs.
- `packages/sdk/src/abis/bisectDisputeRegistryV1.ts` and `packages/sdk/src/dispute-registry.ts` — generated ABI and typed viem clients and game types.
- `packages/sdk/scripts/phase6-anvil.mts` — isolated-chain deployment, complete game, event reconstruction, balance checks, and measured receipts.
- `scripts/generate-claim-registry-abi.mjs`, root scripts, and `.github/workflows/ci.yml` — ABI generation and reproducible local/CI checks.
- `docs/dispute-state-machine.md`, `docs/phase-6-integration-contract.md`, `docs/decisions.md`, `docs/architecture.md`, `docs/requirements.md`, `docs/security-model.md`, `README.md`, and `AGENTS.md` — current protocol and project status.

## Verification results

- `pnpm check:phase6` — **passed, exit 0** after the full implementation and test corrections. This ran Biome lint and format checks, all workspace typechecks, Vitest, TypeScript package builds, Next.js production build, Foundry build, vector generation, the full Foundry suite, and the Anvil flow.
- TypeScript — **7 workspace typechecks passed**; Vitest **41 tests passed across 5 files**; VM, Merkle, SDK, and Next.js production builds passed.
- Solidity — pinned Foundry **1.8.7**, Solidity **0.8.30**, optimizer 200. Foundry **34 tests passed** across five suites: 8 dispute-registry, 8 verifier, 16 claim-registry, 1 OpenZeppelin smoke, and 1 accounting invariant test. The invariant ran 256 cases and 128,000 handler calls with zero reverts or invariant failures. The verifier suite also ran two 256-case fuzz tests.
- After making Anvil discovery portable across Windows and CI `PATH`, `pnpm --filter @bisect/sdk typecheck`, `pnpm lint`, `pnpm format:check`, `forge fmt --root contracts --check`, and `pnpm phase6:anvil` were rerun and passed. The Anvil runner looks for Foundry on `PATH` and then in the pinned repository tool directory.
- The contract CI job now invokes `pnpm phase6:anvil`. The GitHub-hosted workflow itself has not been run from this workstation.

## Mined Anvil dispute

The test starts a fresh Anvil chain at chain ID `31337`, deploys `BisectDisputeRegistryV1`, submits a trace whose intermediate state 1 is fraudulent but whose final output remains 42, and challenges it with the honest VM trace. Both parties submit real mined transactions funded by Anvil test ETH. The game resolves the fraud and the challenger withdraws its credit.

| Measurement                                                                  |                                                                        Observed result |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------: |
| Bisection rounds                                                             |                                                                                      6 |
| Differing state index                                                        |                                                                                      1 |
| Mined transactions                                                           | 18: deploy 1, claim 1, challenge 1, child reveals 12, terminal reveals 2, withdrawal 1 |
| Outcome                                                                      |                                            `PROVER_TRANSITION_INVALID`; challenger won |
| Challenger credit before withdrawal                                          |                                                          2,000,000,000,000,000,000 wei |
| Prover credit before withdrawal                                              |                                                                                  0 wei |
| Terminal resolving transaction gas                                           |                                                                                199,088 |
| Withdrawal transaction gas                                                   |                                                                                 40,198 |
| Total gas used across receipts                                               |                                                                              6,399,616 |
| Total execution fees across receipts                                         |                                                             11,721,405,284,544,025 wei |
| Challenger wallet net increase from withdrawal, after that transaction's gas |                                                          1,999,955,393,569,273,424 wei |
| Final locked bonds / credits / liabilities                                   |                                                                          0 / 0 / 0 wei |
| Registry ETH balance after withdrawal                                        |                                                                                  0 wei |
| Accounting invariant                                                         |                                                                                   true |

The event decoder reconstructed six bisection levels, twelve child responses, both terminal evidence responses, the winner and selected index, the 2 ETH pull credit, and the successful withdrawal. Gas and balances above are from local mined receipts and state reads; they are not Base Sepolia measurements. Constructor parameters were 1 ETH bonds, a five-block challenge window, and a three-block turn window, used only as deterministic test fixtures.

## Remaining assumptions and risks

- Contract correctness still depends on Keccak-256 collision resistance, correct EVM execution, and the Phase 4 TypeScript/Solidity encoding agreement.
- A challenger needs access to the full trace and proof material, must monitor the claim, hold bond and gas funds, and get transactions included before block deadlines. A trace root does not provide data availability.
- Chain liveness, censorship, reorgs, and finality can affect whether a challenge or response lands in time. Test windows are fixtures and have not been justified for Base Sepolia operations.
- The Phase 6 Foundry scenarios exercise the minimum 63-transition budget; larger budgets are covered by the verifier's proof-depth tests but not a full maximum-budget game execution.
- The new dispute contract has deterministic adversarial scenarios but no separate invariant handler that fuzzes complete multi-game dispute lifecycles. This remains an additional review/testing risk.
- No independent security/economic audit, Base Sepolia deployment, automatic challenger, wallet UI, or production trace-archival service is established.

**Readiness:** the local Phase 6 implementation gate is complete. Do not treat this as authorization to deploy or accept meaningful funds. A testnet deployment requires separately reviewed deployment parameters and operational monitoring; production use requires independent audit and data-availability/liveness operations.
