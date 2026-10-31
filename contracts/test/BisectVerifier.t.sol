// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { BisectVerifier } from "../src/BisectVerifier.sol";

interface VmJson {
    function readFile(string calldata path) external view returns (string memory);
    function parseJsonBytes(string calldata json, string calldata key)
        external
        pure
        returns (bytes memory);
    function parseJsonBytes32(string calldata json, string calldata key)
        external
        pure
        returns (bytes32);
    function parseJsonBytes32Array(string calldata json, string calldata key)
        external
        pure
        returns (bytes32[] memory);
    function parseJsonUint(string calldata json, string calldata key)
        external
        pure
        returns (uint256);
}

contract BisectVerifierHarness {
    function verifyOneStep(BisectVerifier.TransitionProof calldata proof)
        external
        pure
        returns (bool)
    {
        return BisectVerifier.verifyOneStep(proof);
    }

    function validateProgram(bytes calldata program)
        external
        pure
        returns (BisectVerifier.ProgramError error, uint256 instructionCount)
    {
        return BisectVerifier.validateProgram(program);
    }

    function step(bytes calldata program, BisectVerifier.State calldata state)
        external
        pure
        returns (BisectVerifier.TransitionError error, BisectVerifier.State memory successor)
    {
        BisectVerifier.State memory stateCopy = state;
        (, uint256 instructionCount) = BisectVerifier.validateProgram(program);
        return BisectVerifier.step(program, stateCopy, instructionCount);
    }

    function hashProgram(bytes calldata program) external pure returns (bytes32) {
        return BisectVerifier.hashProgram(program);
    }

    function hashInput(uint64[8] calldata publicInput) external pure returns (bytes32) {
        return BisectVerifier.hashInput(publicInput);
    }

    function hashContext(bytes32 programHash, bytes32 inputHash, uint16 budget)
        external
        pure
        returns (bytes32)
    {
        return BisectVerifier.hashContext(programHash, inputHash, budget);
    }

    function encodeState(BisectVerifier.State calldata state) external pure returns (bytes memory) {
        BisectVerifier.State memory stateCopy = state;
        return BisectVerifier.encodeState(stateCopy);
    }

    function hashState(BisectVerifier.State calldata state) external pure returns (bytes32) {
        BisectVerifier.State memory stateCopy = state;
        return BisectVerifier.hashState(stateCopy);
    }

    function hashLeaf(bytes32 contextHash, uint16 index, BisectVerifier.State calldata state)
        external
        pure
        returns (bytes32)
    {
        BisectVerifier.State memory stateCopy = state;
        return BisectVerifier.hashLeaf(contextHash, index, stateCopy);
    }

    function hashNode(bytes32 left, bytes32 right) external pure returns (bytes32) {
        return BisectVerifier.hashNode(left, right);
    }
}

