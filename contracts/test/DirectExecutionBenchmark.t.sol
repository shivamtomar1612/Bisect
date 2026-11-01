// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { DirectExecutionBenchmark } from "../src/benchmarks/DirectExecutionBenchmark.sol";
import { BisectVerifier } from "../src/BisectVerifier.sol";

contract DirectExecutionBenchmarkTest {
    DirectExecutionBenchmark private benchmark;

    function setUp() external {
        benchmark = new DirectExecutionBenchmark();
    }

    function testDirectBaselineUsesV1Transitions() external {
        uint64[8] memory input;
        BisectVerifier.State memory result = benchmark.execute(_program(20), input, 63);
        require(result.halted, "must halt");
        require(result.registers[0] == 20, "same VM output");
        require(result.registers[1] == 0, "loop counter exhausted");
        require(result.pc == 5, "halt PC stutters");
    }

    function testDirectBaselineStuttersAfterAnEarlyHalt() external {
        uint64[8] memory input;
        BisectVerifier.State memory result =
            benchmark.execute(hex"090000000000000009000000", input, 63);
        require(result.halted, "halt state must persist");
        require(result.pc == 0, "post-halt execution must stutter at the HALT PC");
    }

    function testRejectsUnapprovedTraceBudget() external {
        uint64[8] memory input;
        try benchmark.execute(_program(20), input, 64) {
            revert("unsupported budget accepted");
        } catch (bytes memory reason) {
            require(
                _selector(reason) == DirectExecutionBenchmark.UnsupportedBudget.selector,
                "wrong failure classification"
            );
        }
    }

    function testRejectsProgramThatCannotFinishWithinTrace() external {
        uint64[8] memory input;
        bytes memory program = hex"0800ffff09000000";
        try benchmark.execute(program, input, 63) {
            revert("invalid program accepted");
        } catch (bytes memory reason) {
            require(
                _selector(reason) == DirectExecutionBenchmark.InvalidProgram.selector,
                "wrong failure classification"
            );
        }
    }

    function _program(uint16 iterations) private pure returns (bytes memory) {
        return abi.encodePacked(
            hex"0101",
            bytes2(iterations),
            hex"0102000103000002040101020801fffe09000000"
        );
    }

    function _selector(bytes memory reason) private pure returns (bytes4 result) {
        if (reason.length < 4) return bytes4(0);
        assembly ("memory-safe") {
            result := mload(add(reason, 32))
        }
    }
}
