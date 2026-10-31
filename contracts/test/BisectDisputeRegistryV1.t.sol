// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { BisectDisputeRegistryV1 } from "../src/BisectDisputeRegistryV1.sol";
import { BisectClaimRegistry } from "../src/BisectClaimRegistry.sol";
import { BisectVerifier } from "../src/BisectVerifier.sol";

interface VmDispute {
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
    function roll(uint256 newHeight) external;
    function prank(address sender) external;
    function expectRevert(bytes4 revertData) external;
    function expectRevert(bytes calldata revertData) external;
}

contract BisectDisputeRegistryV1Test {
    VmDispute private constant vm =
        VmDispute(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant BOND = 1 ether;
    address private constant PROVER = address(0xBEEF);
    address private constant CHALLENGER = address(0xCAFE);
    address private constant SECOND_PROVER = address(0xD00D);
    string private constant VECTOR_PATH = "test/vectors/dispute-v1.json";

    BisectDisputeRegistryV1 private registry;
    string private vectorJson;

    function setUp() external {
        registry = new BisectDisputeRegistryV1(uint96(BOND), 5, 3);
        vectorJson = vm.readFile(VECTOR_PATH);
        vm.deal(PROVER, 20 ether);
        vm.deal(CHALLENGER, 20 ether);
        vm.deal(SECOND_PROVER, 20 ether);
    }

    function testCorrectFinalOutputDoesNotHideDishonestIntermediateTrace() external {
        uint256 claimId = _submit(true, PROVER);
        BisectClaimRegistry.EndpointProof memory proverFinal = _endpointProof("$.prover.terminal");
        BisectClaimRegistry.EndpointProof memory honestFinal =
            _endpointProof("$.challenger.terminal");
        require(proverFinal.state.halted && honestFinal.state.halted, "both endpoints halt");
        require(
            proverFinal.state.registers[0] == 42 && honestFinal.state.registers[0] == 42,
            "same claimed output despite different intermediate trace"
        );
        uint256 gameNumber = _challenge(claimId, true, CHALLENGER, BOND);
        _playBisection(claimId, gameNumber, true);

        BisectDisputeRegistryV1.Game memory game = registry.getGame(claimId, gameNumber);
        require(game.phase == BisectDisputeRegistryV1.GamePhase.TERMINAL, "terminal phase");
        require(game.differentIndex == 1, "leftmost mismatch is state one");

        BisectVerifier.TransitionProof memory challengerProof =
            _transitionProof("$.challenger.terminalTransition");
        BisectVerifier.TransitionProof memory proverProof =
            _transitionProof("$.prover.terminalTransition");
        vm.prank(CHALLENGER);
        registry.revealTerminal(claimId, gameNumber, challengerProof);
        vm.prank(PROVER);
        registry.revealTerminal(claimId, gameNumber, proverProof);

        game = registry.getGame(claimId, gameNumber);
        BisectClaimRegistry.Claim memory claim = registry.getClaim(claimId);
        require(game.settled, "settled once");
        require(
            game.outcome == BisectDisputeRegistryV1.GameOutcome.PROVER_TRANSITION_INVALID,
            "invalid prover transition outcome"
        );
        require(claim.status == BisectClaimRegistry.ClaimStatus.REFUTED, "claim refuted");
        require(!claim.proposerBondLocked, "proposer bond released from locked balance");
        require(registry.withdrawableCredit(CHALLENGER) == 2 * BOND, "both bonds credited");
        require(registry.totalLockedBonds() == 0, "no bond remains locked");
        require(registry.totalCredits() == 2 * BOND, "credits match settled bonds");
        require(registry.accountingInvariantHolds(), "financial invariant holds");

        vm.expectRevert(
            abi.encodeWithSelector(
                BisectDisputeRegistryV1.GameNotActive.selector, claimId, gameNumber
            )
        );
        registry.claimTimeout(claimId, gameNumber);
        vm.expectRevert(abi.encodeWithSelector(BisectClaimRegistry.ClaimNotOpen.selector, claimId));
        registry.finalize(claimId);
    }

    function testDifferentChallengerOutputCannotSlashValidProver() external {
        uint256 claimId = _submit(false, PROVER);
        BisectDisputeRegistryV1.Game memory openedGame;
        uint256 gameNumber;
        vm.prank(CHALLENGER);
        gameNumber = registry.challenge{ value: BOND }(
            claimId,
            vm.parseJsonBytes32(vectorJson, "$.differentOutput.traceRoot"),
            _endpointProof("$.differentOutput.initial")
        );

        for (uint256 round = 0; round < 6; ++round) {
            string memory prefix =
                string.concat("$.differentOutput.rounds[", vm.toString(round), "]");
            bytes32[] memory proverChildren =
                vm.parseJsonBytes32Array(vectorJson, string.concat(prefix, ".proverChildren"));
            bytes32[] memory challengerChildren =
                vm.parseJsonBytes32Array(vectorJson, string.concat(prefix, ".challengerChildren"));
            require(proverChildren.length == 2 && challengerChildren.length == 2, "ordered pairs");
            vm.prank(PROVER);
            registry.revealChildren(claimId, gameNumber, proverChildren[0], proverChildren[1]);
            vm.prank(CHALLENGER);
            registry.revealChildren(
                claimId, gameNumber, challengerChildren[0], challengerChildren[1]
            );
        }

        openedGame = registry.getGame(claimId, gameNumber);
        require(openedGame.differentIndex == 63, "only final committed state differs");
        BisectClaimRegistry.EndpointProof memory alternateFinal =
            _endpointProof("$.differentOutput.terminal");
        require(alternateFinal.state.halted && alternateFinal.state.registers[0] == 43);

        vm.prank(CHALLENGER);
        registry.revealTerminal(
            claimId, gameNumber, _transitionProof("$.differentOutput.terminalTransition")
        );
        vm.prank(PROVER);
        registry.revealTerminal(claimId, gameNumber, _transitionProof("$.prover.lastTransition"));

        BisectDisputeRegistryV1.Game memory resolved = registry.getGame(claimId, gameNumber);
        require(
            resolved.outcome == BisectDisputeRegistryV1.GameOutcome.PROVER_TRANSITION_VALID,
            "valid prover wins even though challenger endpoint differs"
        );
        require(registry.withdrawableCredit(PROVER) == BOND, "only challenger bond credited");
        require(registry.totalLockedBonds() == BOND, "prover bond stays locked");
        require(registry.accountingInvariantHolds(), "failed challenge preserves solvency");
    }

    function testHonestProverWinsAgainstDishonestChallengerAndCanFinalize() external {
        uint256 claimId = _submit(false, PROVER);
        uint256 gameNumber = _challenge(claimId, false, CHALLENGER, BOND);
        _playBisection(claimId, gameNumber, false);

        vm.prank(CHALLENGER);
        registry.revealTerminal(
            claimId, gameNumber, _transitionProof("$.prover.terminalTransition")
        );
        vm.prank(PROVER);
        registry.revealTerminal(
            claimId, gameNumber, _transitionProof("$.challenger.terminalTransition")
        );

        BisectDisputeRegistryV1.Game memory game = registry.getGame(claimId, gameNumber);
        require(game.outcome == BisectDisputeRegistryV1.GameOutcome.PROVER_TRANSITION_VALID);
        require(game.settled && registry.activeGameNumber(claimId) == 0, "game closed");
        require(registry.withdrawableCredit(PROVER) == BOND, "challenger bond credited to prover");
        require(registry.totalLockedBonds() == BOND, "prover bond stays locked");
        require(registry.accountingInvariantHolds(), "solvent and accounted");

        BisectClaimRegistry.Claim memory claim = registry.getClaim(claimId);
        vm.expectRevert(
            abi.encodeWithSelector(
                BisectClaimRegistry.ChallengeWindowOpen.selector, claim.challengeDeadline
            )
        );
        registry.finalize(claimId);
        vm.roll(claim.challengeDeadline + 1);
        registry.finalize(claimId);
        claim = registry.getClaim(claimId);
        require(claim.status == BisectClaimRegistry.ClaimStatus.FINALIZED, "claim finalized");
        require(registry.withdrawableCredit(PROVER) == 2 * BOND, "both prover credits available");
        require(registry.totalCredits() == 2 * BOND, "aggregate credit matches balances");
        require(registry.accountingInvariantHolds(), "settlement remains solvent");
    }

    function testRejectsWrongBondOutOfTurnStaleRoundAndMalformedProof() external {
        uint256 claimId = _submit(true, PROVER);
        vm.expectRevert(
            abi.encodeWithSelector(BisectClaimRegistry.IncorrectBond.selector, BOND, BOND - 1)
        );
        _challenge(claimId, true, CHALLENGER, BOND - 1);
        require(registry.totalLiabilities() == BOND, "failed bond is not accounted");

        uint256 gameNumber = _challenge(claimId, true, CHALLENGER, BOND);
        vm.expectRevert(
            abi.encodeWithSelector(BisectDisputeRegistryV1.DuplicateActiveGame.selector, claimId)
        );
        _challenge(claimId, true, CHALLENGER, BOND);
        vm.expectRevert(
            abi.encodeWithSelector(
                BisectDisputeRegistryV1.WrongResponder.selector, PROVER, CHALLENGER
            )
        );
        vm.prank(CHALLENGER);
        registry.revealChildren(claimId, gameNumber, bytes32(0), bytes32(0));

        vm.expectRevert(
            abi.encodeWithSelector(
                BisectDisputeRegistryV1.WrongGameNumber.selector, gameNumber, gameNumber + 1
            )
        );
        vm.prank(PROVER);
        registry.revealChildren(claimId, gameNumber + 1, bytes32(0), bytes32(0));

        (bytes32 badLeft, bytes32 badRight) = _roundChildren(0, true, true);
        vm.expectRevert(BisectDisputeRegistryV1.InvalidChildCommitment.selector);
        vm.prank(PROVER);
        registry.revealChildren(claimId, gameNumber, badRight, badLeft);

        _playBisection(claimId, gameNumber, true);
        BisectVerifier.TransitionProof memory badProof =
            _transitionProof("$.challenger.terminalTransition");
        badProof.successorSiblings[0] = bytes32(uint256(badProof.successorSiblings[0]) ^ 1);
        vm.expectRevert(BisectDisputeRegistryV1.InvalidTerminalEvidence.selector);
        vm.prank(CHALLENGER);
        registry.revealTerminal(claimId, gameNumber, badProof);
        require(registry.activeGameNumber(claimId) == gameNumber, "failed evidence preserves game");
        require(registry.accountingInvariantHolds(), "failed evidence preserves accounting");

        badProof = _transitionProof("$.challenger.terminalTransition");
        badProof.program[0] = bytes1(uint8(badProof.program[0]) ^ 1);
        _expectInvalidTerminalContext(claimId, gameNumber, badProof);
        badProof = _transitionProof("$.challenger.terminalTransition");
        badProof.publicInput[0] = 1;
        _expectInvalidTerminalContext(claimId, gameNumber, badProof);
        badProof = _transitionProof("$.challenger.terminalTransition");
        badProof.transitionCount = 255;
        _expectInvalidTerminalContext(claimId, gameNumber, badProof);
        badProof = _transitionProof("$.challenger.terminalTransition");
        badProof.traceRoot = bytes32(0);
        _expectInvalidTerminalContext(claimId, gameNumber, badProof);
        badProof = _transitionProof("$.challenger.terminalTransition");
        badProof.stateIndex = 1;
        _expectInvalidTerminalContext(claimId, gameNumber, badProof);
    }

    function testTimeoutRulesAndExactDeadlineBoundary() external {
        uint256 challengerTimeoutClaim = _submit(false, PROVER);
        uint256 challengerTimeoutGame = _challenge(challengerTimeoutClaim, false, CHALLENGER, BOND);
        BisectDisputeRegistryV1.Game memory game =
            registry.getGame(challengerTimeoutClaim, challengerTimeoutGame);

        vm.roll(game.deadlineBlock);
        (bytes32 proverLeft, bytes32 proverRight) = _roundChildren(0, false, true);
        vm.prank(PROVER);
        registry.revealChildren(
            challengerTimeoutClaim, challengerTimeoutGame, proverLeft, proverRight
        );
        game = registry.getGame(challengerTimeoutClaim, challengerTimeoutGame);
        require(game.expectedResponder == CHALLENGER, "challenger has next turn");
        vm.expectRevert(
            abi.encodeWithSelector(
                BisectDisputeRegistryV1.TurnDeadlinePassed.selector, game.deadlineBlock
            )
        );
        registry.claimTimeout(challengerTimeoutClaim, challengerTimeoutGame);
        vm.roll(game.deadlineBlock + 1);
        registry.claimTimeout(challengerTimeoutClaim, challengerTimeoutGame);
        require(registry.withdrawableCredit(PROVER) == BOND, "challenger timeout pays prover");
        require(
            registry.getClaim(challengerTimeoutClaim).status
                == BisectClaimRegistry.ClaimStatus.OPEN,
            "challenger timeout keeps claim open"
        );

        uint256 proverTimeoutClaim = _submit(true, SECOND_PROVER);
        uint256 proverTimeoutGame = _challenge(proverTimeoutClaim, true, CHALLENGER, BOND);
        game = registry.getGame(proverTimeoutClaim, proverTimeoutGame);
        vm.roll(game.deadlineBlock + 1);
        registry.claimTimeout(proverTimeoutClaim, proverTimeoutGame);
        require(
            registry.withdrawableCredit(CHALLENGER) == 2 * BOND, "prover timeout pays both bonds"
        );
        require(
            registry.getClaim(proverTimeoutClaim).status == BisectClaimRegistry.ClaimStatus.REFUTED,
            "prover timeout refutes claim"
        );
        require(registry.accountingInvariantHolds(), "both timeout paths remain solvent");
    }

    function testWithheldProverTraceResponseLosesAtTimeoutAndCannotSettleTwice() external {
        uint256 claimId = _submit(true, PROVER);
        uint256 gameNumber = _challenge(claimId, true, CHALLENGER, BOND);
        BisectDisputeRegistryV1.Game memory game = registry.getGame(claimId, gameNumber);
        require(game.expectedResponder == PROVER, "prover must reveal the first trace pair");

        vm.roll(game.deadlineBlock);
        vm.expectRevert(
            abi.encodeWithSelector(
                BisectDisputeRegistryV1.TurnDeadlinePassed.selector, game.deadlineBlock
            )
        );
        registry.claimTimeout(claimId, gameNumber);

        vm.roll(game.deadlineBlock + 1);
        registry.claimTimeout(claimId, gameNumber);
        game = registry.getGame(claimId, gameNumber);
        require(game.outcome == BisectDisputeRegistryV1.GameOutcome.PROVER_TIMEOUT);
        require(game.settled && registry.activeGameNumber(claimId) == 0, "game closes once");
        require(registry.withdrawableCredit(CHALLENGER) == 2 * BOND, "both bonds credited once");
        require(registry.totalLockedBonds() == 0, "no bonds remain locked");

        vm.expectRevert(
            abi.encodeWithSelector(
                BisectDisputeRegistryV1.GameNotActive.selector, claimId, gameNumber
            )
        );
        registry.claimTimeout(claimId, gameNumber);
        require(registry.withdrawableCredit(CHALLENGER) == 2 * BOND, "repeat cannot pay twice");
        require(registry.accountingInvariantHolds(), "withheld-data timeout remains solvent");
    }

    function testChallengeWindowInclusiveAndFinalizationBlockedWhileGameActive() external {
        uint256 claimId = _submit(true, PROVER);
        BisectClaimRegistry.Claim memory claim = registry.getClaim(claimId);
        vm.roll(claim.challengeDeadline);
        uint256 gameNumber = _challenge(claimId, true, CHALLENGER, BOND);
        vm.roll(claim.challengeDeadline + 1);
        vm.expectRevert(abi.encodeWithSelector(BisectClaimRegistry.ActiveGame.selector, claimId));
        registry.finalize(claimId);
        require(registry.activeGameNumber(claimId) == gameNumber, "game survives claim deadline");
        require(registry.totalLockedBonds() == 2 * BOND, "both bonds remain locked");
    }

    function testChallengeRejectsProverSameRootAndNoncanonicalInitialState() external {
        uint256 claimId = _submit(true, PROVER);
        BisectClaimRegistry.EndpointProof memory honestInitial =
            _endpointProof("$.challenger.initial");
        vm.expectRevert(
            abi.encodeWithSelector(BisectDisputeRegistryV1.ProverCannotChallenge.selector, claimId)
        );
        vm.prank(PROVER);
        registry.challenge{ value: BOND }(
            claimId, vm.parseJsonBytes32(vectorJson, "$.challenger.traceRoot"), honestInitial
        );

        vm.expectRevert(BisectDisputeRegistryV1.SameTraceRoot.selector);
        vm.prank(CHALLENGER);
        registry.challenge{ value: BOND }(
            claimId,
            vm.parseJsonBytes32(vectorJson, "$.prover.traceRoot"),
            _endpointProof("$.prover.initial")
        );

        BisectClaimRegistry.EndpointProof memory forgedInitial =
            _endpointProof("$.challenger.initial");
        forgedInitial.siblings[0] = bytes32(uint256(forgedInitial.siblings[0]) ^ 1);
        vm.expectRevert(BisectDisputeRegistryV1.InvalidInitialAgreement.selector);
        vm.prank(CHALLENGER);
        registry.challenge{ value: BOND }(
            claimId, vm.parseJsonBytes32(vectorJson, "$.challenger.traceRoot"), forgedInitial
        );

        honestInitial.state.registers[0] = 1;
        vm.expectRevert(BisectDisputeRegistryV1.InvalidInitialAgreement.selector);
        vm.prank(CHALLENGER);
        registry.challenge{ value: BOND }(
            claimId, vm.parseJsonBytes32(vectorJson, "$.challenger.traceRoot"), honestInitial
        );
        require(registry.totalLockedBonds() == BOND, "rejected openings lock no challenger bond");
        require(registry.withdrawableCredit(CHALLENGER) == 0, "rejected openings create no credit");
        require(registry.accountingInvariantHolds(), "failed openings preserve solvency");
    }

    function testMultipleClaimsHaveIndependentExposureAndStableIds() external {
        uint256 first = _submit(true, PROVER);
        uint256 second = _submit(true, SECOND_PROVER);
        require(first == 1 && second == 2, "monotonic stable claim ids");
        uint256 gameNumber = _challenge(first, true, CHALLENGER, BOND);
        _playBisection(first, gameNumber, true);
        vm.prank(CHALLENGER);
        registry.revealTerminal(
            first, gameNumber, _transitionProof("$.challenger.terminalTransition")
        );
        vm.prank(PROVER);
        registry.revealTerminal(first, gameNumber, _transitionProof("$.prover.terminalTransition"));

        require(
            registry.withdrawableCredit(CHALLENGER) == 2 * BOND, "first dispute settles only first"
        );
        require(registry.totalLockedBonds() == BOND, "second claim bond remains locked");
        require(registry.getClaim(second).proposerBondLocked, "second claim stays isolated");
        require(registry.getClaim(second).status == BisectClaimRegistry.ClaimStatus.OPEN);
        require(registry.accountingInvariantHolds(), "mixed claim liabilities remain solvent");
    }

    function testSuccessfulProverMayBeChallengedAgainWithMonotonicGameNumber() external {
        uint256 claimId = _submit(false, PROVER);
        uint256 firstGame = _challenge(claimId, false, CHALLENGER, BOND);
        _playBisection(claimId, firstGame, false);
        vm.prank(CHALLENGER);
        registry.revealTerminal(claimId, firstGame, _transitionProof("$.prover.terminalTransition"));
        vm.prank(PROVER);
        registry.revealTerminal(
            claimId, firstGame, _transitionProof("$.challenger.terminalTransition")
        );

        uint256 secondGame = _challenge(claimId, false, CHALLENGER, BOND);
        require(firstGame == 1 && secondGame == 2, "game number never reuses a closed id");
        vm.expectRevert(
            abi.encodeWithSelector(
                BisectDisputeRegistryV1.WrongGameNumber.selector, secondGame, firstGame
            )
        );
        vm.prank(PROVER);
        registry.revealChildren(claimId, firstGame, bytes32(0), bytes32(0));
        require(registry.latestGameNumber(claimId) == 2, "latest game stays monotonic");
        require(registry.totalLockedBonds() == 2 * BOND, "new challenger bond is separately locked");
        require(registry.accountingInvariantHolds(), "retries conserve funds");
    }

    function _submit(bool fraudulentProver, address prover) private returns (uint256 claimId) {
        string memory path = fraudulentProver ? "$.prover" : "$.challenger";
        BisectClaimRegistry.ClaimSubmission memory submission;
        submission.program = vm.parseJsonBytes(vectorJson, "$.program");
        submission.publicInput =
            abi.decode(vm.parseJsonBytes(vectorJson, "$.publicInputAbiEncoded"), (uint64[8]));
        submission.transitionCount = uint16(vm.parseJsonUint(vectorJson, "$.transitionCount"));
        submission.traceRoot = vm.parseJsonBytes32(vectorJson, string.concat(path, ".traceRoot"));
        submission.claimedOutput = uint64(vm.parseJsonUint(vectorJson, "$.claimedOutput"));
        submission.initialProof = _endpointProof(string.concat(path, ".initial"));
        submission.finalProof = _endpointProof(string.concat(path, ".terminal"));
        vm.prank(prover);
        claimId = registry.submitClaim{ value: BOND }(submission);
    }

    function _challenge(uint256 claimId, bool challengerHonest, address challenger, uint256 amount)
        private
        returns (uint256 gameNumber)
    {
        string memory path = challengerHonest ? "$.challenger" : "$.prover";
        vm.prank(challenger);
        gameNumber = registry.challenge{ value: amount }(
            claimId,
            vm.parseJsonBytes32(vectorJson, string.concat(path, ".traceRoot")),
            _endpointProof(string.concat(path, ".initial"))
        );
    }

    function _playBisection(uint256 claimId, uint256 gameNumber, bool proverFraudulent) private {
        for (uint256 round = 0; round < 6; ++round) {
            (bytes32 pLeft, bytes32 pRight) = _roundChildren(round, proverFraudulent, true);
            (bytes32 cLeft, bytes32 cRight) = _roundChildren(round, proverFraudulent, false);
            vm.prank(PROVER);
            registry.revealChildren(claimId, gameNumber, pLeft, pRight);
            vm.prank(CHALLENGER);
            registry.revealChildren(claimId, gameNumber, cLeft, cRight);
        }
    }

    function _roundChildren(uint256 round, bool proverFraudulent, bool asProver)
        private
        view
        returns (bytes32 left, bytes32 right)
    {
        string memory party;
        if (asProver) party = proverFraudulent ? "prover" : "challenger";
        else party = proverFraudulent ? "challenger" : "prover";
        string memory path = string.concat("$.rounds[", vm.toString(round), "].", party, "Children");
        bytes32[] memory children = vm.parseJsonBytes32Array(vectorJson, path);
        require(children.length == 2, "each child commitment pair has two hashes");
        left = children[0];
        right = children[1];
    }

    function _endpointProof(string memory path)
        private
        view
        returns (BisectClaimRegistry.EndpointProof memory proof)
    {
        bytes memory encoded =
            vm.parseJsonBytes(vectorJson, string.concat(path, ".stateAbiEncoded"));
        (proof.state.pc, proof.state.halted, proof.state.registers) =
            abi.decode(encoded, (uint16, bool, uint64[8]));
        proof.siblings =
            vm.parseJsonBytes32Array(vectorJson, string.concat(path, ".siblingsBottomUp"));
    }

    function _transitionProof(string memory path)
        private
        view
        returns (BisectVerifier.TransitionProof memory proof)
    {
        proof.program = vm.parseJsonBytes(vectorJson, string.concat(path, ".program"));
        proof.publicInput = abi.decode(
            vm.parseJsonBytes(vectorJson, string.concat(path, ".publicInputAbiEncoded")),
            (uint64[8])
        );
        proof.transitionCount =
            uint16(vm.parseJsonUint(vectorJson, string.concat(path, ".transitionCount")));
        proof.traceRoot = vm.parseJsonBytes32(vectorJson, string.concat(path, ".traceRoot"));
        proof.stateIndex = uint16(vm.parseJsonUint(vectorJson, string.concat(path, ".stateIndex")));
        proof.predecessor = _state(string.concat(path, ".predecessor.stateAbiEncoded"));
        proof.predecessorSiblings = vm.parseJsonBytes32Array(
            vectorJson, string.concat(path, ".predecessor.siblingsBottomUp")
        );
        proof.claimedSuccessor = _state(string.concat(path, ".claimedSuccessor.stateAbiEncoded"));
        proof.successorSiblings = vm.parseJsonBytes32Array(
            vectorJson, string.concat(path, ".claimedSuccessor.siblingsBottomUp")
        );
    }

    function _expectInvalidTerminalContext(
        uint256 claimId,
        uint256 gameNumber,
        BisectVerifier.TransitionProof memory proof
    ) private {
        vm.expectRevert(BisectDisputeRegistryV1.InvalidTerminalEvidence.selector);
        vm.prank(CHALLENGER);
        registry.revealTerminal(claimId, gameNumber, proof);
    }

    function _state(string memory path) private view returns (BisectVerifier.State memory state) {
        bytes memory encoded = vm.parseJsonBytes(vectorJson, path);
        (state.pc, state.halted, state.registers) = abi.decode(encoded, (uint16, bool, uint64[8]));
    }
}
