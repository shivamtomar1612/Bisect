// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { BisectVerifier } from "../src/BisectVerifier.sol";
import { BisectClaimRegistry } from "../src/BisectClaimRegistry.sol";

interface VmClaimRegistry {
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
    function deal(address account, uint256 balance) external;
    function roll(uint256 newHeight) external;
    function chainId(uint256 newChainId) external;
    function prank(address sender) external;
    function expectRevert(bytes4 revertData) external;
    function expectRevert(bytes calldata revertData) external;
}

interface VmClaimRegistryInvariant {
    function roll(uint256 newHeight) external;
}

contract BisectClaimRegistryHarness is BisectClaimRegistry {
    constructor(uint96 bond, uint32 challengeWindow, uint32 turnWindow)
        BisectClaimRegistry(bond, challengeWindow, turnWindow)
    { }

    function markActiveForTest(uint256 claimId) external {
        _claims[claimId].status = ClaimStatus.GAME_ACTIVE;
    }
}

contract RejectingWithdrawalWallet {
    receive() external payable {
        revert("reject ETH");
    }
}

contract ReentrantWithdrawalWallet {
    BisectClaimRegistry private immutable registry;
    bool public reentryWasBlocked;

    constructor(BisectClaimRegistry registry_) {
        registry = registry_;
    }

    receive() external payable {
        (bool success,) = address(registry).call(abi.encodeCall(registry.withdraw, ()));
        reentryWasBlocked = !success;
    }
}

contract BisectClaimRegistryHandler {
    VmClaimRegistryInvariant private constant vm =
        VmClaimRegistryInvariant(address(uint160(uint256(keccak256("hevm cheat code")))));
    BisectClaimRegistry private immutable registry;
    bytes private program;
    bytes private inputAbi;
    bytes32 private immutable root;
    bytes private initialStateAbi;
    bytes private finalStateAbi;
    bytes32[] private initialSiblings;
    bytes32[] private finalSiblings;
    bool private submitted;

    constructor(
        BisectClaimRegistry registry_,
        bytes memory program_,
        bytes memory inputAbi_,
        bytes32 root_,
        bytes memory initialStateAbi_,
        bytes32[] memory initialSiblings_,
        bytes memory finalStateAbi_,
        bytes32[] memory finalSiblings_
    ) {
        registry = registry_;
        program = program_;
        inputAbi = inputAbi_;
        root = root_;
        initialStateAbi = initialStateAbi_;
        finalStateAbi = finalStateAbi_;
        initialSiblings = initialSiblings_;
        finalSiblings = finalSiblings_;
    }

    receive() external payable { }

    function submit() external {
        if (submitted) return;
        submitted = true;
        BisectClaimRegistry.EndpointProof memory initialProof =
            _proof(initialStateAbi, initialSiblings);
        BisectClaimRegistry.EndpointProof memory finalProof = _proof(finalStateAbi, finalSiblings);
        BisectClaimRegistry.ClaimSubmission memory submission;
        submission.program = program;
        submission.publicInput = abi.decode(inputAbi, (uint64[8]));
        submission.transitionCount = 63;
        submission.traceRoot = root;
        submission.claimedOutput = 42;
        submission.initialProof = initialProof;
        submission.finalProof = finalProof;
        registry.submitClaim{ value: registry.bondWei() }(submission);
    }

    function advanceBlocks(uint8 count) external {
        // This handler is only used in a local Foundry invariant run.
        uint256 bounded = uint256(count) % 8;
        _roll(block.number + bounded);
    }

    function finalize() external {
        try registry.finalize(1) { } catch { }
    }

    function withdraw() external {
        try registry.withdraw() { } catch { }
    }

    function _proof(bytes memory stateBytes, bytes32[] memory siblings)
        private
        pure
        returns (BisectClaimRegistry.EndpointProof memory proof)
    {
        (proof.state.pc, proof.state.halted, proof.state.registers) =
            abi.decode(stateBytes, (uint16, bool, uint64[8]));
        proof.siblings = siblings;
    }

    function _roll(uint256 height) private {
        vm.roll(height);
    }
}

