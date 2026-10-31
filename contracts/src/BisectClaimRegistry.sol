// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { BisectVerifier } from "./BisectVerifier.sol";

/// @notice Phase 5 escrow/accounting base for v1 claims.
/// @dev This base deliberately accepts no claims and settles none: without the dispute game, it
///      cannot release a bond safely. A dispute-enabled derived deployment must explicitly expose
///      `_submitClaim` and authorize finalization only after the complete v1 game permits it.
contract BisectClaimRegistry is ReentrancyGuard {
    uint16 public constant PROTOCOL_VERSION = 1;
    uint16 public constant VM_VERSION = 1;
    uint16 public constant ENCODING_VERSION = 1;
    uint256 public constant BASE_SEPOLIA_CHAIN_ID = 84532;

    enum ClaimStatus {
        NONE,
        OPEN,
        GAME_ACTIVE,
        FINALIZED,
        REFUTED
    }

    struct EndpointProof {
        BisectVerifier.State state;
        bytes32[] siblings;
    }

    struct ClaimSubmission {
        bytes program;
        uint64[8] publicInput;
        uint16 transitionCount;
        bytes32 traceRoot;
        uint64 claimedOutput;
        EndpointProof initialProof;
        EndpointProof finalProof;
    }

    struct ClaimHashes {
        bytes32 programHash;
        bytes32 inputHash;
        bytes32 contextHash;
    }

    struct Claim {
        ClaimStatus status;
        address prover;
        bytes program;
        uint64[8] publicInput;
        uint16 transitionCount;
        bytes32 traceRoot;
        uint64 claimedOutput;
        bytes32 programHash;
        bytes32 inputHash;
        bytes32 contextHash;
        uint256 submittedBlock;
        uint256 submittedAt;
        uint256 challengeDeadline;
        bool proposerBondLocked;
    }

    error InvalidConfiguration();
    error BaseMainnetDeploymentDisabled();
    error IncorrectBond(uint256 expected, uint256 received);
    error InvalidProgram(BisectVerifier.ProgramError reason);
    error InvalidExecutionBudget();
    error InvalidTraceEvidence();
    error DuplicateClaim();
    error UnknownClaim(uint256 claimId);
    error ClaimNotOpen(uint256 claimId);
    error ChallengeWindowOpen(uint256 deadline);
    error ActiveGame(uint256 claimId);
    error DisputeProtocolUnavailable();
    error BondNotLocked(uint256 claimId);
    error InvalidBondSettlement();
    error NoWithdrawableCredit();
    error WithdrawalFailed();
    error UnexpectedEther();

    event ClaimSubmitted(
        uint256 indexed claimId,
        address indexed prover,
        bytes32 indexed contextHash,
        bytes32 traceRoot,
        uint16 transitionCount,
        uint64 claimedOutput,
        uint256 challengeDeadline,
        uint96 bondWei
    );
    event ClaimFinalized(uint256 indexed claimId, address indexed prover, uint96 bondWei);
    event Withdrawal(address indexed account, uint256 amountWei);

    uint96 public immutable bondWei;
    uint32 public immutable challengeWindowBlocks;
    uint32 public immutable turnWindowBlocks;

    uint256 public nextClaimId = 1;
    uint256 public totalLockedBonds;
    uint256 public totalCredits;
    uint256 public totalLiabilities;

    mapping(uint256 claimId => Claim claim) internal _claims;
    mapping(address account => uint256 amountWei) public withdrawableCredit;
    mapping(bytes32 proposalKey => bool exists) private _submittedProposalKeys;

    constructor(uint96 bondWei_, uint32 challengeWindowBlocks_, uint32 turnWindowBlocks_) {
        if (block.chainid == 8453) revert BaseMainnetDeploymentDisabled();
        if (
            bondWei_ == 0 || challengeWindowBlocks_ == 0 || challengeWindowBlocks_ > 1_000_000
                || turnWindowBlocks_ == 0 || turnWindowBlocks_ > 100_000
        ) revert InvalidConfiguration();

        bondWei = bondWei_;
        challengeWindowBlocks = challengeWindowBlocks_;
        turnWindowBlocks = turnWindowBlocks_;
    }

    /// @notice Disabled in the Phase 5 base until an integrated dispute game is available.
    function submitClaim(ClaimSubmission calldata) public payable virtual returns (uint256) {
        revert DisputeProtocolUnavailable();
    }

    /// @dev Shared claim validation and escrow transition for a dispute-enabled derived contract.
    function _submitClaim(ClaimSubmission calldata submission) internal returns (uint256 claimId) {
        if (msg.value != bondWei) revert IncorrectBond(bondWei, msg.value);
        ClaimHashes memory hashes = _validateSubmission(submission);
        bytes32 proposalKey = keccak256(
            abi.encode(
                msg.sender, hashes.contextHash, submission.traceRoot, submission.claimedOutput
            )
        );
        if (_submittedProposalKeys[proposalKey]) revert DuplicateClaim();
        _submittedProposalKeys[proposalKey] = true;

        claimId = nextClaimId;
        nextClaimId = claimId + 1;
        uint256 deadline = block.number + challengeWindowBlocks;
        _storeClaim(claimId, submission, hashes, deadline);

        _recordIncomingBond();

        emit ClaimSubmitted(
            claimId,
            msg.sender,
            hashes.contextHash,
            submission.traceRoot,
            submission.transitionCount,
            submission.claimedOutput,
            deadline,
            bondWei
        );
    }

    /// @notice Phase 5 fail-closed guard; this base has no operative dispute protocol.
    /// @dev A Phase 6 derived deployment may override this entrypoint. It must prove that no
    ///      dispute is active before calling `_finalizeClaimAfterDisputeResolution`.
    function finalize(uint256 claimId) external virtual {
        Claim storage claim = _requireClaim(claimId);
        _requireFinalizableOpenClaim(claimId, claim);
        revert DisputeProtocolUnavailable();
    }

    /// @notice Withdraw the caller's complete available credit to the caller's wallet.
    function withdraw() external nonReentrant {
        uint256 amount = withdrawableCredit[msg.sender];
        if (amount == 0) revert NoWithdrawableCredit();

        withdrawableCredit[msg.sender] = 0;
        totalCredits -= amount;
        totalLiabilities -= amount;
        emit Withdrawal(msg.sender, amount);

        (bool success,) = payable(msg.sender).call{ value: amount }("");
        if (!success) revert WithdrawalFailed();
    }

    function getClaim(uint256 claimId) external view returns (Claim memory claim) {
        claim = _claims[claimId];
        if (claim.status == ClaimStatus.NONE) revert UnknownClaim(claimId);
    }

    function isSolvent() external view returns (bool) {
        return address(this).balance >= totalLiabilities;
    }

    function accountingInvariantHolds() external view returns (bool) {
        return address(this).balance >= totalLiabilities
            && totalLiabilities == totalLockedBonds + totalCredits;
    }

    receive() external payable {
        revert UnexpectedEther();
    }

    fallback() external payable {
        revert UnexpectedEther();
    }

    function _requireClaim(uint256 claimId) internal view returns (Claim storage claim) {
        claim = _claims[claimId];
        if (claim.status == ClaimStatus.NONE) revert UnknownClaim(claimId);
    }

    /// @dev Records one exact incoming prover or challenger bond in shared aggregate accounting.
    ///      Call only after the operation has validated its claim and cryptographic evidence.
    function _recordIncomingBond() internal {
        if (msg.value != bondWei) revert IncorrectBond(bondWei, msg.value);
        totalLockedBonds += msg.value;
        totalLiabilities += msg.value;
    }

    /// @dev Moves locked ETH to a pull credit without changing total liabilities.
    ///      Phase 6 must call this only after an on-chain game transition determines the beneficiary.
    function _moveLockedBondToCredit(address beneficiary, uint256 amountWei) internal {
        if (beneficiary == address(0) || amountWei == 0) revert InvalidBondSettlement();
        totalLockedBonds -= amountWei;
        totalCredits += amountWei;
        withdrawableCredit[beneficiary] += amountWei;
    }

    /// @dev Shared accounting transition for a Phase 6, proof-authorized finalization override.
    function _finalizeClaimAfterDisputeResolution(uint256 claimId) internal {
        Claim storage claim = _requireClaim(claimId);
        _requireFinalizableOpenClaim(claimId, claim);

        claim.proposerBondLocked = false;
        claim.status = ClaimStatus.FINALIZED;
        _moveLockedBondToCredit(claim.prover, bondWei);
        emit ClaimFinalized(claimId, claim.prover, bondWei);
    }

    function _requireFinalizableOpenClaim(uint256 claimId, Claim storage claim) private view {
        if (claim.status != ClaimStatus.OPEN) {
            if (claim.status == ClaimStatus.GAME_ACTIVE) revert ActiveGame(claimId);
            revert ClaimNotOpen(claimId);
        }
        if (block.number <= claim.challengeDeadline) {
            revert ChallengeWindowOpen(claim.challengeDeadline);
        }
        if (!claim.proposerBondLocked) revert BondNotLocked(claimId);
    }

    function _isInitialState(BisectVerifier.State calldata state, uint64[8] calldata publicInput)
        private
        pure
        returns (bool)
    {
        if (state.pc != 0 || state.halted) return false;
        for (uint256 i = 0; i < 8; ++i) {
            if (state.registers[i] != publicInput[i]) return false;
        }
        return true;
    }

    function _validateSubmission(ClaimSubmission calldata submission)
        private
        pure
        returns (ClaimHashes memory hashes)
    {
        if (!_isAllowedBudget(submission.transitionCount)) revert InvalidExecutionBudget();
        (BisectVerifier.ProgramError programError,) =
            BisectVerifier.validateProgram(submission.program);
        if (programError != BisectVerifier.ProgramError.NONE) revert InvalidProgram(programError);

        hashes.programHash = BisectVerifier.hashProgram(submission.program);
        hashes.inputHash = BisectVerifier.hashInput(submission.publicInput);
        hashes.contextHash = BisectVerifier.hashContext(
            hashes.programHash, hashes.inputHash, submission.transitionCount
        );

        bool initialValid = _isInitialState(submission.initialProof.state, submission.publicInput)
            && BisectVerifier.verifyStateProof(
                submission.traceRoot,
                hashes.contextHash,
                0,
                submission.initialProof.state,
                submission.initialProof.siblings,
                submission.transitionCount
            );
        bool finalValid = submission.finalProof.state.halted
            && submission.finalProof.state.registers[0] == submission.claimedOutput
            && BisectVerifier.verifyStateProof(
                submission.traceRoot,
                hashes.contextHash,
                submission.transitionCount,
                submission.finalProof.state,
                submission.finalProof.siblings,
                submission.transitionCount
            );
        if (!initialValid || !finalValid) revert InvalidTraceEvidence();
    }

    function _storeClaim(
        uint256 claimId,
        ClaimSubmission calldata submission,
        ClaimHashes memory hashes,
        uint256 deadline
    ) private {
        Claim storage claim = _claims[claimId];
        claim.status = ClaimStatus.OPEN;
        claim.prover = msg.sender;
        claim.program = submission.program;
        claim.publicInput = submission.publicInput;
        claim.transitionCount = submission.transitionCount;
        claim.traceRoot = submission.traceRoot;
        claim.claimedOutput = submission.claimedOutput;
        claim.programHash = hashes.programHash;
        claim.inputHash = hashes.inputHash;
        claim.contextHash = hashes.contextHash;
        claim.submittedBlock = block.number;
        claim.submittedAt = block.timestamp;
        claim.challengeDeadline = deadline;
        claim.proposerBondLocked = true;
    }

    function _isAllowedBudget(uint16 budget) private pure returns (bool) {
        return budget == 63 || budget == 255 || budget == 1023 || budget == 4095;
    }
}
