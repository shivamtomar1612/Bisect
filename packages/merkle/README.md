# Trace commitments

`@bisect/merkle` builds BISECT protocol v1 trace commitments from the real deterministic VM in `@bisect/vm`. The package independently constructs ordered levels from the VM's canonical domain-separated ABI/Keccak leaf and node hashes and compares the resulting root with the VM-computed root.

The API exposes `createTraceCommitment`, `computeTraceRoot`, `computeStateCommitment`, `createStateProof`, and `verifyStateProof`, plus canonical JSON trace/proof serialization and parsing. Proof verification requires the expected program, public input, transition budget, and trusted root from the caller. It verifies inclusion only; it does not prove every VM transition or adjudicate a claim.

The locked format in `docs/encoding-spec.md` has no padding rule: allowed transition budgets produce exactly 64, 256, 1024, or 4096 state leaves. Proof siblings are bottom-up and node children remain position-sensitive. Ethereum Keccak-256 and Solidity `abi.encode` are used through the VM's locked v1 hash functions.

Do not use OpenZeppelin Contracts v5.5.0 `MerkleProof` as this verifier: its default `processProof` calls `Hashes.commutativeKeccak256`, which sorts each pair, and the source explicitly states that noncommutative proofs are unsupported. The BISECT proof code chooses left/right from the corresponding state-index bit.

Known-answer proof vectors are in `fixtures/merkle-v1-vectors.json`; regenerate them with `pnpm merkle:vectors`. This package has no Solidity implementation or contract dependency.
