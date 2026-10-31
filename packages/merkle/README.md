# Trace commitments

Protocol v1 state encodings, Keccak domains, ordered tree construction, roots, and membership proofs are specified in docs/encoding-spec.md and currently implemented in packages/vm/src/encoding.ts, with known-answer tests in tests/unit/vm.test.ts.

This workspace package remains a Phase 3 extraction/integration placeholder. Its standalone API is not implemented. Do not duplicate or change the locked v1 formulas during that work; keep the VM implementation and protocol vectors as compatibility references.
