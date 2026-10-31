# Phase 7 acceptance

**Status: PASS for local Phase 7 security-test acceptance.** The existing v1 VM, ordered Merkle rules, verifier, claim registry, dispute state machine, and financial settlement semantics remain unchanged.

## Gate results

| Gate                                     | Result                                                                                                                                                                      |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Solidity adversarial/fuzz coverage       | PASS — state/hash/path mutation, context binding, arithmetic boundaries, full signed JNZ offsets, malformed proofs, and intermediate fraud.                                 |
| Dispute soundness coverage               | PASS — twelve same-output fraudulent traces were isolated and refuted; honest-prover and timeout outcomes remain covered.                                                   |
| Financial solvency coverage              | PASS — production-registry stateful invariant, per-claim bond ownership, exact beneficiary accounting, withdrawals, reentrancy, reverting receiver, and forced-ETH surplus. |
| TypeScript property checks               | PASS — 48 seeded traces, with valid-proof and mutation checks. Seed: `0x8b5ad4cef1239071`.                                                                                  |
| Full workspace validation                | PASS — `pnpm check:phase7`, including 42 Vitest tests, seven workspace typechecks, package/frontend builds, Foundry tests, and local Anvil.                                 |
| Independent audit / production readiness | NOT ESTABLISHED — this phase does not provide either.                                                                                                                       |

## Reproduction

From a PowerShell session at the repository root:

```powershell
$env:FOUNDRY_INVARIANT_RUNS='32'
$env:FOUNDRY_INVARIANT_DEPTH='80'
pnpm check:phase7
```

The Foundry run completed **55 tests across 7 suites** with no failures. Both stateful accounting campaigns completed 2,560 calls each at these settings. Solidity fuzz properties ran 256 cases apiece. The local Anvil demonstration mined 21 transactions on chain ID `31337` and settled the same-output intermediate-fraud scenario using test ETH.

## Phase 8 decision

**GO for Phase 8 implementation planning and local development**, because the Phase 7 solvency, cryptographic-verification, and dispute-soundness test gates passed. This is not approval to deploy, accept meaningful funds, or describe BISECT as audited or production-secure. Chain-specific parameter review, availability/liveness operations, deployment review, and an independent audit remain separate requirements.