contract BisectClaimRegistryTest {
    VmClaimRegistry private constant vm =
        VmClaimRegistry(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant BOND = 1 ether;
    string private constant VECTOR_PATH = "test/vectors/claim-registry-v1.json";

    BisectClaimRegistryHarness private registry;
    string private vectorJson;

    receive() external payable { }

    function setUp() external {
        vm.deal(address(this), 20 ether);
        registry = new BisectClaimRegistryHarness(uint96(BOND), 5, 3);
        vectorJson = vm.readFile(VECTOR_PATH);
    }

    function testAcceptsExactBondAndRejectsUnderOrOverpayment() external {
        _expectBondError(BOND - 1);
        _expectBondError(BOND + 1);
        require(_submit() == 1, "first id must be one");
        require(registry.totalLockedBonds() == BOND, "exact bond locked");
        require(registry.accountingInvariantHolds(), "solvent after submission");
    }

    function testRejectsForgedEndpointProofAndDuplicateProposal() external {
        BisectClaimRegistry.EndpointProof memory initialProof = _proof("initial");
        BisectClaimRegistry.EndpointProof memory finalProof = _proof("terminal");
        initialProof.siblings[0] = bytes32(uint256(initialProof.siblings[0]) ^ 1);
        vm.expectRevert(BisectClaimRegistry.InvalidTraceEvidence.selector);
        _submit(initialProof, finalProof, BOND);

        _submit();
        vm.expectRevert(BisectClaimRegistry.DuplicateClaim.selector);
        _submit();
        require(registry.nextClaimId() == 2, "failed calls do not consume ids");
        require(registry.totalLockedBonds() == BOND, "failed calls lock no bond");
    }

    function testRejectsWrongProgramInputBudgetAndClaimedOutput() external {
        BisectClaimRegistry.ClaimSubmission memory submission = _submission();
        submission.program = hex"0100002b09000000";
        vm.expectRevert(BisectClaimRegistry.InvalidTraceEvidence.selector);
        registry.submitClaim{ value: BOND }(submission);

        submission = _submission();
        submission.publicInput[0] = 1;
        vm.expectRevert(BisectClaimRegistry.InvalidTraceEvidence.selector);
        registry.submitClaim{ value: BOND }(submission);

        submission = _submission();
        submission.claimedOutput = 43;
        vm.expectRevert(BisectClaimRegistry.InvalidTraceEvidence.selector);
        registry.submitClaim{ value: BOND }(submission);

        submission = _submission();
        submission.transitionCount = 64;
        vm.expectRevert(BisectClaimRegistry.InvalidExecutionBudget.selector);
        registry.submitClaim{ value: BOND }(submission);

        require(registry.nextClaimId() == 1, "rejected operations do not consume ids");
        require(registry.totalLiabilities() == 0, "rejected operations create no liability");
    }

    function testRejectsMalformedProgramAndTruncatedProofPath() external {
        BisectClaimRegistry.ClaimSubmission memory submission = _submission();
        submission.program = hex"ff00000009000000";
        vm.expectRevert(
            abi.encodeWithSelector(
                BisectClaimRegistry.InvalidProgram.selector,
                BisectVerifier.ProgramError.UNKNOWN_OPCODE
            )
        );
        registry.submitClaim{ value: BOND }(submission);

        submission = _submission();
        submission.initialProof.siblings = new bytes32[](5);
        vm.expectRevert(BisectClaimRegistry.InvalidTraceEvidence.selector);
        registry.submitClaim{ value: BOND }(submission);
    }

    function testClaimIdsAreGlobalAndClaimsAreIndependent() external {
        uint256 first = _submit();
        address secondProver = address(0xBEEF);
        vm.deal(secondProver, BOND);
        vm.prank(secondProver);
        uint256 second = _submit();
        require(first == 1 && second == 2, "ids monotonically increase");
        require(registry.getClaim(first).prover == address(this), "first owner");
        require(registry.getClaim(second).prover == secondProver, "second owner");
        require(registry.totalLockedBonds() == BOND * 2, "both bonds tracked");
        require(registry.totalLiabilities() == BOND * 2, "both liabilities tracked");
    }

    function testChallengeWindowIsInclusiveAndFinalizationRequiresNextBlock() external {
        uint256 claimId = _submit();
        BisectClaimRegistry.Claim memory claim = registry.getClaim(claimId);
        vm.roll(claim.challengeDeadline);
        vm.expectRevert(
            abi.encodeWithSelector(
                BisectClaimRegistry.ChallengeWindowOpen.selector, claim.challengeDeadline
            )
        );
        registry.finalize(claimId);
        vm.roll(claim.challengeDeadline + 1);
        registry.finalize(claimId);
        require(registry.getClaim(claimId).status == BisectClaimRegistry.ClaimStatus.FINALIZED);
        require(registry.withdrawableCredit(address(this)) == BOND, "credit equals exact bond");
        require(registry.totalLockedBonds() == 0, "bond unlocked");
        require(registry.totalCredits() == BOND, "credit liability recorded");
        require(registry.totalLiabilities() == BOND, "total liabilities conserved");
        require(registry.accountingInvariantHolds(), "solvent after finalization");

        vm.expectRevert(abi.encodeWithSelector(BisectClaimRegistry.ClaimNotOpen.selector, claimId));
        registry.finalize(claimId);
    }

    function testFinalizationCannotProceedWithActiveGameStatus() external {
        uint256 claimId = _submit();
        BisectClaimRegistry.Claim memory claim = registry.getClaim(claimId);
        vm.roll(claim.challengeDeadline + 1);
        registry.markActiveForTest(claimId);
        vm.expectRevert(abi.encodeWithSelector(BisectClaimRegistry.ActiveGame.selector, claimId));
        registry.finalize(claimId);
        require(registry.totalLockedBonds() == BOND, "active claim bond stays locked");
    }

    function testSuccessfulWithdrawalIsCallerOnlyAndCannotRepeat() external {
        uint256 claimId = _submit();
        _finalize(claimId);
        uint256 beforeBalance = address(this).balance;
        registry.withdraw();
        require(address(this).balance == beforeBalance + BOND, "exact wei transferred");
        require(registry.withdrawableCredit(address(this)) == 0, "credit cleared");
        require(registry.totalCredits() == 0 && registry.totalLiabilities() == 0);
        require(registry.accountingInvariantHolds(), "solvent after withdrawal");

        vm.expectRevert(BisectClaimRegistry.NoWithdrawableCredit.selector);
        registry.withdraw();

        vm.expectRevert(BisectClaimRegistry.NoWithdrawableCredit.selector);
        vm.prank(address(0xCAFE));
        registry.withdraw();
    }

    function testWithdrawalFailureRollsBackCreditAndLiabilities() external {
        RejectingWithdrawalWallet wallet = new RejectingWithdrawalWallet();
        vm.deal(address(wallet), BOND);
        vm.prank(address(wallet));
        _submit();
        _finalize(1);

        vm.expectRevert(BisectClaimRegistry.WithdrawalFailed.selector);
        vm.prank(address(wallet));
        registry.withdraw();

        require(
            registry.withdrawableCredit(address(wallet)) == BOND, "failed payment restores credit"
        );
        require(registry.totalLiabilities() == BOND, "failed payment restores liability");
        require(registry.accountingInvariantHolds(), "solvent after failed transfer");
    }

    function testReentrantWithdrawalCannotSpendCreditTwice() external {
        ReentrantWithdrawalWallet wallet = new ReentrantWithdrawalWallet(registry);
        vm.deal(address(wallet), BOND);
        vm.prank(address(wallet));
        _submit();
        _finalize(1);

        vm.prank(address(wallet));
        registry.withdraw();

        require(wallet.reentryWasBlocked(), "reentrant call must fail");
        require(address(wallet).balance == BOND, "one exact payment");
        require(registry.withdrawableCredit(address(wallet)) == 0, "credit spent once");
        require(registry.totalLiabilities() == 0, "liability removed once");
    }

    function testUnknownClaimAndUnsolicitedEtherAreRejected() external {
        vm.expectRevert(abi.encodeWithSelector(BisectClaimRegistry.UnknownClaim.selector, 999));
        registry.finalize(999);
        (bool success, bytes memory revertData) = address(registry).call{ value: 1 }("");
        require(!success, "plain ETH transfer rejected");
        require(_errorSelector(revertData) == BisectClaimRegistry.UnexpectedEther.selector);
    }

    function testConstructorRejectsUnsafeConfigurationAndBaseMainnet() external {
        vm.expectRevert(BisectClaimRegistry.InvalidConfiguration.selector);
        new BisectClaimRegistryHarness(0, 5, 3);
        vm.chainId(8453);
        vm.expectRevert(BisectClaimRegistry.BaseMainnetDeploymentDisabled.selector);
        new BisectClaimRegistryHarness(uint96(BOND), 5, 3);
    }

    function _expectBondError(uint256 amount) private {
        vm.expectRevert(
            abi.encodeWithSelector(BisectClaimRegistry.IncorrectBond.selector, BOND, amount)
        );
        _submit(_proof("initial"), _proof("terminal"), amount);
    }

    function _submit() private returns (uint256) {
        return _submit(_proof("initial"), _proof("terminal"), BOND);
    }

    function _submit(
        BisectClaimRegistry.EndpointProof memory initialProof,
        BisectClaimRegistry.EndpointProof memory finalProof,
        uint256 amount
    ) private returns (uint256) {
        BisectClaimRegistry.ClaimSubmission memory submission =
            _submission(initialProof, finalProof);
        return registry.submitClaim{ value: amount }(submission);
    }

    function _submission()
        private
        view
        returns (BisectClaimRegistry.ClaimSubmission memory submission)
    {
        return _submission(_proof("initial"), _proof("terminal"));
    }

    function _submission(
        BisectClaimRegistry.EndpointProof memory initialProof,
        BisectClaimRegistry.EndpointProof memory finalProof
    ) private view returns (BisectClaimRegistry.ClaimSubmission memory submission) {
        submission.program = vm.parseJsonBytes(vectorJson, "$.program");
        submission.publicInput =
            abi.decode(vm.parseJsonBytes(vectorJson, "$.publicInputAbiEncoded"), (uint64[8]));
        submission.transitionCount = uint16(vm.parseJsonUint(vectorJson, "$.transitionCount"));
        submission.traceRoot = vm.parseJsonBytes32(vectorJson, "$.traceRoot");
        submission.claimedOutput = uint64(vm.parseJsonUint(vectorJson, "$.claimedOutput"));
        submission.initialProof = initialProof;
        submission.finalProof = finalProof;
    }

    function _proof(string memory endpoint)
        private
        view
        returns (BisectClaimRegistry.EndpointProof memory proof)
    {
        string memory base = string.concat("$.", endpoint);
        bytes memory encoded =
            vm.parseJsonBytes(vectorJson, string.concat(base, ".stateAbiEncoded"));
        (proof.state.pc, proof.state.halted, proof.state.registers) =
            abi.decode(encoded, (uint16, bool, uint64[8]));
        proof.siblings =
            vm.parseJsonBytes32Array(vectorJson, string.concat(base, ".siblingsBottomUp"));
    }

    function _finalize(uint256 claimId) private {
        BisectClaimRegistry.Claim memory claim = registry.getClaim(claimId);
        vm.roll(claim.challengeDeadline + 1);
        registry.finalize(claimId);
    }

    function _errorSelector(bytes memory revertData) private pure returns (bytes4 selector) {
        if (revertData.length < 4) return bytes4(0);
        assembly ("memory-safe") {
            selector := mload(add(revertData, 32))
        }
    }
}

contract BisectClaimRegistryInvariantTest {
    VmClaimRegistry private constant vm =
        VmClaimRegistry(address(uint160(uint256(keccak256("hevm cheat code")))));
    BisectClaimRegistry private registry;
    address private handlerTarget;

    function setUp() external {
        string memory json = vm.readFile("test/vectors/claim-registry-v1.json");
        bytes memory initialBytes = vm.parseJsonBytes(json, "$.initial.stateAbiEncoded");
        bytes memory finalBytes = vm.parseJsonBytes(json, "$.terminal.stateAbiEncoded");
        BisectClaimRegistry.EndpointProof memory initialProof = _decodeProof(
            initialBytes, vm.parseJsonBytes32Array(json, "$.initial.siblingsBottomUp")
        );
        BisectClaimRegistry.EndpointProof memory finalProof = _decodeProof(
            finalBytes, vm.parseJsonBytes32Array(json, "$.terminal.siblingsBottomUp")
        );
        registry = new BisectClaimRegistry(1 ether, 5, 3);
        BisectClaimRegistryHandler handler = new BisectClaimRegistryHandler(
            registry,
            vm.parseJsonBytes(json, "$.program"),
            vm.parseJsonBytes(json, "$.publicInputAbiEncoded"),
            vm.parseJsonBytes32(json, "$.traceRoot"),
            initialBytes,
            initialProof.siblings,
            finalBytes,
            finalProof.siblings
        );
        vm.deal(address(handler), 1 ether);
        handlerTarget = address(handler);
    }

    function targetContracts() external view returns (address[] memory targets) {
        targets = new address[](1);
        targets[0] = handlerTarget;
    }

    function invariantLiabilitiesEqualLockedPlusCreditsAndAreSolvent() external view {
        require(
            registry.totalLiabilities() == registry.totalLockedBonds() + registry.totalCredits(),
            "liability composition invariant"
        );
        require(registry.isSolvent(), "balance covers liabilities");
    }

    function _decodeProof(bytes memory encoded, bytes32[] memory siblings)
        private
        pure
        returns (BisectClaimRegistry.EndpointProof memory proof)
    {
        (proof.state.pc, proof.state.halted, proof.state.registers) =
            abi.decode(encoded, (uint16, bool, uint64[8]));
        proof.siblings = siblings;
    }
}
