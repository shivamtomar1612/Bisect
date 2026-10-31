// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { BisectClaimRegistry } from "./BisectClaimRegistry.sol";
import { BisectVerifier } from "./BisectVerifier.sol";

/// @notice Non-upgradeable v1 claim registry with an ordered Merkle bisection game.
/// @dev Bisection semantics follow docs/dispute-state-machine.md: parties reveal ordered child
///      hashes, the leftmost differing leaf is selected, and the prover transition is verified.
contract BisectDisputeRegistryV1 is BisectClaimRegistry {
    enum GamePhase {
        NONE,
        BISECTION,
        TERMINAL,
        CLOSED
    }

    enum GameOutcome {
        NONE,
        PROVER_TRANSITION_VALID,
        CHALLENGER_TIMEOUT,
        PROVER_TRANSITION_INVALID,
        PROVER_TIMEOUT,
        TERMINAL_COMMITMENT_INCONSISTENCY
    }

    struct Game {
        GamePhase phase;
        GameOutcome outcome;
        address challenger;
        bytes32 challengerRoot;
        uint256 deadlineBlock;
        uint16 subtreeBaseIndex;
        uint16 subtreeHeight;
        bytes32 proverNode;
        bytes32 challengerNode;
        bytes32 pendingProverLeft;
        bytes32 pendingProverRight;
        bool proverChildrenRevealed;
        address expectedResponder;
        uint16 differentIndex;
        bytes32 selectedProverLeaf;
        bytes32 selectedChallengerLeaf;
        bool challengerBondLocked;
        bool settled;
        bool challengerTerminalRevealed;
        BisectVerifier.State challengerPreviousState;
        BisectVerifier.State challengerNextState;
    }

    error DuplicateActiveGame(uint256 claimId);
    error ChallengeWindowClosed(uint256 deadline);
    error ProverCannotChallenge(uint256 claimId);
    error SameTraceRoot();
    error InvalidInitialAgreement();
    error UnknownGame(uint256 claimId, uint256 gameNumber);
    error WrongGameNumber(uint256 expected, uint256 actual);
    error GameNotActive(uint256 claimId, uint256 gameNumber);
    error WrongGamePhase(GamePhase expected, GamePhase actual);
    error WrongResponder(address expected, address actual);
    error TurnDeadlinePassed(uint256 deadline);
    error InvalidChildCommitment();
    error NoDifferingChild();
    error InvalidDisagreementIndex();
    error InvalidTerminalEvidence();
    error ChallengerTerminalEvidenceMissing();
    error InvalidFinancialState();

    event ChallengeStarted(
        uint256 indexed claimId,
        uint256 indexed gameNumber,
        address indexed challenger,
        bytes32 challengerRoot,
        uint16 initialHeight,
        address expectedResponder,
        uint256 deadlineBlock,
        uint96 bondWei
    );
    event DisputeChildrenRevealed(
        uint256 indexed claimId,
        uint256 indexed gameNumber,
        address indexed responder,
        bytes32 leftChild,
        bytes32 rightChild,
        address nextResponder,
        uint256 nextDeadlineBlock
    );
    event BisectionLevelResolved(
        uint256 indexed claimId,
        uint256 indexed gameNumber,
        uint16 subtreeBaseIndex,
        uint16 subtreeHeight,
        bytes32 proverNode,
        bytes32 challengerNode,
        uint16 differentIndex,
        address expectedResponder,
        uint256 deadlineBlock
    );
    event TerminalEvidenceRevealed(
        uint256 indexed claimId,
        uint256 indexed gameNumber,
        address indexed responder,
        uint16 differentIndex,
        bytes32 previousStateHash,
        bytes32 nextLeafHash,
        address nextResponder,
        uint256 nextDeadlineBlock
    );
    event GameResolved(
        uint256 indexed claimId,
        uint256 indexed gameNumber,
        GameOutcome outcome,
        address indexed winner,
        uint16 differentIndex,
        ClaimStatus claimStatus,
        uint256 proverBondCreditWei,
        uint256 challengerBondCreditWei
    );
    event GameTimedOut(
        uint256 indexed claimId,
        uint256 indexed gameNumber,
        address indexed missedResponder,
        GameOutcome outcome,
        address winner
    );
    event GameBondCredited(
        uint256 indexed claimId,
        uint256 indexed gameNumber,
        address indexed beneficiary,
        uint256 amountWei,
        GameOutcome outcome
    );

    mapping(uint256 claimId => uint256 gameNumber) public latestGameNumber;
    mapping(uint256 claimId => uint256 gameNumber) public activeGameNumber;
    mapping(uint256 claimId => mapping(uint256 gameNumber => Game game)) private _games;

    constructor(uint96 bondWei_, uint32 challengeWindowBlocks_, uint32 turnWindowBlocks_)
        BisectClaimRegistry(bondWei_, challengeWindowBlocks_, turnWindowBlocks_)
    { }

    /// @notice Submit a canonical-context claim and lock exactly the configured prover bond.
    function submitClaim(ClaimSubmission calldata submission)
        public
        payable
        override
        returns (uint256 claimId)
    {
        return _submitClaim(submission);
    }

    /// @notice Open one bonded game against an eligible claim.
    /// @dev The locked v1 admission witness is a different context-bound trace root plus a proof
    ///      of the canonical index-zero state. The bisection turns authenticate the differing leaf.
    function challenge(uint256 claimId, bytes32 challengerRoot, EndpointProof calldata initialProof)
        external
        payable
        returns (uint256 gameNumber)
    {
        if (msg.value != bondWei) revert IncorrectBond(bondWei, msg.value);
        Claim storage claim = _requireClaim(claimId);
        if (claim.status != ClaimStatus.OPEN) {
            if (claim.status == ClaimStatus.GAME_ACTIVE) revert DuplicateActiveGame(claimId);
            revert ClaimNotOpen(claimId);
        }
        if (activeGameNumber[claimId] != 0) revert DuplicateActiveGame(claimId);
        if (block.number > claim.challengeDeadline) {
            revert ChallengeWindowClosed(claim.challengeDeadline);
        }
        if (msg.sender == claim.prover) revert ProverCannotChallenge(claimId);
        if (challengerRoot == claim.traceRoot) revert SameTraceRoot();
        if (
            !_isCanonicalInitialState(initialProof.state, claim.publicInput)
                || !BisectVerifier.verifyStateProof(
                    challengerRoot,
                    claim.contextHash,
                    0,
                    initialProof.state,
                    initialProof.siblings,
                    claim.transitionCount
                )
        ) revert InvalidInitialAgreement();

        uint16 height = _proofDepth(claim.transitionCount);
        gameNumber = latestGameNumber[claimId] + 1;
        latestGameNumber[claimId] = gameNumber;
        activeGameNumber[claimId] = gameNumber;

        Game storage game = _games[claimId][gameNumber];
        game.phase = GamePhase.BISECTION;
        game.challenger = msg.sender;
        game.challengerRoot = challengerRoot;
        game.deadlineBlock = block.number + turnWindowBlocks;
        game.subtreeHeight = height;
        game.proverNode = claim.traceRoot;
        game.challengerNode = challengerRoot;
        game.expectedResponder = claim.prover;
        game.challengerBondLocked = true;

        claim.status = ClaimStatus.GAME_ACTIVE;
        _recordIncomingBond();

        emit ChallengeStarted(
            claimId,
            gameNumber,
            msg.sender,
            challengerRoot,
            height,
            claim.prover,
            game.deadlineBlock,
            bondWei
        );
    }

    /// @notice Reveal this responder's ordered children for the active subtree.
    function revealChildren(
        uint256 claimId,
        uint256 gameNumber,
        bytes32 leftChild,
        bytes32 rightChild
    ) external {
        (Claim storage claim, Game storage game) = _requireActiveGame(claimId, gameNumber);
        if (game.phase != GamePhase.BISECTION) {
            revert WrongGamePhase(GamePhase.BISECTION, game.phase);
        }
        _requireTurn(game);

        if (msg.sender == claim.prover) {
            if (BisectVerifier.hashNode(leftChild, rightChild) != game.proverNode) {
                revert InvalidChildCommitment();
            }
            game.pendingProverLeft = leftChild;
            game.pendingProverRight = rightChild;
            game.proverChildrenRevealed = true;
            game.expectedResponder = game.challenger;
            game.deadlineBlock = block.number + turnWindowBlocks;
            emit DisputeChildrenRevealed(
                claimId,
                gameNumber,
                msg.sender,
                leftChild,
                rightChild,
                game.expectedResponder,
                game.deadlineBlock
            );
            return;
        }

        if (!game.proverChildrenRevealed) revert WrongResponder(claim.prover, msg.sender);
        if (BisectVerifier.hashNode(leftChild, rightChild) != game.challengerNode) {
            revert InvalidChildCommitment();
        }

        bytes32 proverLeft = game.pendingProverLeft;
        bytes32 proverRight = game.pendingProverRight;
        bool leftDiffers = proverLeft != leftChild;
        bool rightDiffers = proverRight != rightChild;
        if (!leftDiffers && !rightDiffers) revert NoDifferingChild();

        uint16 childSize = uint16(uint256(1) << (game.subtreeHeight - 1));
        if (leftDiffers) {
            game.proverNode = proverLeft;
            game.challengerNode = leftChild;
        } else {
            game.subtreeBaseIndex += childSize;
            game.proverNode = proverRight;
            game.challengerNode = rightChild;
        }

        game.subtreeHeight -= 1;
        game.proverChildrenRevealed = false;
        delete game.pendingProverLeft;
        delete game.pendingProverRight;

        if (game.subtreeHeight == 0) {
            if (game.subtreeBaseIndex == 0 || game.proverNode == game.challengerNode) {
                revert InvalidDisagreementIndex();
            }
            game.phase = GamePhase.TERMINAL;
            game.differentIndex = game.subtreeBaseIndex;
            game.selectedProverLeaf = game.proverNode;
            game.selectedChallengerLeaf = game.challengerNode;
            game.expectedResponder = game.challenger;
        } else {
            game.expectedResponder = claim.prover;
        }
        game.deadlineBlock = block.number + turnWindowBlocks;

        emit DisputeChildrenRevealed(
            claimId,
            gameNumber,
            msg.sender,
            leftChild,
            rightChild,
            game.expectedResponder,
            game.deadlineBlock
        );

        emit BisectionLevelResolved(
            claimId,
            gameNumber,
            game.subtreeBaseIndex,
            game.subtreeHeight,
            game.proverNode,
            game.challengerNode,
            game.differentIndex,
            game.expectedResponder,
            game.deadlineBlock
        );
    }

    /// @notice Reveal one party's authenticated adjacent states at the selected differing leaf.
    /// @dev The prover's turn passes the exact Phase 4 TransitionProof to the one-step verifier.
    function revealTerminal(
        uint256 claimId,
        uint256 gameNumber,
        BisectVerifier.TransitionProof calldata proof
    ) external {
        (Claim storage claim, Game storage game) = _requireActiveGame(claimId, gameNumber);
        if (game.phase != GamePhase.TERMINAL) {
            revert WrongGamePhase(GamePhase.TERMINAL, game.phase);
        }
        _requireTurn(game);
        if (game.differentIndex == 0) revert InvalidDisagreementIndex();

        bool isChallenger = msg.sender == game.challenger;
        bytes32 expectedRoot = isChallenger ? game.challengerRoot : claim.traceRoot;
        _validateTerminalProofContext(claim, game, proof, expectedRoot);

        if (isChallenger) {
            if (game.challengerTerminalRevealed) revert InvalidTerminalEvidence();
            _verifyTerminalMembership(claim, game, proof, expectedRoot);
            game.challengerPreviousState = proof.predecessor;
            game.challengerNextState = proof.claimedSuccessor;
            game.challengerTerminalRevealed = true;
            game.expectedResponder = claim.prover;
            game.deadlineBlock = block.number + turnWindowBlocks;
            emit TerminalEvidenceRevealed(
                claimId,
                gameNumber,
                msg.sender,
                game.differentIndex,
                _hashState(proof.predecessor),
                game.selectedChallengerLeaf,
                game.expectedResponder,
                game.deadlineBlock
            );
            return;
        }

        if (msg.sender != claim.prover) revert WrongResponder(game.expectedResponder, msg.sender);
        if (!game.challengerTerminalRevealed) revert ChallengerTerminalEvidenceMissing();
        _verifyTerminalMembership(claim, game, proof, expectedRoot);
        emit TerminalEvidenceRevealed(
            claimId,
            gameNumber,
            msg.sender,
            game.differentIndex,
            _hashState(proof.predecessor),
            game.selectedProverLeaf,
            address(0),
            0
        );

        if (!_sameState(game.challengerPreviousState, proof.predecessor)) {
            _settleChallengerWin(
                claimId, gameNumber, claim, game, GameOutcome.TERMINAL_COMMITMENT_INCONSISTENCY
            );
            return;
        }
        if (_sameState(game.challengerNextState, proof.claimedSuccessor)) {
            _settleChallengerWin(
                claimId, gameNumber, claim, game, GameOutcome.TERMINAL_COMMITMENT_INCONSISTENCY
            );
            return;
        }

        bool proposerTransitionValid = BisectVerifier.verifyOneStep(proof);
        if (proposerTransitionValid) {
            _settleProverWin(claimId, gameNumber, claim, game, GameOutcome.PROVER_TRANSITION_VALID);
        } else {
            _settleChallengerWin(
                claimId, gameNumber, claim, game, GameOutcome.PROVER_TRANSITION_INVALID
            );
        }
    }

    /// @notice Permissionlessly apply the locked v1 outcome when a required responder times out.
    function claimTimeout(uint256 claimId, uint256 gameNumber) external {
        (Claim storage claim, Game storage game) = _requireActiveGame(claimId, gameNumber);
        if (block.number <= game.deadlineBlock) revert TurnDeadlinePassed(game.deadlineBlock);

        address missedResponder = game.expectedResponder;
        if (missedResponder == game.challenger) {
            emit GameTimedOut(
                claimId, gameNumber, missedResponder, GameOutcome.CHALLENGER_TIMEOUT, claim.prover
            );
            _settleProverWin(claimId, gameNumber, claim, game, GameOutcome.CHALLENGER_TIMEOUT);
        } else if (missedResponder == claim.prover) {
            emit GameTimedOut(
                claimId, gameNumber, missedResponder, GameOutcome.PROVER_TIMEOUT, game.challenger
            );
            _settleChallengerWin(claimId, gameNumber, claim, game, GameOutcome.PROVER_TIMEOUT);
        } else {
            revert InvalidFinancialState();
        }
    }

    /// @notice Finalize only after the challenge window and after every game has closed.
    function finalize(uint256 claimId) external override {
        if (activeGameNumber[claimId] != 0) revert ActiveGame(claimId);
        _finalizeClaimAfterDisputeResolution(claimId);
    }

    function getGame(uint256 claimId, uint256 gameNumber) external view returns (Game memory game) {
        game = _games[claimId][gameNumber];
        if (game.phase == GamePhase.NONE) revert UnknownGame(claimId, gameNumber);
    }

    function _requireActiveGame(uint256 claimId, uint256 gameNumber)
        private
        view
        returns (Claim storage claim, Game storage game)
    {
        claim = _requireClaim(claimId);
        uint256 activeNumber = activeGameNumber[claimId];
        if (activeNumber == 0 || claim.status != ClaimStatus.GAME_ACTIVE) {
            revert GameNotActive(claimId, gameNumber);
        }
        if (activeNumber != gameNumber) revert WrongGameNumber(activeNumber, gameNumber);
        game = _games[claimId][gameNumber];
        if (game.phase == GamePhase.CLOSED || game.settled || !game.challengerBondLocked) {
            revert GameNotActive(claimId, gameNumber);
        }
    }

    function _requireTurn(Game storage game) private view {
        if (block.number > game.deadlineBlock) revert TurnDeadlinePassed(game.deadlineBlock);
        if (msg.sender != game.expectedResponder) {
            revert WrongResponder(game.expectedResponder, msg.sender);
        }
    }

    function _validateTerminalProofContext(
        Claim storage claim,
        Game storage game,
        BisectVerifier.TransitionProof calldata proof,
        bytes32 expectedRoot
    ) private view {
        if (
            keccak256(proof.program) != keccak256(claim.program)
                || proof.transitionCount != claim.transitionCount || proof.traceRoot != expectedRoot
                || uint256(proof.stateIndex) + 1 != game.differentIndex
        ) revert InvalidTerminalEvidence();
        if (!_sameInput(claim.publicInput, proof.publicInput)) revert InvalidTerminalEvidence();
    }

    function _verifyTerminalMembership(
        Claim storage claim,
        Game storage game,
        BisectVerifier.TransitionProof calldata proof,
        bytes32 expectedRoot
    ) private view {
        uint16 nextIndex = game.differentIndex;
        if (
            !BisectVerifier.verifyStateProof(
                    expectedRoot,
                    claim.contextHash,
                    proof.stateIndex,
                    proof.predecessor,
                    proof.predecessorSiblings,
                    claim.transitionCount
                )
                || !BisectVerifier.verifyStateProof(
                    expectedRoot,
                    claim.contextHash,
                    nextIndex,
                    proof.claimedSuccessor,
                    proof.successorSiblings,
                    claim.transitionCount
                )
        ) revert InvalidTerminalEvidence();

        BisectVerifier.State memory nextState = proof.claimedSuccessor;
        bytes32 selectedLeaf = BisectVerifier.hashLeaf(claim.contextHash, nextIndex, nextState);
        bytes32 expectedLeaf =
            msg.sender == game.challenger ? game.selectedChallengerLeaf : game.selectedProverLeaf;
        if (selectedLeaf != expectedLeaf) revert InvalidTerminalEvidence();
    }

    function _settleProverWin(
        uint256 claimId,
        uint256 gameNumber,
        Claim storage claim,
        Game storage game,
        GameOutcome outcome
    ) private {
        if (!claim.proposerBondLocked || !game.challengerBondLocked || game.settled) {
            revert InvalidFinancialState();
        }
        game.challengerBondLocked = false;
        game.settled = true;
        game.phase = GamePhase.CLOSED;
        game.outcome = outcome;
        claim.status = ClaimStatus.OPEN;
        activeGameNumber[claimId] = 0;

        _moveLockedBondToCredit(claim.prover, bondWei);
        emit GameBondCredited(claimId, gameNumber, claim.prover, bondWei, outcome);
        emit GameResolved(
            claimId,
            gameNumber,
            outcome,
            claim.prover,
            game.differentIndex,
            claim.status,
            bondWei,
            0
        );
    }

    function _settleChallengerWin(
        uint256 claimId,
        uint256 gameNumber,
        Claim storage claim,
        Game storage game,
        GameOutcome outcome
    ) private {
        if (!claim.proposerBondLocked || !game.challengerBondLocked || game.settled) {
            revert InvalidFinancialState();
        }
        claim.proposerBondLocked = false;
        claim.status = ClaimStatus.REFUTED;
        game.challengerBondLocked = false;
        game.settled = true;
        game.phase = GamePhase.CLOSED;
        game.outcome = outcome;
        activeGameNumber[claimId] = 0;

        uint256 payout = uint256(bondWei) * 2;
        _moveLockedBondToCredit(game.challenger, payout);
        emit GameBondCredited(claimId, gameNumber, game.challenger, payout, outcome);
        emit GameResolved(
            claimId,
            gameNumber,
            outcome,
            game.challenger,
            game.differentIndex,
            claim.status,
            0,
            payout
        );
    }

    function _isCanonicalInitialState(
        BisectVerifier.State calldata state,
        uint64[8] storage publicInput
    ) private view returns (bool) {
        if (state.pc != 0 || state.halted) return false;
        for (uint256 i = 0; i < 8; ++i) {
            if (state.registers[i] != publicInput[i]) return false;
        }
        return true;
    }

    function _sameState(BisectVerifier.State storage left, BisectVerifier.State calldata right)
        private
        view
        returns (bool)
    {
        if (left.pc != right.pc || left.halted != right.halted) return false;
        for (uint256 i = 0; i < 8; ++i) {
            if (left.registers[i] != right.registers[i]) return false;
        }
        return true;
    }

    function _sameInput(uint64[8] storage left, uint64[8] calldata right)
        private
        view
        returns (bool)
    {
        for (uint256 i = 0; i < 8; ++i) {
            if (left[i] != right[i]) return false;
        }
        return true;
    }

    function _hashState(BisectVerifier.State calldata state) private pure returns (bytes32) {
        BisectVerifier.State memory stateCopy = state;
        return BisectVerifier.hashState(stateCopy);
    }

    function _proofDepth(uint16 transitionCount) private pure returns (uint16 height) {
        uint256 leaves = uint256(transitionCount) + 1;
        if (leaves != 64 && leaves != 256 && leaves != 1024 && leaves != 4096) {
            revert InvalidExecutionBudget();
        }
        while (leaves > 1) {
            leaves >>= 1;
            height += 1;
        }
    }
}