contract BisectVerifierTest {
    VmJson private constant vm = VmJson(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant VECTOR_COUNT = 17;
    string private constant VECTOR_PATH = "test/vectors/verifier-v1.json";

    BisectVerifierHarness private verifier;
    string private vectorsJson;

    event log_named_uint(string key, uint256 val);

    function setUp() external {
        verifier = new BisectVerifierHarness();
        vectorsJson = vm.readFile(VECTOR_PATH);
    }

    function testTypeScriptVectorsMatchSolidityAndVerify() external view {
        for (uint256 i = 0; i < VECTOR_COUNT; ++i) {
            BisectVerifier.TransitionProof memory proof = _vector(i);
            string memory base = _path("vectors", i, "");
            bytes32 expectedProgramHash =
                vm.parseJsonBytes32(vectorsJson, string.concat(base, "programHash"));
            bytes32 expectedInputHash =
                vm.parseJsonBytes32(vectorsJson, string.concat(base, "inputHash"));
            bytes32 expectedContextHash =
                vm.parseJsonBytes32(vectorsJson, string.concat(base, "executionContextHash"));
            bytes memory expectedPredecessor =
                vm.parseJsonBytes(vectorsJson, string.concat(base, "predecessor.abiEncoded"));
            bytes memory expectedSuccessor =
                vm.parseJsonBytes(vectorsJson, string.concat(base, "successor.abiEncoded"));
            bytes32 expectedPredecessorHash =
                vm.parseJsonBytes32(vectorsJson, string.concat(base, "predecessor.stateHash"));
            bytes32 expectedSuccessorHash =
                vm.parseJsonBytes32(vectorsJson, string.concat(base, "successor.stateHash"));
            bytes32 expectedPredecessorLeaf =
                vm.parseJsonBytes32(vectorsJson, string.concat(base, "predecessor.leafHash"));
            bytes32 expectedSuccessorLeaf =
                vm.parseJsonBytes32(vectorsJson, string.concat(base, "successor.leafHash"));

            _assertEq(verifier.hashProgram(proof.program), expectedProgramHash, "program hash");
            _assertEq(verifier.hashInput(proof.publicInput), expectedInputHash, "input hash");
            _assertEq(
                verifier.hashContext(expectedProgramHash, expectedInputHash, proof.transitionCount),
                expectedContextHash,
                "context hash"
            );
            _assertEq(verifier.encodeState(proof.predecessor), expectedPredecessor, "pre-state ABI");
            _assertEq(
                verifier.encodeState(proof.claimedSuccessor), expectedSuccessor, "next-state ABI"
            );
            _assertEq(
                verifier.hashState(proof.predecessor), expectedPredecessorHash, "pre-state hash"
            );
            _assertEq(
                verifier.hashState(proof.claimedSuccessor), expectedSuccessorHash, "next-state hash"
            );
            _assertEq(
                verifier.hashLeaf(expectedContextHash, proof.stateIndex, proof.predecessor),
                expectedPredecessorLeaf,
                "pre-state leaf"
            );
            _assertEq(
                verifier.hashLeaf(
                    expectedContextHash, proof.stateIndex + 1, proof.claimedSuccessor
                ),
                expectedSuccessorLeaf,
                "next-state leaf"
            );
            _assertTrue(verifier.verifyOneStep(proof), "TypeScript vector should verify");
        }
    }

    function testAdversarialTypeScriptVectorsAreRejected() external view {
        _assertFalse(verifier.verifyOneStep(_adversarial(0)), "authenticated wrong successor");
        _assertFalse(verifier.verifyOneStep(_adversarial(1)), "authenticated invalid PC");
    }

    function testRejectsForgedProofsAndWrongExecutionContexts() external view {
        BisectVerifier.TransitionProof memory proof = _vector(0);
        proof.predecessorSiblings[0] = bytes32(uint256(proof.predecessorSiblings[0]) ^ 1);
        _assertFalse(verifier.verifyOneStep(proof), "forged sibling");

        proof = _vector(0);
        proof.publicInput[0] = 99;
        _assertFalse(verifier.verifyOneStep(proof), "wrong public input context");

        proof = _vector(0);
        proof.program = hex"0100123409000000";
        _assertFalse(verifier.verifyOneStep(proof), "wrong program identity");

        proof = _vector(0);
        proof.transitionCount = 255;
        _assertFalse(verifier.verifyOneStep(proof), "wrong budget and proof depth");

        proof = _vector(0);
        proof.stateIndex = 1;
        _assertFalse(verifier.verifyOneStep(proof), "wrong state index");

        proof = _vector(0);
        bytes32[] memory truncated = new bytes32[](proof.successorSiblings.length - 1);
        for (uint256 i = 0; i < truncated.length; ++i) {
            truncated[i] = proof.successorSiblings[i];
        }
        proof.successorSiblings = truncated;
        _assertFalse(verifier.verifyOneStep(proof), "truncated successor proof");
    }

    function testTypeScriptMalformedProgramClassificationsMatchSolidity() external view {
        bytes[] memory programs = new bytes[](8);
        for (uint256 i = 0; i < programs.length; ++i) {
            string memory base = string.concat("$.malformedPrograms[", _decimal(i), "].");
            programs[i] = vm.parseJsonBytes(vectorsJson, string.concat(base, "program"));
            (BisectVerifier.ProgramError error,) = verifier.validateProgram(programs[i]);
            _assertEq(
                uint256(error),
                vm.parseJsonUint(vectorsJson, string.concat(base, "expectedErrorCode")),
                "program error classification"
            );
        }
    }

    function testFuzzUint64ArithmeticWrapsLikeTypeScript(uint64 left, uint64 right) external view {
        uint64[8] memory registers;
        registers[1] = left;
        registers[2] = right;
        BisectVerifier.State memory beforeState = BisectVerifier.State(0, false, registers);
        uint64 expectedAdd;
        uint64 expectedSub;
        uint64 expectedMul;
        unchecked {
            expectedAdd = left + right;
            expectedSub = left - right;
            expectedMul = left * right;
        }

        (, BisectVerifier.State memory addState) = verifier.step(hex"0300010209000000", beforeState);
        (, BisectVerifier.State memory subState) = verifier.step(hex"0400010209000000", beforeState);
        (, BisectVerifier.State memory mulState) = verifier.step(hex"0500010209000000", beforeState);
        _assertEq(uint256(addState.registers[0]), uint256(expectedAdd), "uint64 add wrap");
        _assertEq(uint256(subState.registers[0]), uint256(expectedSub), "uint64 sub wrap");
        _assertEq(uint256(mulState.registers[0]), uint256(expectedMul), "uint64 mul wrap");
    }

    function testFuzzJnzSignedOffset(uint64 condition, uint8 selector) external view {
        int16 relativeOffset = int16(uint16(selector % 3)) - 1;
        uint16 encodedOffset = uint16(relativeOffset);
        bytes memory program = hex"090000000800000009000000";
        program[6] = bytes1(uint8(encodedOffset >> 8));
        program[7] = bytes1(uint8(encodedOffset));

        uint64[8] memory registers;
        registers[0] = condition;
        BisectVerifier.State memory beforeState = BisectVerifier.State(1, false, registers);
        (, BisectVerifier.State memory nextState) = verifier.step(program, beforeState);
        uint16 expectedPc = condition == 0 ? 2 : uint16(int16(1) + relativeOffset);
        _assertEq(uint256(nextState.pc), uint256(expectedPc), "signed current-PC-relative branch");
    }

    function testHaltedStateAlwaysStuttersWithoutFetching() external view {
        uint64[8] memory registers;
        registers[0] = type(uint64).max;
        BisectVerifier.State memory halted = BisectVerifier.State(type(uint16).max, true, registers);
        (BisectVerifier.TransitionError error, BisectVerifier.State memory next) =
            verifier.step(hex"09000000", halted);
        _assertEq(uint256(error), 0, "halted transition error");
        _assertEq(keccak256(abi.encode(next)), keccak256(abi.encode(halted)), "halt stutter");
    }

    function testGasProfileMaximumProgramAndProofDepth() external {
        BisectVerifier.TransitionProof memory proof = _vector(16);
        uint256 gasBefore = gasleft();
        bool verified = verifier.verifyOneStep(proof);
        uint256 gasUsed = gasBefore - gasleft();
        emit log_named_uint("BISECT v1 verifier: 128 instructions, 12 siblings", gasUsed);
        _assertTrue(verified, "maximum-size vector should verify");
    }

    function _vector(uint256 index)
        private
        view
        returns (BisectVerifier.TransitionProof memory proof)
    {
        string memory base = _path("vectors", index, "");
        bytes memory inputAbi =
            vm.parseJsonBytes(vectorsJson, string.concat(base, "publicInputAbiEncoded"));
        proof.program = vm.parseJsonBytes(vectorsJson, string.concat(base, "program"));
        proof.publicInput = abi.decode(inputAbi, (uint64[8]));
        proof.transitionCount =
            uint16(vm.parseJsonUint(vectorsJson, string.concat(base, "transitionCount")));
        proof.traceRoot = vm.parseJsonBytes32(vectorsJson, string.concat(base, "traceRoot"));
        proof.stateIndex = uint16(vm.parseJsonUint(vectorsJson, string.concat(base, "stateIndex")));
        proof.predecessor = _decodeState(
            vm.parseJsonBytes(vectorsJson, string.concat(base, "predecessor.abiEncoded"))
        );
        proof.predecessorSiblings = vm.parseJsonBytes32Array(
            vectorsJson, string.concat(base, "predecessor.siblingsBottomUp")
        );
        proof.claimedSuccessor = _decodeState(
            vm.parseJsonBytes(vectorsJson, string.concat(base, "successor.abiEncoded"))
        );
        proof.successorSiblings = vm.parseJsonBytes32Array(
            vectorsJson, string.concat(base, "successor.siblingsBottomUp")
        );
    }

    function _adversarial(uint256 index)
        private
        view
        returns (BisectVerifier.TransitionProof memory proof)
    {
        string memory base = _path("adversarial", index, "");
        bytes memory inputAbi =
            vm.parseJsonBytes(vectorsJson, string.concat(base, "publicInputAbiEncoded"));
        proof.program = vm.parseJsonBytes(vectorsJson, string.concat(base, "program"));
        proof.publicInput = abi.decode(inputAbi, (uint64[8]));
        proof.transitionCount =
            uint16(vm.parseJsonUint(vectorsJson, string.concat(base, "transitionCount")));
        proof.traceRoot = vm.parseJsonBytes32(vectorsJson, string.concat(base, "traceRoot"));
        proof.stateIndex = uint16(vm.parseJsonUint(vectorsJson, string.concat(base, "stateIndex")));
        proof.predecessor = _decodeState(
            vm.parseJsonBytes(vectorsJson, string.concat(base, "predecessor.abiEncoded"))
        );
        proof.predecessorSiblings = vm.parseJsonBytes32Array(
            vectorsJson, string.concat(base, "predecessor.siblingsBottomUp")
        );
        proof.claimedSuccessor = _decodeState(
            vm.parseJsonBytes(vectorsJson, string.concat(base, "successor.abiEncoded"))
        );
        proof.successorSiblings = vm.parseJsonBytes32Array(
            vectorsJson, string.concat(base, "successor.siblingsBottomUp")
        );
    }

    function _decodeState(bytes memory encoded)
        private
        pure
        returns (BisectVerifier.State memory state)
    {
        (state.pc, state.halted, state.registers) = abi.decode(encoded, (uint16, bool, uint64[8]));
    }

    function _path(string memory arrayName, uint256 index, string memory suffix)
        private
        pure
        returns (string memory)
    {
        return string.concat("$.", arrayName, "[", _decimal(index), "].", suffix);
    }

    function _decimal(uint256 value) private pure returns (string memory) {
        if (value == 0) return "0";
        uint256 digits;
        uint256 copy = value;
        while (copy != 0) {
            ++digits;
            copy /= 10;
        }
        bytes memory output = new bytes(digits);
        while (value != 0) {
            --digits;
            output[digits] = bytes1(uint8(48 + value % 10));
            value /= 10;
        }
        return string(output);
    }

    function _assertTrue(bool condition, string memory message) private pure {
        require(condition, message);
    }

    function _assertFalse(bool condition, string memory message) private pure {
        require(!condition, message);
    }

    function _assertEq(uint256 actual, uint256 expected, string memory message) private pure {
        require(
            actual == expected,
            string.concat(
                message, " (actual=", _decimal(actual), ", expected=", _decimal(expected), ")"
            )
        );
    }

    function _assertEq(bytes32 actual, bytes32 expected, string memory message) private pure {
        require(actual == expected, message);
    }

    function _assertEq(bytes memory actual, bytes memory expected, string memory message)
        private
        pure
    {
        require(keccak256(actual) == keccak256(expected), message);
    }
}
