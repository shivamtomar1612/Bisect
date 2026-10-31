// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { BisectClaimRegistry } from "../src/BisectClaimRegistry.sol";
import { BisectDisputeRegistryV1 } from "../src/BisectDisputeRegistryV1.sol";
import { BisectVerifier } from "../src/BisectVerifier.sol";

interface VmPhase7 {
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
    function toString(uint256 value) external pure returns (string memory);
    function deal(address account, uint256 balance) external;
    function etch(address account, bytes calldata code) external;
    function roll(uint256 newHeight) external;
    function prank(address sender) external;
    function expectRevert(bytes4 revertData) external;
    function expectRevert(bytes calldata revertData) external;
}

contract Phase7ProverActor {
    BisectDisputeRegistryV1 private immutable registry;
    uint256 public withdrawn;

    constructor(BisectDisputeRegistryV1 registry_) {
        registry = registry_;
    }

    receive() external payable {
        withdrawn += msg.value;
    }

    function submit(BisectClaimRegistry.ClaimSubmission calldata submission)
        external
        payable
        returns (uint256)
    {
        return registry.submitClaim{ value: msg.value }(submission);
    }

    function revealChildren(uint256 claimId, uint256 gameNumber, bytes32 left, bytes32 right)
        external
    {
        registry.revealChildren(claimId, gameNumber, left, right);
    }

    function revealTerminal(
        uint256 claimId,
        uint256 gameNumber,
        BisectVerifier.TransitionProof calldata proof
    ) external {
        registry.revealTerminal(claimId, gameNumber, proof);
    }

    function withdraw() external {
        try registry.withdraw() { } catch { }
    }
}

contract Phase7RejectingWallet {
    BisectDisputeRegistryV1 private immutable registry;

    constructor(BisectDisputeRegistryV1 registry_) {
        registry = registry_;
    }

    function submit(BisectClaimRegistry.ClaimSubmission calldata submission) external payable {
        registry.submitClaim{ value: msg.value }(submission);
    }

    function withdraw() external {
        registry.withdraw();
    }

    receive() external payable {
        revert("reject ETH");
    }
}

contract Phase7ReentrantWallet {
    BisectDisputeRegistryV1 private immutable registry;
    bool public reentryBlocked;
    uint256 public received;

    constructor(BisectDisputeRegistryV1 registry_) {
        registry = registry_;
    }

    function submit(BisectClaimRegistry.ClaimSubmission calldata submission) external payable {
        registry.submitClaim{ value: msg.value }(submission);
    }

    function withdraw() external {
        registry.withdraw();
    }

    receive() external payable {
        received += msg.value;
        (bool success,) = address(registry).call(abi.encodeCall(registry.withdraw, ()));
        reentryBlocked = !success;
    }
}

