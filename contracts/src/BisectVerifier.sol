// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Stateless v1 VM transition and ordered trace-proof verifier.
/// @dev All protocol hashes use Ethereum Keccak-256 over Solidity abi.encode.
///      The internal library surface can be inlined into a future dispute contract.
library BisectVerifier {
    uint16 internal constant PROTOCOL_VERSION = 1;
    uint16 internal constant VM_VERSION = 1;
    uint16 internal constant ENCODING_VERSION = 1;
    uint256 internal constant REGISTER_COUNT = 8;
    uint256 internal constant INSTRUCTION_SIZE = 4;
    uint256 internal constant MAX_PROGRAM_BYTES = 512;

    bytes32 internal constant D_PROGRAM = keccak256("BISECT/PROGRAM/V1");
    bytes32 internal constant D_INPUT = keccak256("BISECT/INPUT/V1");
    bytes32 internal constant D_CONTEXT = keccak256("BISECT/CONTEXT/V1");
    bytes32 internal constant D_STATE = keccak256("BISECT/STATE/V1");
    bytes32 internal constant D_LEAF = keccak256("BISECT/LEAF/V1");
    bytes32 internal constant D_NODE = keccak256("BISECT/NODE/V1");

    struct State {
        uint16 pc;
        bool halted;
        uint64[8] registers;
    }

    struct TransitionProof {
        bytes program;
        uint64[8] publicInput;
        uint16 transitionCount;
        bytes32 traceRoot;
        uint16 stateIndex;
        State predecessor;
        bytes32[] predecessorSiblings;
        State claimedSuccessor;
        bytes32[] successorSiblings;
    }

    enum ProgramError {
        NONE,
        PROGRAM_EMPTY,
        PROGRAM_TOO_LONG,
        PROGRAM_LENGTH_NOT_MULTIPLE_OF_4,
        UNKNOWN_OPCODE,
        NONZERO_RESERVED_OPERAND,
        REGISTER_OUT_OF_RANGE,
        FALLTHROUGH_OUT_OF_RANGE,
        JUMP_TARGET_OUT_OF_RANGE
    }

    enum TransitionError {
        NONE,
        INVALID_PRESTATE_PC,
        INVALID_SUCCESSOR_PC
    }

    error ProgramExceedsMaximumSize();

    /// @notice Validate every instruction and each statically possible successor.
    /// @dev Error order follows docs/vm-spec.md, including ascending instruction order.
    function validateProgram(bytes calldata program)
        internal
        pure
        returns (ProgramError error, uint256 instructionCount)
    {
        uint256 length = program.length;
        if (length == 0) return (ProgramError.PROGRAM_EMPTY, 0);
        if (length > MAX_PROGRAM_BYTES) return (ProgramError.PROGRAM_TOO_LONG, 0);
        if (length % INSTRUCTION_SIZE != 0) {
            return (ProgramError.PROGRAM_LENGTH_NOT_MULTIPLE_OF_4, 0);
        }

        instructionCount = length / INSTRUCTION_SIZE;
        for (uint256 index = 0; index < instructionCount; ++index) {
            uint256 offset = index * INSTRUCTION_SIZE;
            uint8 opcode = uint8(program[offset]);
            uint8 a = uint8(program[offset + 1]);
            uint8 b = uint8(program[offset + 2]);
            uint8 c = uint8(program[offset + 3]);

            if (opcode > 0x09) return (ProgramError.UNKNOWN_OPCODE, instructionCount);

            // Check used register operands in byte order a, b, c.
            if (_usesA(opcode) && a >= REGISTER_COUNT) {
                return (ProgramError.REGISTER_OUT_OF_RANGE, instructionCount);
            }
            if (_usesB(opcode) && b >= REGISTER_COUNT) {
                return (ProgramError.REGISTER_OUT_OF_RANGE, instructionCount);
            }
            if (_usesC(opcode) && c >= REGISTER_COUNT) {
                return (ProgramError.REGISTER_OUT_OF_RANGE, instructionCount);
            }

            // Check reserved bytes in byte order a, b, c.
            if (_reservesA(opcode) && a != 0) {
                return (ProgramError.NONZERO_RESERVED_OPERAND, instructionCount);
            }
            if (_reservesB(opcode) && b != 0) {
                return (ProgramError.NONZERO_RESERVED_OPERAND, instructionCount);
            }
            if (_reservesC(opcode) && c != 0) {
                return (ProgramError.NONZERO_RESERVED_OPERAND, instructionCount);
            }

            if (opcode != 0x09 && index + 1 >= instructionCount) {
                return (ProgramError.FALLTHROUGH_OUT_OF_RANGE, instructionCount);
            }
            if (opcode == 0x08) {
                // This loop index is bounded by the validated 128-instruction maximum.
                // forge-lint: disable-next-line(unsafe-typecast)
                int256 target = int256(index) + _signedOffset(b, c);
                // instructionCount comes from the program byte length bounded above by 512.
                // forge-lint: disable-next-line(unsafe-typecast)
                if (target < 0 || target >= int256(uint256(instructionCount))) {
                    return (ProgramError.JUMP_TARGET_OUT_OF_RANGE, instructionCount);
                }
            }
        }
        return (ProgramError.NONE, instructionCount);
    }

    /// @notice Apply one v1 transition; already halted states stutter without a fetch.
    function step(bytes calldata program, State memory predecessor, uint256 instructionCount)
        internal
        pure
        returns (TransitionError error, State memory successor)
    {
        if (predecessor.halted) return (TransitionError.NONE, predecessor);
        if (predecessor.pc >= instructionCount) {
            return (TransitionError.INVALID_PRESTATE_PC, predecessor);
        }

        uint256 offset = uint256(predecessor.pc) * INSTRUCTION_SIZE;
        uint8 opcode = uint8(program[offset]);
        uint8 a = uint8(program[offset + 1]);
        uint8 b = uint8(program[offset + 2]);
        uint8 c = uint8(program[offset + 3]);

        successor = predecessor;
        uint256 nextPc = uint256(predecessor.pc) + 1;

        if (opcode == 0x01) {
            successor.registers[a] = uint64((uint16(b) << 8) | uint16(c));
        } else if (opcode == 0x02) {
            successor.registers[a] = predecessor.registers[b];
        } else if (opcode == 0x03) {
            unchecked {
                successor.registers[a] = predecessor.registers[b] + predecessor.registers[c];
            }
        } else if (opcode == 0x04) {
            unchecked {
                successor.registers[a] = predecessor.registers[b] - predecessor.registers[c];
            }
        } else if (opcode == 0x05) {
            unchecked {
                successor.registers[a] = predecessor.registers[b] * predecessor.registers[c];
            }
        } else if (opcode == 0x06) {
            successor.registers[a] = predecessor.registers[b] ^ predecessor.registers[c];
        } else if (opcode == 0x07) {
            successor.registers[a] = predecessor.registers[b] & predecessor.registers[c];
        } else if (opcode == 0x08) {
            if (predecessor.registers[a] != 0) {
                int256 target = int256(uint256(predecessor.pc)) + _signedOffset(b, c);
                // The verifier passes instructionCount from validateProgram (maximum 128).
                // forge-lint: disable-next-line(unsafe-typecast)
                if (target < 0 || target >= int256(uint256(instructionCount))) {
                    return (TransitionError.INVALID_SUCCESSOR_PC, predecessor);
                }
                // The signed target is nonnegative and below the validated instruction count.
                // forge-lint: disable-next-line(unsafe-typecast)
                nextPc = uint256(target);
            }
        } else if (opcode == 0x09) {
            successor.halted = true;
            nextPc = predecessor.pc;
        }

        if (!successor.halted && nextPc >= instructionCount) {
            return (TransitionError.INVALID_SUCCESSOR_PC, predecessor);
        }
        // nextPc is in the validated program range (at most 127).
        // forge-lint: disable-next-line(unsafe-typecast)
        successor.pc = uint16(nextPc);
        return (TransitionError.NONE, successor);
    }

    /// @notice Recompute v1 context, authenticate both adjacent states, and verify their step.
    /// @dev No caller-supplied version/hash metadata is trusted; versions and hashes are derived
    ///      from the canonical program bytes, fixed public input, and approved budget.
    function verifyOneStep(TransitionProof calldata proof) internal pure returns (bool) {
        if (!_isAllowedBudget(proof.transitionCount) || proof.stateIndex >= proof.transitionCount) {
            return false;
        }
        (ProgramError programError, uint256 instructionCount) = validateProgram(proof.program);
        if (programError != ProgramError.NONE) return false;

        bytes32 programHash = hashProgram(proof.program);
        bytes32 inputHash = hashInput(proof.publicInput);
        bytes32 contextHash = hashContext(programHash, inputHash, proof.transitionCount);
        uint16 nextIndex = proof.stateIndex + 1;

        if (
            !verifyStateProof(
                    proof.traceRoot,
                    contextHash,
                    proof.stateIndex,
                    proof.predecessor,
                    proof.predecessorSiblings,
                    proof.transitionCount
                )
                || !verifyStateProof(
                    proof.traceRoot,
                    contextHash,
                    nextIndex,
                    proof.claimedSuccessor,
                    proof.successorSiblings,
                    proof.transitionCount
                )
        ) {
            return false;
        }

        if (proof.stateIndex == 0 && !_isInitialState(proof.predecessor, proof.publicInput)) {
            return false;
        }

        (TransitionError transitionError, State memory computed) =
            step(proof.program, proof.predecessor, instructionCount);
        return
            transitionError == TransitionError.NONE
                && _statesEqual(computed, proof.claimedSuccessor);
    }

    function hashProgram(bytes calldata program) internal pure returns (bytes32) {
        if (program.length > MAX_PROGRAM_BYTES) revert ProgramExceedsMaximumSize();
        // The bound makes this uint16 byte-length field lossless.
        // forge-lint: disable-next-line(unsafe-typecast)
        return keccak256(abi.encode(D_PROGRAM, VM_VERSION, uint16(program.length), program));
    }

    function hashInput(uint64[8] calldata publicInput) internal pure returns (bytes32) {
        return keccak256(abi.encode(D_INPUT, ENCODING_VERSION, publicInput));
    }

    function hashContext(bytes32 programHash, bytes32 inputHash, uint16 transitionCount)
        internal
        pure
        returns (bytes32)
    {
        uint16 leafCount = transitionCount + 1;
        return keccak256(
            abi.encode(
                D_CONTEXT,
                PROTOCOL_VERSION,
                VM_VERSION,
                ENCODING_VERSION,
                programHash,
                inputHash,
                transitionCount,
                leafCount
            )
        );
    }

    function encodeState(State memory state) internal pure returns (bytes memory) {
        return abi.encode(state.pc, state.halted, state.registers);
    }

    function hashState(State memory state) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                D_STATE, VM_VERSION, ENCODING_VERSION, state.pc, state.halted, state.registers
            )
        );
    }

    function hashLeaf(bytes32 contextHash, uint16 index, State memory state)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(D_LEAF, contextHash, index, hashState(state)));
    }

    function hashNode(bytes32 left, bytes32 right) internal pure returns (bytes32) {
        return keccak256(abi.encode(D_NODE, left, right));
    }

    function verifyStateProof(
        bytes32 traceRoot,
        bytes32 contextHash,
        uint16 index,
        State calldata state,
        bytes32[] calldata siblings,
        uint16 transitionCount
    ) internal pure returns (bool) {
        if (!_isAllowedBudget(transitionCount)) return false;
        uint256 expectedDepth = _proofDepth(transitionCount);
        if (siblings.length != expectedDepth || index > transitionCount) return false;

        State memory stateCopy = state;
        bytes32 current = hashLeaf(contextHash, index, stateCopy);
        for (uint256 level = 0; level < expectedDepth; ++level) {
            bytes32 sibling = siblings[level];
            current = ((uint256(index) >> level) & 1) == 0
                ? hashNode(current, sibling)
                : hashNode(sibling, current);
        }
        return current == traceRoot;
    }

    function _isInitialState(State calldata state, uint64[8] calldata publicInput)
        private
        pure
        returns (bool)
    {
        if (state.pc != 0 || state.halted) return false;
        for (uint256 i = 0; i < REGISTER_COUNT; ++i) {
            if (state.registers[i] != publicInput[i]) return false;
        }
        return true;
    }

    function _statesEqual(State memory left, State calldata right) private pure returns (bool) {
        if (left.pc != right.pc || left.halted != right.halted) return false;
        for (uint256 i = 0; i < REGISTER_COUNT; ++i) {
            if (left.registers[i] != right.registers[i]) return false;
        }
        return true;
    }

    function _isAllowedBudget(uint16 budget) private pure returns (bool) {
        return budget == 63 || budget == 255 || budget == 1023 || budget == 4095;
    }

    function _proofDepth(uint16 budget) private pure returns (uint256) {
        if (budget == 63) return 6;
        if (budget == 255) return 8;
        if (budget == 1023) return 10;
        if (budget == 4095) return 12;
        return 0;
    }

    function _signedOffset(uint8 b, uint8 c) private pure returns (int256) {
        uint16 raw = (uint16(b) << 8) | uint16(c);
        // raw is at most 65535, so widening through uint256 preserves its value.
        // forge-lint: disable-next-line(unsafe-typecast)
        int256 unsignedValue = int256(uint256(raw));
        return raw < 0x8000 ? unsignedValue : unsignedValue - 0x10000;
    }

    function _usesA(uint8 opcode) private pure returns (bool) {
        return
            opcode == 0x01 || opcode == 0x02 || (opcode >= 0x03 && opcode <= 0x07) || opcode == 0x08;
    }

    function _usesB(uint8 opcode) private pure returns (bool) {
        return opcode == 0x02 || (opcode >= 0x03 && opcode <= 0x07);
    }

    function _usesC(uint8 opcode) private pure returns (bool) {
        return opcode >= 0x03 && opcode <= 0x07;
    }

    function _reservesA(uint8 opcode) private pure returns (bool) {
        return opcode == 0x00 || opcode == 0x09;
    }

    function _reservesB(uint8 opcode) private pure returns (bool) {
        return opcode == 0x00 || opcode == 0x09;
    }

    function _reservesC(uint8 opcode) private pure returns (bool) {
        return opcode == 0x00 || opcode == 0x02 || opcode == 0x09;
    }
}
