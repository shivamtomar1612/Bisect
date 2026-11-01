// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { BisectVerifier } from "../BisectVerifier.sol";

/// @notice Benchmark-only direct-execution baseline; not part of the claim protocol.
/// @dev Uses the exact v1 verifier decoder and one-step transition implementation. It executes
///      every transition in one transaction so measurements can be compared to optimistic claims.
contract DirectExecutionBenchmark {
    error UnsupportedBudget(uint16 budget);
    error InvalidProgram(BisectVerifier.ProgramError reason);
    error InvalidTransition(uint16 transitionIndex, BisectVerifier.TransitionError reason);

    event ExecutionCompleted(
        uint16 transitionCount,
        uint64 output,
        uint16 finalPc,
        bool halted,
        bytes32 finalRegistersHash
    );
    event OneStepCheckCompleted(uint16 stateIndex, bool valid);

    function execute(bytes calldata program, uint64[8] calldata publicInput, uint16 transitionCount)
        external
        returns (BisectVerifier.State memory state)
    {
        if (
            transitionCount != 63 && transitionCount != 255 && transitionCount != 1023
                && transitionCount != 4095
        ) revert UnsupportedBudget(transitionCount);

        (BisectVerifier.ProgramError programError, uint256 instructionCount) =
            BisectVerifier.validateProgram(program);
        if (programError != BisectVerifier.ProgramError.NONE) revert InvalidProgram(programError);

        state.pc = 0;
        state.halted = false;
        state.registers = publicInput;
        // This loop is bounded to at most 4,095 validated v1 transitions; fail at the exact step.
        for (uint16 index = 0; index < transitionCount; ++index) {
            (BisectVerifier.TransitionError transitionError, BisectVerifier.State memory next) =
                BisectVerifier.step(program, state, instructionCount);
            if (transitionError != BisectVerifier.TransitionError.NONE) {
                revert InvalidTransition(index, transitionError);
            }
            state = next;
        }

        emit ExecutionCompleted(
            transitionCount,
            state.registers[0],
            state.pc,
            state.halted,
            keccak256(abi.encode(state.registers))
        );
    }

    /// @notice Measures the exact v1 verifier operation in an isolated benchmark transaction.
    function verifyOneStep(BisectVerifier.TransitionProof calldata proof)
        external
        returns (bool valid)
    {
        valid = BisectVerifier.verifyOneStep(proof);
        emit OneStepCheckCompleted(proof.stateIndex, valid);
    }
}
