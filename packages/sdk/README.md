# TypeScript SDK

The SDK exposes the locked protocol v1 execution-trace commitment and inclusion-proof APIs from `@bisect/merkle`. Trace generation uses the Phase 2 deterministic VM. Proof verification requires the caller's expected program, public input, transition budget, and trusted trace root.

```ts
import {
  createExecutionStateProof,
  exportExecutionStateProof,
  generateTraceCommitment,
  verifyExecutionStateProof,
} from "@bisect/sdk";

const trace = generateTraceCommitment({
  program: "0x010100050300000109000000",
  publicInput: ["7", "0", "0", "0", "0", "0", "0", "0"],
  transitionCount: 63,
});
const proof = createExecutionStateProof({ trace, stateIndex: 63 });
const proofJson = exportExecutionStateProof(proof);
const valid = verifyExecutionStateProof({
  proof,
  program: trace.programHex,
  publicInput: trace.publicInput,
  transitionCount: trace.transitionCount,
  expectedRoot: trace.traceRoot,
});
```

The public API also includes direct root generation, state commitment, full trace export/import, and proof import/export. Uint64 values are decimal strings in JSON artifacts. The v1 tree is ordered, position-sensitive, and unpadded; permitted traces have 64, 256, 1024, or 4096 leaves.

An inclusion proof proves membership in a caller-supplied root only. It does not prove that every transition is valid or that a claim is honest. The SDK exports a Foundry-generated `bisectClaimRegistryAbi` and typed viem reader/writer wrappers (`getBisectClaimRegistryReader` and `getBisectClaimRegistryWriter`). The caller must supply a real address and its own viem clients; the SDK stores no key and does not invent a deployment. The current contract has no challenge-game API, and no transaction is simulated.
