# BISECT v1 canonical encoding and commitments

**Status: locked for protocol v1, VM v1, and encoding v1.** All integer fields are unsigned unless explicitly declared signed. Every serialized number uses its Solidity ABI type exactly; off-chain JSON uses decimal strings for `uint64` values to avoid JavaScript precision loss.

## 1. Version identifiers

The identifiers are `PROTOCOL_VERSION=1`, `VM_VERSION=1`, and `ENCODING_VERSION=1`, each encoded as `uint16`. They are independent constants. The domain-tag strings below include `V1`; changing a field layout or hash formula requires an encoding-version bump, and changing transition semantics requires a VM-version bump. A dispute is always interpreted using the version stored in the claim; v1 contracts reject other versions.

## 2. Canonical fields

- **Program bytes:** raw bytecode only, with the validation rules in `vm-spec.md`; byte length is 4 through 512 and a multiple of four. No alternate header, padding, or normalization is allowed.
- **Public input:** exactly eight `uint64` values in register order. Its external canonical byte representation is standard ABI `abi.encode(uint64[8])`, exactly 256 bytes. Each ABI word is a 32-byte big-endian integer with the high 24 bytes zero. Input values MUST be range-checked before encoding.
- **State encoding:** `abi.encode(uint16 pc, bool halted, uint64[8] registers)` in that order, exactly 320 bytes (ten 32-byte ABI words). The array order is `R[0]..R[7]`. ABI booleans are exactly word zero or one. No packed ABI encoding is used.
- **Transition count:** one of `63`, `255`, `1023`, `4095`, encoded as `uint16 N`. Leaf count is `L=N+1`, encoded as `uint16 L`; therefore `L` is exactly `64`, `256`, `1024`, or `4096`.
- **Hash:** Ethereum Keccak-256 (the EVM `keccak256` operation), not standardized SHA3-256.

The standard ABI encoding rules used here are the Solidity ABI rules. All static fields occupy one 32-byte word. Dynamic `bytes` use a 32-byte offset in the head, followed by a 32-byte byte length and the bytes right-padded with zeroes to a multiple of 32. Domain/hash fields are static `bytes32` values. Implementations MUST use these exact type lists and field orders.

## 3. Domain constants and hashes

For each listed ASCII string `T`, define `D_T = keccak256(UTF8(T))`. `D_T` is a `bytes32` argument to the following standard `abi.encode` call; the string itself is not concatenated into each payload.

```text
D_PROGRAM = keccak256("BISECT/PROGRAM/V1")
D_INPUT   = keccak256("BISECT/INPUT/V1")
D_CONTEXT = keccak256("BISECT/CONTEXT/V1")
D_STATE   = keccak256("BISECT/STATE/V1")
D_LEAF    = keccak256("BISECT/LEAF/V1")
D_NODE    = keccak256("BISECT/NODE/V1")
```

The exact formulas are:

```text
programHash = keccak256(abi.encode(
  D_PROGRAM, uint16(VM_VERSION), uint16(programByteLength), bytes(program)
))

inputHash = keccak256(abi.encode(
  D_INPUT, uint16(ENCODING_VERSION), uint64[8](publicInput)
))

contextHash = keccak256(abi.encode(
  D_CONTEXT,
  uint16(PROTOCOL_VERSION), uint16(VM_VERSION), uint16(ENCODING_VERSION),
  bytes32(programHash), bytes32(inputHash), uint16(N), uint16(L)
))

stateHash(S) = keccak256(abi.encode(
  D_STATE, uint16(VM_VERSION), uint16(ENCODING_VERSION),
  uint16(S.pc), bool(S.halted), uint64[8](S.registers)
))

leafHash(contextHash, i, S) = keccak256(abi.encode(
  D_LEAF, bytes32(contextHash), uint16(i), bytes32(stateHash(S))
))

nodeHash(left, right) = keccak256(abi.encode(
  D_NODE, bytes32(left), bytes32(right)
))
```

`programByteLength` is the exact raw byte length. `i` is a state index in `0..N`. State hashes intentionally omit the index; the leaf hash binds the state to its exact index and execution context. The context binds protocol/VM/encoding versions, program, input, transition budget, and leaf count. The Merkle root of the `L` context-bound leaves is the `traceRoot`; there is no second padding or outer-root hash.

## 4. Merkle tree and proofs

Leaves are `leafHash(contextHash, i, S[i])` in increasing index order. `L` is a power of two by construction; **there are no empty leaves and no padding rule**. At each level pair adjacent ordered nodes as `nodeHash(left,right)` until one root remains. Left and right are never sorted.

A membership proof for index `i` contains exactly `H=log2(L)` `bytes32` siblings, ordered bottom-up: sibling at level 0 (adjacent leaf) first, sibling at level `H-1` last. Set `x=leafHash(...)`; for each level `j=0..H-1`, inspect bit `j` of `i`: if zero, `x=nodeHash(x,sibling[j])`; if one, `x=nodeHash(sibling[j],x)`. The proof is valid exactly when the final `x == traceRoot`.

| Transitions `N` | Leaves `L` | Proof siblings `H` |
| --------------: | ---------: | -----------------: |
|              63 |         64 |                  6 |
|             255 |        256 |                  8 |
|            1023 |       1024 |                 10 |
|            4095 |       4096 |                 12 |

## 5. Proposal/output binding

A proposal stores the exact program bytes, fixed input, `N`, `traceRoot`, and claimed `uint64` output. It MUST provide:

1. A proof at index zero whose state exactly equals `{pc:0, halted:false, registers:publicInput}`.
2. A proof at index `N` whose state has `halted=true` and `registers[0] == claimedOutput`.

Both proofs use the proposal's `contextHash`; their sibling arrays must have exactly `H` elements. These checks bind the claimed output to an authenticated final state and bind the unique initial state to the public input. They do not establish that intermediate transitions are valid; that is the purpose of the dispute protocol.

## 6. Version/domain test vectors

`protocol-vectors.json` contains the computed values for an example program, input, selected state hashes/leaves, complete trace root, and a final-state proof. It also contains semantic boundary cases. Hashes were generated with viem's Keccak-256 and standard ABI encoder using the formulas above; future Solidity and TypeScript implementations MUST reproduce them byte-for-byte before claiming compatibility.