contract Phase7AdversarialTest {
    VmPhase7 private constant vm =
        VmPhase7(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant BOND = 1 ether;
    address private constant CHALLENGER = address(0xCAFE);
    string private constant DISPUTE_VECTOR = "test/vectors/dispute-v1.json";
    string private constant SECURITY_VECTOR = "test/vectors/security-v1.json";

    BisectDisputeRegistryV1 private registry;
    string private disputeJson;
    string private securityJson;

    function setUp() external {
        vm.deal(address(this), 50 ether);
        vm.deal(CHALLENGER, 40 ether);
        registry = new BisectDisputeRegistryV1(uint96(BOND), 5, 3);
        disputeJson = vm.readFile(DISPUTE_VECTOR);
        securityJson = vm.readFile(SECURITY_VECTOR);
    }

    function testBisectionSelectsFirstMismatchAtState1() external {
        _assertIntervalCase(0);
    }

    function testBisectionSelectsFirstMismatchAtState2() external {
        _assertIntervalCase(1);
    }

    function testBisectionSelectsFirstMismatchAtState3() external {
        _assertIntervalCase(2);
    }

    function testBisectionSelectsFirstMismatchAtState7() external {
        _assertIntervalCase(3);
    }

    function testBisectionSelectsFirstMismatchAtState8() external {
        _assertIntervalCase(4);
    }

    function testBisectionSelectsFirstMismatchAtState15() external {
        _assertIntervalCase(5);
    }

    function testBisectionSelectsFirstMismatchAtState16() external {
        _assertIntervalCase(6);
    }

    function testBisectionSelectsFirstMismatchAtState31() external {
        _assertIntervalCase(7);
    }

    function testBisectionSelectsFirstMismatchAtState32() external {
        _assertIntervalCase(8);
    }

    function testBisectionSelectsFirstMismatchAtState47() external {
        _assertIntervalCase(9);
    }

    function testBisectionSelectsFirstMismatchAtState62() external {
        _assertIntervalCase(10);
    }

    function testBisectionSelectsFirstMismatchAtState63() external {
        _assertIntervalCase(11);
    }

    function testTwoClaimsCanHoldIndependentSimultaneousGames() external {
        BisectClaimRegistry.ClaimSubmission memory submission = _canonicalSubmission();
        address firstProver = address(0xA001);
        address secondProver = address(0xA002);
        vm.deal(firstProver, BOND);
        vm.deal(secondProver, BOND);
        vm.prank(firstProver);
        uint256 first = registry.submitClaim{ value: BOND }(submission);
        vm.prank(secondProver);
        uint256 second = registry.submitClaim{ value: BOND }(submission);

        _openIntervalCase(first, 0);
        _openIntervalCase(second, 8);
        require(registry.activeGameNumber(first) == 1 && registry.activeGameNumber(second) == 1);
        require(registry.getClaim(first).status == BisectClaimRegistry.ClaimStatus.GAME_ACTIVE);
        require(registry.getClaim(second).status == BisectClaimRegistry.ClaimStatus.GAME_ACTIVE);
        require(registry.totalLockedBonds() == 4 * BOND, "each game owns its two bonds");
        require(registry.totalCredits() == 0 && registry.accountingInvariantHolds());
    }

    function testForcedEtherIsUnallocatedSurplus() external {
        address forceSender = address(0xF0CE);
        vm.etch(forceSender, abi.encodePacked(hex"73", bytes20(address(registry)), hex"ff"));
        vm.deal(forceSender, 0.25 ether);
        (bool success,) = forceSender.call("");
        require(success, "selfdestruct bytecode transfers forced ETH");
        require(address(registry).balance == 0.25 ether, "forced value reached registry");
        require(registry.totalLiabilities() == 0, "forced value creates no liability");
        require(registry.totalCredits() == 0 && registry.totalLockedBonds() == 0);
        require(registry.accountingInvariantHolds(), "surplus does not break solvency");
    }

    function testProductionRegistryWithdrawalFailureAndReentrancy() external {
        BisectClaimRegistry.ClaimSubmission memory submission = _canonicalSubmission();
        Phase7RejectingWallet rejecting = new Phase7RejectingWallet(registry);
        vm.deal(address(rejecting), BOND);
        rejecting.submit{ value: BOND }(submission);
        BisectClaimRegistry.Claim memory claim = registry.getClaim(1);
        vm.roll(claim.challengeDeadline + 1);
        registry.finalize(1);

        vm.expectRevert(BisectClaimRegistry.WithdrawalFailed.selector);
        rejecting.withdraw();
        require(registry.withdrawableCredit(address(rejecting)) == BOND);
        require(registry.accountingInvariantHolds(), "failed transfer rolls back accounting");

        Phase7ReentrantWallet reentrant = new Phase7ReentrantWallet(registry);
        vm.deal(address(reentrant), BOND);
        reentrant.submit{ value: BOND }(submission);
        claim = registry.getClaim(2);
        vm.roll(claim.challengeDeadline + 1);
        registry.finalize(2);
        reentrant.withdraw();

        require(reentrant.reentryBlocked(), "ReentrancyGuard blocks callback withdrawal");
        require(reentrant.received() == BOND, "callback receives one exact withdrawal");
        require(registry.withdrawableCredit(address(reentrant)) == 0);
        require(registry.totalLiabilities() == BOND, "only rejecting wallet credit remains");
        require(registry.accountingInvariantHolds(), "production withdrawal remains solvent");
    }

    function testNonexistentChallengeAndTimeoutCannotAssignFunds() external {
        BisectClaimRegistry.EndpointProof memory initial =
            _endpointProof(disputeJson, "$.challenger.initial");
        vm.expectRevert(abi.encodeWithSelector(BisectClaimRegistry.UnknownClaim.selector, 999));
        vm.prank(CHALLENGER);
        registry.challenge{ value: BOND }(
            999, vm.parseJsonBytes32(disputeJson, "$.challenger.traceRoot"), initial
        );

        vm.expectRevert(abi.encodeWithSelector(BisectClaimRegistry.UnknownClaim.selector, 999));
        registry.claimTimeout(999, 1);
        require(address(registry).balance == 0);
        require(registry.totalLiabilities() == 0 && registry.totalCredits() == 0);
        require(registry.accountingInvariantHolds());
    }

    function _canonicalSubmission()
        private
        view
        returns (BisectClaimRegistry.ClaimSubmission memory submission)
    {
        submission.program = vm.parseJsonBytes(securityJson, "$.program");
        submission.publicInput =
            abi.decode(vm.parseJsonBytes(securityJson, "$.publicInputAbiEncoded"), (uint64[8]));
        submission.transitionCount = uint16(vm.parseJsonUint(securityJson, "$.transitionCount"));
        submission.traceRoot = vm.parseJsonBytes32(securityJson, "$.canonicalTraceRoot");
        submission.claimedOutput = 42;
        submission.initialProof = _endpointProof(securityJson, "$.canonicalInitial");
        submission.finalProof = _endpointProof(securityJson, "$.canonicalTerminal");
    }

    function _endpointProof(string memory json, string memory path)
        private
        pure
        returns (BisectClaimRegistry.EndpointProof memory proof)
    {
        bytes memory encoded = vm.parseJsonBytes(json, string.concat(path, ".stateAbiEncoded"));
        (proof.state.pc, proof.state.halted, proof.state.registers) =
            abi.decode(encoded, (uint16, bool, uint64[8]));
        proof.siblings = vm.parseJsonBytes32Array(json, string.concat(path, ".siblingsBottomUp"));
    }

    function _assertIntervalCase(uint256 index) private {
        BisectClaimRegistry.ClaimSubmission memory submission = _canonicalSubmission();
        string memory casePath = _casePath(index);
        submission.traceRoot =
            vm.parseJsonBytes32(securityJson, string.concat(casePath, ".challengerRoot"));
        submission.initialProof = _endpointProof(securityJson, string.concat(casePath, ".initial"));
        submission.finalProof =
            _endpointProof(securityJson, string.concat(casePath, ".challengerTerminalState"));
        require(
            submission.finalProof.state.halted
                && submission.finalProof.state.registers[0] == submission.claimedOutput,
            "fraudulent trace retains the correct final output"
        );
        address prover = address(0xBEEF);
        vm.deal(prover, BOND);
        vm.prank(prover);
        uint256 claimId = registry.submitClaim{ value: BOND }(submission);
        vm.prank(CHALLENGER);
        registry.challenge{ value: BOND }(
            claimId,
            vm.parseJsonBytes32(securityJson, "$.canonicalTraceRoot"),
            _endpointProof(securityJson, "$.canonicalInitial")
        );

        for (uint256 round = 0; round < 6; ++round) {
            string memory roundPath = string.concat(casePath, ".rounds[", vm.toString(round), "]");
            bytes32[] memory fraudulentChildren = vm.parseJsonBytes32Array(
                securityJson, string.concat(roundPath, ".challengerChildren")
            );
            bytes32[] memory canonicalChildren = vm.parseJsonBytes32Array(
                securityJson, string.concat(roundPath, ".proverChildren")
            );
            require(fraudulentChildren.length == 2 && canonicalChildren.length == 2);
            vm.prank(prover);
            registry.revealChildren(claimId, 1, fraudulentChildren[0], fraudulentChildren[1]);
            vm.prank(CHALLENGER);
            registry.revealChildren(claimId, 1, canonicalChildren[0], canonicalChildren[1]);
        }

        BisectDisputeRegistryV1.Game memory game = registry.getGame(claimId, 1);
        require(game.phase == BisectDisputeRegistryV1.GamePhase.TERMINAL);
        require(
            game.differentIndex
                == vm.parseJsonUint(
                    securityJson, string.concat(casePath, ".expectedDifferentIndex")
                ),
            "bisection selected an incorrect mismatch index"
        );
        vm.prank(CHALLENGER);
        registry.revealTerminal(
            claimId, 1, _transitionProof(securityJson, string.concat(casePath, ".proverTerminal"))
        );
        vm.prank(prover);
        registry.revealTerminal(
            claimId,
            1,
            _transitionProof(securityJson, string.concat(casePath, ".challengerTerminal"))
        );

        game = registry.getGame(claimId, 1);
        require(game.settled && game.phase == BisectDisputeRegistryV1.GamePhase.CLOSED);
        require(
            game.outcome == BisectDisputeRegistryV1.GameOutcome.PROVER_TRANSITION_INVALID,
            "same-output intermediate fraud is refuted"
        );
        require(registry.getClaim(claimId).status == BisectClaimRegistry.ClaimStatus.REFUTED);
        require(registry.withdrawableCredit(CHALLENGER) == 2 * BOND);
        require(registry.withdrawableCredit(prover) == 0);
        require(registry.totalLockedBonds() == 0);
        require(registry.totalCredits() == 2 * BOND);
        require(registry.accountingInvariantHolds());
    }

    function _openIntervalCase(uint256 claimId, uint256 index) private {
        string memory casePath = _casePath(index);
        BisectClaimRegistry.EndpointProof memory initial =
            _endpointProof(securityJson, string.concat(casePath, ".initial"));
        vm.prank(CHALLENGER);
        registry.challenge{ value: BOND }(
            claimId,
            vm.parseJsonBytes32(securityJson, string.concat(casePath, ".challengerRoot")),
            initial
        );
    }

    function _casePath(uint256 index) private pure returns (string memory) {
        return string.concat("$.intervalCases[", vm.toString(index), "]");
    }

    function _transitionProof(string memory json, string memory path)
        private
        pure
        returns (BisectVerifier.TransitionProof memory proof)
    {
        proof.program = vm.parseJsonBytes(json, string.concat(path, ".program"));
        proof.publicInput = abi.decode(
            vm.parseJsonBytes(json, string.concat(path, ".publicInputAbiEncoded")), (uint64[8])
        );
        proof.transitionCount =
            uint16(vm.parseJsonUint(json, string.concat(path, ".transitionCount")));
        proof.traceRoot = vm.parseJsonBytes32(json, string.concat(path, ".traceRoot"));
        proof.stateIndex = uint16(vm.parseJsonUint(json, string.concat(path, ".stateIndex")));
        proof.predecessor = _state(json, string.concat(path, ".predecessor.stateAbiEncoded"));
        proof.predecessorSiblings =
            vm.parseJsonBytes32Array(json, string.concat(path, ".predecessor.siblingsBottomUp"));
        proof.claimedSuccessor =
            _state(json, string.concat(path, ".claimedSuccessor.stateAbiEncoded"));
        proof.successorSiblings = vm.parseJsonBytes32Array(
            json, string.concat(path, ".claimedSuccessor.siblingsBottomUp")
        );
    }

    function _state(string memory json, string memory path)
        private
        pure
        returns (BisectVerifier.State memory state)
    {
        (state.pc, state.halted, state.registers) =
            abi.decode(vm.parseJsonBytes(json, path), (uint16, bool, uint64[8]));
    }
}

contract Phase7DisputeHandler {
    VmPhase7 private constant vm =
        VmPhase7(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant BOND = 1 ether;
    BisectDisputeRegistryV1 private immutable registry;
    Phase7ProverActor[2] private provers;
    bytes32 private immutable challengerRoot;
    BisectClaimRegistry.EndpointProof private challengerInitial;
    bytes32[24] private roundChildren;
    BisectVerifier.TransitionProof private challengerTerminal;
    BisectVerifier.TransitionProof private proverTerminal;
    uint256 public withdrawn;

    constructor(
        BisectDisputeRegistryV1 registry_,
        Phase7ProverActor firstProver,
        Phase7ProverActor secondProver
    ) {
        registry = registry_;
        provers[0] = firstProver;
        provers[1] = secondProver;

        string memory json = vm.readFile("test/vectors/dispute-v1.json");
        challengerRoot = vm.parseJsonBytes32(json, "$.challenger.traceRoot");
        challengerInitial = _endpointProof(json, "$.challenger.initial");
        challengerTerminal = _transitionProof(json, "$.challenger.terminalTransition");
        proverTerminal = _transitionProof(json, "$.prover.terminalTransition");
        for (uint256 round = 0; round < 6; ++round) {
            string memory path = string.concat("$.rounds[", vm.toString(round), "]");
            bytes32[] memory proposerPair =
                vm.parseJsonBytes32Array(json, string.concat(path, ".proverChildren"));
            bytes32[] memory challengerPair =
                vm.parseJsonBytes32Array(json, string.concat(path, ".challengerChildren"));
            for (uint256 child = 0; child < 2; ++child) {
                roundChildren[round * 4 + child] = proposerPair[child];
                roundChildren[round * 4 + 2 + child] = challengerPair[child];
            }
        }
    }

    receive() external payable {
        withdrawn += msg.value;
    }

    function start(uint8 selector) external {
        uint256 claimId = uint256(selector % 2) + 1;
        if (
            registry.latestGameNumber(claimId) != 0 || registry.activeGameNumber(claimId) != 0
                || address(this).balance < BOND
        ) return;
        BisectClaimRegistry.Claim memory claim = registry.getClaim(claimId);
        if (
            claim.status != BisectClaimRegistry.ClaimStatus.OPEN
                || block.number > claim.challengeDeadline
        ) return;
        try registry.challenge{ value: BOND }(claimId, challengerRoot, challengerInitial) { }
            catch { }
    }

    function advance(uint8 selector) external {
        uint256 claimId = uint256(selector % 2) + 1;
        Phase7ProverActor prover = provers[claimId - 1];
        for (uint256 action = 0; action < 14; ++action) {
            uint256 gameNumber = registry.activeGameNumber(claimId);
            if (gameNumber == 0) return;
            BisectDisputeRegistryV1.Game memory game = registry.getGame(claimId, gameNumber);
            if (block.number > game.deadlineBlock) return;

            if (game.phase == BisectDisputeRegistryV1.GamePhase.BISECTION) {
                uint256 round = 6 - game.subtreeHeight;
                if (round >= 6) return;
                uint256 pairOffset = round * 4;
                if (game.expectedResponder == address(prover)) {
                    try prover.revealChildren(
                        claimId,
                        gameNumber,
                        roundChildren[pairOffset],
                        roundChildren[pairOffset + 1]
                    ) { }
                    catch {
                        return;
                    }
                } else if (game.expectedResponder == address(this)) {
                    try registry.revealChildren(
                        claimId,
                        gameNumber,
                        roundChildren[pairOffset + 2],
                        roundChildren[pairOffset + 3]
                    ) { }
                    catch {
                        return;
                    }
                } else {
                    return;
                }
            } else if (game.phase == BisectDisputeRegistryV1.GamePhase.TERMINAL) {
                if (game.expectedResponder == address(this)) {
                    try registry.revealTerminal(claimId, gameNumber, challengerTerminal) { }
                    catch {
                        return;
                    }
                } else if (game.expectedResponder == address(prover)) {
                    try prover.revealTerminal(claimId, gameNumber, proverTerminal) { }
                    catch {
                        return;
                    }
                } else {
                    return;
                }
            } else {
                return;
            }
        }
    }

    function timeout(uint8 selector) external {
        uint256 claimId = uint256(selector % 2) + 1;
        uint256 gameNumber = registry.activeGameNumber(claimId);
        if (gameNumber == 0) return;
        BisectDisputeRegistryV1.Game memory game = registry.getGame(claimId, gameNumber);
        if (block.number <= game.deadlineBlock) return;
        try registry.claimTimeout(claimId, gameNumber) { } catch { }
    }

    function advanceBlocks(uint8 selector) external {
        vm.roll(block.number + (uint256(selector) % 8));
    }

    function finalize(uint8 selector) external {
        uint256 claimId = uint256(selector % 2) + 1;
        try registry.finalize(claimId) { } catch { }
    }

    function withdraw(uint8 selector) external {
        uint256 participant = uint256(selector % 3);
        if (participant < 2) {
            provers[participant].withdraw();
        } else {
            try registry.withdraw() { } catch { }
        }
    }

    function repeatClosedGame(uint8 selector) external {
        uint256 claimId = uint256(selector % 2) + 1;
        uint256 gameNumber = registry.latestGameNumber(claimId);
        if (gameNumber == 0 || registry.activeGameNumber(claimId) != 0) return;
        try registry.claimTimeout(claimId, gameNumber) { } catch { }
        try registry.revealTerminal(claimId, gameNumber, proverTerminal) { } catch { }
    }

    function _endpointProof(string memory json, string memory path)
        private
        pure
        returns (BisectClaimRegistry.EndpointProof memory proof)
    {
        bytes memory encoded = vm.parseJsonBytes(json, string.concat(path, ".stateAbiEncoded"));
        (proof.state.pc, proof.state.halted, proof.state.registers) =
            abi.decode(encoded, (uint16, bool, uint64[8]));
        proof.siblings = vm.parseJsonBytes32Array(json, string.concat(path, ".siblingsBottomUp"));
    }

    function _transitionProof(string memory json, string memory path)
        private
        pure
        returns (BisectVerifier.TransitionProof memory proof)
    {
        proof.program = vm.parseJsonBytes(json, string.concat(path, ".program"));
        proof.publicInput = abi.decode(
            vm.parseJsonBytes(json, string.concat(path, ".publicInputAbiEncoded")), (uint64[8])
        );
        proof.transitionCount =
            uint16(vm.parseJsonUint(json, string.concat(path, ".transitionCount")));
        proof.traceRoot = vm.parseJsonBytes32(json, string.concat(path, ".traceRoot"));
        proof.stateIndex = uint16(vm.parseJsonUint(json, string.concat(path, ".stateIndex")));
        proof.predecessor = _state(json, string.concat(path, ".predecessor.stateAbiEncoded"));
        proof.predecessorSiblings =
            vm.parseJsonBytes32Array(json, string.concat(path, ".predecessor.siblingsBottomUp"));
        proof.claimedSuccessor =
            _state(json, string.concat(path, ".claimedSuccessor.stateAbiEncoded"));
        proof.successorSiblings = vm.parseJsonBytes32Array(
            json, string.concat(path, ".claimedSuccessor.siblingsBottomUp")
        );
    }

    function _state(string memory json, string memory path)
        private
        pure
        returns (BisectVerifier.State memory state)
    {
        (state.pc, state.halted, state.registers) =
            abi.decode(vm.parseJsonBytes(json, path), (uint16, bool, uint64[8]));
    }
}

contract Phase7DisputeInvariantTest {
    VmPhase7 private constant vm =
        VmPhase7(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant BOND = 1 ether;
    BisectDisputeRegistryV1 private registry;
    Phase7ProverActor private firstProver;
    Phase7ProverActor private secondProver;
    Phase7DisputeHandler private handler;
    address private handlerTarget;

    function setUp() external {
        registry = new BisectDisputeRegistryV1(uint96(BOND), 5, 3);
        firstProver = new Phase7ProverActor(registry);
        secondProver = new Phase7ProverActor(registry);
        string memory json = vm.readFile("test/vectors/dispute-v1.json");
        BisectClaimRegistry.ClaimSubmission memory submission;
        submission.program = vm.parseJsonBytes(json, "$.program");
        submission.publicInput =
            abi.decode(vm.parseJsonBytes(json, "$.publicInputAbiEncoded"), (uint64[8]));
        submission.transitionCount = uint16(vm.parseJsonUint(json, "$.transitionCount"));
        submission.traceRoot = vm.parseJsonBytes32(json, "$.prover.traceRoot");
        submission.claimedOutput = uint64(vm.parseJsonUint(json, "$.claimedOutput"));
        submission.initialProof = _endpointProof(json, "$.prover.initial");
        submission.finalProof = _endpointProof(json, "$.prover.terminal");

        vm.deal(address(firstProver), BOND);
        vm.deal(address(secondProver), BOND);
        firstProver.submit{ value: BOND }(submission);
        secondProver.submit{ value: BOND }(submission);

        handler = new Phase7DisputeHandler(registry, firstProver, secondProver);
        vm.deal(address(handler), 2 * BOND);
        handlerTarget = address(handler);
    }

    function targetContracts() external view returns (address[] memory targets) {
        targets = new address[](1);
        targets[0] = handlerTarget;
    }

    function invariantProductionDisputesConserveEveryWeiAndCloseOnce() external view {
        uint256 expectedLocked;
        uint256[2] memory expectedProverAccrued;
        uint256 expectedChallengerAccrued;
        for (uint256 claimId = 1; claimId <= 2; ++claimId) {
            BisectClaimRegistry.Claim memory claim = registry.getClaim(claimId);
            if (claim.proposerBondLocked) expectedLocked += BOND;

            uint256 active = registry.activeGameNumber(claimId);
            uint256 latest = registry.latestGameNumber(claimId);
            require(latest <= 1, "handler never reopens a closed game");
            if (active != 0) {
                require(active == latest, "active game is the latest unique game");
                require(claim.status == BisectClaimRegistry.ClaimStatus.GAME_ACTIVE);
                BisectDisputeRegistryV1.Game memory activeGame = registry.getGame(claimId, active);
                require(
                    !activeGame.settled
                        && activeGame.phase != BisectDisputeRegistryV1.GamePhase.CLOSED
                );
                require(activeGame.challengerBondLocked, "active challenger bond remains assigned");
                expectedLocked += BOND;
            } else {
                require(claim.status != BisectClaimRegistry.ClaimStatus.GAME_ACTIVE);
            }

            if (latest != 0) {
                BisectDisputeRegistryV1.Game memory game = registry.getGame(claimId, latest);
                if (active == 0) {
                    require(game.settled && game.phase == BisectDisputeRegistryV1.GamePhase.CLOSED);
                } else {
                    require(!game.settled && game.phase != BisectDisputeRegistryV1.GamePhase.CLOSED);
                }
                if (game.settled) {
                    require(game.phase == BisectDisputeRegistryV1.GamePhase.CLOSED);
                    require(!game.challengerBondLocked && active == 0);
                    if (
                        game.outcome
                                == BisectDisputeRegistryV1.GameOutcome.PROVER_TRANSITION_INVALID
                            || game.outcome == BisectDisputeRegistryV1.GameOutcome.PROVER_TIMEOUT
                            || game.outcome
                                == BisectDisputeRegistryV1.GameOutcome
                                    .TERMINAL_COMMITMENT_INCONSISTENCY
                    ) {
                        require(claim.status == BisectClaimRegistry.ClaimStatus.REFUTED);
                        require(!claim.proposerBondLocked);
                        expectedChallengerAccrued += 2 * BOND;
                    } else {
                        require(
                            claim.status == BisectClaimRegistry.ClaimStatus.OPEN
                                || claim.status == BisectClaimRegistry.ClaimStatus.FINALIZED
                        );
                        require(
                            claim.proposerBondLocked
                                || claim.status == BisectClaimRegistry.ClaimStatus.FINALIZED
                        );
                        expectedProverAccrued[claimId - 1] += BOND;
                    }
                }
            }

            if (claim.status == BisectClaimRegistry.ClaimStatus.FINALIZED) {
                require(!claim.proposerBondLocked && active == 0);
                expectedProverAccrued[claimId - 1] += BOND;
            }

            // All valid claim rewards for this invariant setup belong only to the named actors.
        }

        uint256 participantCredits = registry.withdrawableCredit(address(firstProver))
            + registry.withdrawableCredit(address(secondProver))
            + registry.withdrawableCredit(address(handler));
        uint256 participantWithdrawn =
            firstProver.withdrawn() + secondProver.withdrawn() + handler.withdrawn();
        require(
            participantCredits == registry.totalCredits(), "credits have no foreign beneficiary"
        );
        require(
            registry.withdrawableCredit(address(firstProver)) + firstProver.withdrawn()
                == expectedProverAccrued[0],
            "first prover receives only its claim rewards"
        );
        require(
            registry.withdrawableCredit(address(secondProver)) + secondProver.withdrawn()
                == expectedProverAccrued[1],
            "second prover receives only its claim rewards"
        );
        require(
            registry.withdrawableCredit(address(handler)) + handler.withdrawn()
                == expectedChallengerAccrued,
            "challenger receives only dispute rewards"
        );
        require(
            participantCredits + participantWithdrawn
                == expectedProverAccrued[0] + expectedProverAccrued[1] + expectedChallengerAccrued,
            "settlement conserves exact wei"
        );
        require(
            registry.totalLockedBonds() == expectedLocked, "each locked bond has one obligation"
        );
        require(
            registry.totalLiabilities() == registry.totalLockedBonds() + registry.totalCredits()
        );
        require(address(registry).balance >= registry.totalLiabilities(), "liabilities are solvent");
    }

    function _endpointProof(string memory json, string memory path)
        private
        pure
        returns (BisectClaimRegistry.EndpointProof memory proof)
    {
        (proof.state.pc, proof.state.halted, proof.state.registers) = abi.decode(
            vm.parseJsonBytes(json, string.concat(path, ".stateAbiEncoded")),
            (uint16, bool, uint64[8])
        );
        proof.siblings = vm.parseJsonBytes32Array(json, string.concat(path, ".siblingsBottomUp"));
    }
}
