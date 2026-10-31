# BISECT VM v1 specification

**Status: locked for VM version 1.** This document is normative. Implementations must not change these semantics to simplify an implementation. A semantic change requires a new VM version and new vectors; correcting an editorial error requires an ADR and updated vectors.

## 1. Scope and constants

VM v1 is a deterministic register machine. It has exactly eight general-purpose unsigned 64-bit registers `R[0]..R[7]`, a program counter `pc` encoded as `uint16`, and a boolean `halted`. It has no memory, stack, flags, syscalls, or host interface. A program is 1 through 128 instructions, exactly four bytes per instruction. A trace has one of the fixed transition counts `N ∈ {63, 255, 1023, 4095}` and exactly `N+1` states.

The initial state for public input `I[0..7]` is:

```text
S[0] = { pc: 0, halted: false, R[i]: I[i] for i in 0..7 }
```

The VM output is the unsigned value `R[0]` in the final state `S[N]`. No other state field is part of the output.

## 2. Program encoding and validation

Program bytes contain instructions consecutively, with no header, padding, metadata, or trailing bytes. For instruction index `i`, bytes `[4i, 4i+1, 4i+2, 4i+3]` are respectively `[opcode, a, b, c]`. The PC counts instruction indexes, not byte offsets.

Validation MUST reject, before execution or claim submission:

1. An empty program, a program longer than 512 bytes, or a byte length not divisible by four.
2. Any opcode outside `0x00..0x09`.
3. Any register operand outside `0..7` where an opcode uses a register.
4. Nonzero reserved operands listed in the ISA table.
5. Any possible control-flow successor outside `[0, instructionCount-1]`. For every non-`HALT` instruction, its fallthrough `pc+1` is a possible successor and MUST be in range. For `JNZ`, the taken target is also a possible successor and MUST be in range.

Every instruction is validated, including unreachable instructions. A `HALT` has no fallthrough successor. Backward branches and cycles are permitted; whether execution halts is decided by bounded execution, not static validation. A program whose execution does not halt within `N` transitions has no valid **successful execution trace** and MUST NOT be proposed by an honest prover. An honest challenger may still commit to the deterministic `N`-transition trace ending unhalted; the challenge format does not require the challenger trace to halt, so it can expose a proposal that falsely claims a halted final state.

## 3. Instruction set

| Opcode | Name   | Required operands   | Semantics when not halted                                                                                                                                                                                                                                                |
| ------ | ------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `0x00` | `NOP`  | `a=b=c=0`           | Registers unchanged; `pc' = pc+1`; `halted' = false`.                                                                                                                                                                                                                    |
| `0x01` | `MOVI` | `a<8`               | `R'[a] = (b << 8) OR c`; all other registers unchanged; `pc'=pc+1`. The immediate is unsigned 16-bit big-endian and zero-extended to 64 bits.                                                                                                                            |
| `0x02` | `MOV`  | `a<8`, `b<8`, `c=0` | `R'[a]=R[b]`; all other registers unchanged; `pc'=pc+1`.                                                                                                                                                                                                                 |
| `0x03` | `ADD`  | `a,b,c<8`           | `R'[a]=(R[b]+R[c]) mod 2^64`; other registers unchanged; `pc'=pc+1`.                                                                                                                                                                                                     |
| `0x04` | `SUB`  | `a,b,c<8`           | `R'[a]=(R[b]-R[c]) mod 2^64`; other registers unchanged; `pc'=pc+1`.                                                                                                                                                                                                     |
| `0x05` | `MUL`  | `a,b,c<8`           | `R'[a]=(R[b]×R[c]) mod 2^64`; other registers unchanged; `pc'=pc+1`.                                                                                                                                                                                                     |
| `0x06` | `XOR`  | `a,b,c<8`           | `R'[a]=R[b] XOR R[c]`; other registers unchanged; `pc'=pc+1`.                                                                                                                                                                                                            |
| `0x07` | `AND`  | `a,b,c<8`           | `R'[a]=R[b] AND R[c]`; other registers unchanged; `pc'=pc+1`.                                                                                                                                                                                                            |
| `0x08` | `JNZ`  | `a<8`               | Let `u=256b+c`; let `off=u` when `u<32768`, else `off=u-65536`. If `R[a] != 0`, set `pc'=pc+off`; otherwise `pc'=pc+1`. Registers and `halted` are unchanged. The taken offset is signed 16-bit and is relative to the **current instruction PC**, not the following PC. |
| `0x09` | `HALT` | `a=b=c=0`           | Set `halted'=true`; leave `pc` and all registers unchanged.                                                                                                                                                                                                              |

For `ADD`, `SUB`, and `MUL`, arithmetic is unsigned modulo `2^64`; implementations MUST NOT trap, saturate, or use floating point. Register reads for an instruction are from the predecessor state. The result is then written to the destination register, so aliasing source and destination registers is allowed.

Examples for `JNZ`: at `pc=5`, bytes `08 02 FF FE` mean `R[2] != 0 ? pc'=3 : pc'=6`; at `pc=5`, offset zero means a taken self-loop. The validator still requires the not-taken fallthrough at index 6 to exist.

## 4. Transition relation and execution

`step(P,S)` is defined only for a statically valid program `P` and a representable state `S`:

1. If `S.halted == true`, return exactly `S` (stuttering), without fetching an instruction.
2. Otherwise require `S.pc < instructionCount(P)` and fetch instruction `P[S.pc]`.
3. Apply exactly the matching opcode rule above. For `JNZ`, compute the signed target in a signed integer wide enough to represent `uint16 + int16`, then require the target to be a valid instruction index. For sequential instructions, compute `pc+1` without narrowing first.
4. Return the unique successor state. A transition never changes more than the specified destination register, PC, and halt bit.

For a selected budget `N`, execution repeatedly applies `step` to produce `S[0]..S[N]`. The first state with `halted=true` MUST occur at an index `h` with `1 <= h <= N`; the `HALT` instruction transition is `S[h-1] -> S[h]`. For every `i` where `h <= i < N`, `S[i+1] == S[i]`. Reaching transition `N` with `halted=false` is `BUDGET_EXHAUSTED` and cannot be committed as a successful execution.

The VM has no filesystem, network, external calls, randomness, clock, floating point, environment reads, arbitrary JavaScript, native code, or host callbacks. VM computation is bounded by `N<=4095`; program parsing is bounded by 128 instructions; the ISA has no data-dependent loop inside one transition.

## 5. Deterministic error classification

Validation occurs before execution. Global length errors are checked in the order `PROGRAM_EMPTY`, `PROGRAM_TOO_LONG`, `PROGRAM_LENGTH_NOT_MULTIPLE_OF_4`. Then instructions are checked in ascending index order: unknown opcode; used register indexes in byte order `a,b,c`; reserved operand bytes in byte order `a,b,c`; then control-flow successors, fallthrough before taken jump. Implementations MUST preserve these error categories (human-readable wording may differ): `PROGRAM_EMPTY`, `PROGRAM_TOO_LONG`, `PROGRAM_LENGTH_NOT_MULTIPLE_OF_4`, `UNKNOWN_OPCODE`, `NONZERO_RESERVED_OPERAND`, `REGISTER_OUT_OF_RANGE`, `FALLTHROUGH_OUT_OF_RANGE`, and `JUMP_TARGET_OUT_OF_RANGE`.

Execution returns either a complete successful trace or one of: `INVALID_PRESTATE_PC` (an unhalted state fetches outside the program), `INVALID_SUCCESSOR_PC` (a defensive runtime target check fails), or `BUDGET_EXHAUSTED`. A committed-trace verifier classifies a supplied adjacent pair as `VALID` exactly when `step(P,S[i])` exists and equals `S[i+1]` field-for-field; otherwise it is `INVALID_TRANSITION`. If the predecessor is halted, only exact stuttering is valid. A malformed program is never reclassified as a trace-transition fault; it is rejected at program validation.

## 6. Final-state rule

For any successful trace, `S[N].halted` MUST be true and `claimedOutput == S[N].R[0]`. A commitment does not prove every transition by itself; the dispute protocol gives a challenger a bounded way to expose a conflicting transition. Acceptance without a timely successful challenge is optimistic acceptance under the liveness and monitoring assumptions in `security-model.md`.
