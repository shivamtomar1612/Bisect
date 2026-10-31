import type { Abi } from "viem";

export const bisectDisputeRegistryV1Abi = [
  {
    type: "constructor",
    inputs: [
      {
        name: "bondWei_",
        type: "uint96",
        internalType: "uint96",
      },
      {
        name: "challengeWindowBlocks_",
        type: "uint32",
        internalType: "uint32",
      },
      {
        name: "turnWindowBlocks_",
        type: "uint32",
        internalType: "uint32",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "fallback",
    stateMutability: "payable",
  },
  {
    type: "receive",
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "BASE_SEPOLIA_CHAIN_ID",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "ENCODING_VERSION",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint16",
        internalType: "uint16",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "PROTOCOL_VERSION",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint16",
        internalType: "uint16",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "VM_VERSION",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint16",
        internalType: "uint16",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "accountingInvariantHolds",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "activeGameNumber",
    inputs: [
      {
        name: "claimId",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "gameNumber",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "bondWei",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint96",
        internalType: "uint96",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "challenge",
    inputs: [
      {
        name: "claimId",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "challengerRoot",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "initialProof",
        type: "tuple",
        internalType: "struct BisectClaimRegistry.EndpointProof",
        components: [
          {
            name: "state",
            type: "tuple",
            internalType: "struct BisectVerifier.State",
            components: [
              {
                name: "pc",
                type: "uint16",
                internalType: "uint16",
              },
              {
                name: "halted",
                type: "bool",
                internalType: "bool",
              },
              {
                name: "registers",
                type: "uint64[8]",
                internalType: "uint64[8]",
              },
            ],
          },
          {
            name: "siblings",
            type: "bytes32[]",
            internalType: "bytes32[]",
          },
        ],
      },
    ],
    outputs: [
      {
        name: "gameNumber",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "challengeWindowBlocks",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint32",
        internalType: "uint32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "claimTimeout",
    inputs: [
      {
        name: "claimId",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "gameNumber",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "finalize",
    inputs: [
      {
        name: "claimId",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getClaim",
    inputs: [
      {
        name: "claimId",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "claim",
        type: "tuple",
        internalType: "struct BisectClaimRegistry.Claim",
        components: [
          {
            name: "status",
            type: "uint8",
            internalType: "enum BisectClaimRegistry.ClaimStatus",
          },
          {
            name: "prover",
            type: "address",
            internalType: "address",
          },
          {
            name: "program",
            type: "bytes",
            internalType: "bytes",
          },
          {
            name: "publicInput",
            type: "uint64[8]",
            internalType: "uint64[8]",
          },
          {
            name: "transitionCount",
            type: "uint16",
            internalType: "uint16",
          },
          {
            name: "traceRoot",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "claimedOutput",
            type: "uint64",
            internalType: "uint64",
          },
          {
            name: "programHash",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "inputHash",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "contextHash",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "submittedBlock",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "submittedAt",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "challengeDeadline",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "proposerBondLocked",
            type: "bool",
            internalType: "bool",
          },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getGame",
    inputs: [
      {
        name: "claimId",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "gameNumber",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "game",
        type: "tuple",
        internalType: "struct BisectDisputeRegistryV1.Game",
        components: [
          {
            name: "phase",
            type: "uint8",
            internalType: "enum BisectDisputeRegistryV1.GamePhase",
          },
          {
            name: "outcome",
            type: "uint8",
            internalType: "enum BisectDisputeRegistryV1.GameOutcome",
          },
          {
            name: "challenger",
            type: "address",
            internalType: "address",
          },
          {
            name: "challengerRoot",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "deadlineBlock",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "subtreeBaseIndex",
            type: "uint16",
            internalType: "uint16",
          },
          {
            name: "subtreeHeight",
            type: "uint16",
            internalType: "uint16",
          },
          {
            name: "proverNode",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "challengerNode",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "pendingProverLeft",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "pendingProverRight",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "proverChildrenRevealed",
            type: "bool",
            internalType: "bool",
          },
          {
            name: "expectedResponder",
            type: "address",
            internalType: "address",
          },
          {
            name: "differentIndex",
            type: "uint16",
            internalType: "uint16",
          },
          {
            name: "selectedProverLeaf",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "selectedChallengerLeaf",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "challengerBondLocked",
            type: "bool",
            internalType: "bool",
          },
          {
            name: "settled",
            type: "bool",
            internalType: "bool",
          },
          {
            name: "challengerTerminalRevealed",
            type: "bool",
            internalType: "bool",
          },
          {
            name: "challengerPreviousState",
            type: "tuple",
            internalType: "struct BisectVerifier.State",
            components: [
              {
                name: "pc",
                type: "uint16",
                internalType: "uint16",
              },
              {
                name: "halted",
                type: "bool",
                internalType: "bool",
              },
              {
                name: "registers",
                type: "uint64[8]",
                internalType: "uint64[8]",
              },
            ],
          },
          {
            name: "challengerNextState",
            type: "tuple",
            internalType: "struct BisectVerifier.State",
            components: [
              {
                name: "pc",
                type: "uint16",
                internalType: "uint16",
              },
              {
                name: "halted",
                type: "bool",
                internalType: "bool",
              },
              {
                name: "registers",
                type: "uint64[8]",
                internalType: "uint64[8]",
              },
            ],
          },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "isSolvent",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "latestGameNumber",
    inputs: [
      {
        name: "claimId",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "gameNumber",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "nextClaimId",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "revealChildren",
    inputs: [
      {
        name: "claimId",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "gameNumber",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "leftChild",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "rightChild",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "revealTerminal",
    inputs: [
      {
        name: "claimId",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "gameNumber",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "proof",
        type: "tuple",
        internalType: "struct BisectVerifier.TransitionProof",
        components: [
          {
            name: "program",
            type: "bytes",
            internalType: "bytes",
          },
          {
            name: "publicInput",
            type: "uint64[8]",
            internalType: "uint64[8]",
          },
          {
            name: "transitionCount",
            type: "uint16",
            internalType: "uint16",
          },
          {
            name: "traceRoot",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "stateIndex",
            type: "uint16",
            internalType: "uint16",
          },
          {
            name: "predecessor",
            type: "tuple",
            internalType: "struct BisectVerifier.State",
            components: [
              {
                name: "pc",
                type: "uint16",
                internalType: "uint16",
              },
              {
                name: "halted",
                type: "bool",
                internalType: "bool",
              },
              {
                name: "registers",
                type: "uint64[8]",
                internalType: "uint64[8]",
              },
            ],
          },
          {
            name: "predecessorSiblings",
            type: "bytes32[]",
            internalType: "bytes32[]",
          },
          {
            name: "claimedSuccessor",
            type: "tuple",
            internalType: "struct BisectVerifier.State",
            components: [
              {
                name: "pc",
                type: "uint16",
                internalType: "uint16",
              },
              {
                name: "halted",
                type: "bool",
                internalType: "bool",
              },
              {
                name: "registers",
                type: "uint64[8]",
                internalType: "uint64[8]",
              },
            ],
          },
          {
            name: "successorSiblings",
            type: "bytes32[]",
            internalType: "bytes32[]",
          },
        ],
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "submitClaim",
    inputs: [
      {
        name: "submission",
        type: "tuple",
        internalType: "struct BisectClaimRegistry.ClaimSubmission",
        components: [
          {
            name: "program",
            type: "bytes",
            internalType: "bytes",
          },
          {
            name: "publicInput",
            type: "uint64[8]",
            internalType: "uint64[8]",
          },
          {
            name: "transitionCount",
            type: "uint16",
            internalType: "uint16",
          },
          {
            name: "traceRoot",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "claimedOutput",
            type: "uint64",
            internalType: "uint64",
          },
          {
            name: "initialProof",
            type: "tuple",
            internalType: "struct BisectClaimRegistry.EndpointProof",
            components: [
              {
                name: "state",
                type: "tuple",
                internalType: "struct BisectVerifier.State",
                components: [
                  {
                    name: "pc",
                    type: "uint16",
                    internalType: "uint16",
                  },
                  {
                    name: "halted",
                    type: "bool",
                    internalType: "bool",
                  },
                  {
                    name: "registers",
                    type: "uint64[8]",
                    internalType: "uint64[8]",
                  },
                ],
              },
              {
                name: "siblings",
                type: "bytes32[]",
                internalType: "bytes32[]",
              },
            ],
          },
          {
            name: "finalProof",
            type: "tuple",
            internalType: "struct BisectClaimRegistry.EndpointProof",
            components: [
              {
                name: "state",
                type: "tuple",
                internalType: "struct BisectVerifier.State",
                components: [
                  {
                    name: "pc",
                    type: "uint16",
                    internalType: "uint16",
                  },
                  {
                    name: "halted",
                    type: "bool",
                    internalType: "bool",
                  },
                  {
                    name: "registers",
                    type: "uint64[8]",
                    internalType: "uint64[8]",
                  },
                ],
              },
              {
                name: "siblings",
                type: "bytes32[]",
                internalType: "bytes32[]",
              },
            ],
          },
        ],
      },
    ],
    outputs: [
      {
        name: "claimId",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "totalCredits",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalLiabilities",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalLockedBonds",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "turnWindowBlocks",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint32",
        internalType: "uint32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "withdraw",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "withdrawableCredit",
    inputs: [
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "amountWei",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "BisectionLevelResolved",
    inputs: [
      {
        name: "claimId",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "gameNumber",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "subtreeBaseIndex",
        type: "uint16",
        indexed: false,
        internalType: "uint16",
      },
      {
        name: "subtreeHeight",
        type: "uint16",
        indexed: false,
        internalType: "uint16",
      },
      {
        name: "proverNode",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32",
      },
      {
        name: "challengerNode",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32",
      },
      {
        name: "differentIndex",
        type: "uint16",
        indexed: false,
        internalType: "uint16",
      },
      {
        name: "expectedResponder",
        type: "address",
        indexed: false,
        internalType: "address",
      },
      {
        name: "deadlineBlock",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ChallengeStarted",
    inputs: [
      {
        name: "claimId",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "gameNumber",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "challenger",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "challengerRoot",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32",
      },
      {
        name: "initialHeight",
        type: "uint16",
        indexed: false,
        internalType: "uint16",
      },
      {
        name: "expectedResponder",
        type: "address",
        indexed: false,
        internalType: "address",
      },
      {
        name: "deadlineBlock",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "bondWei",
        type: "uint96",
        indexed: false,
        internalType: "uint96",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ClaimFinalized",
    inputs: [
      {
        name: "claimId",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "prover",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "bondWei",
        type: "uint96",
        indexed: false,
        internalType: "uint96",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ClaimSubmitted",
    inputs: [
      {
        name: "claimId",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "prover",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "contextHash",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "traceRoot",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32",
      },
      {
        name: "transitionCount",
        type: "uint16",
        indexed: false,
        internalType: "uint16",
      },
      {
        name: "claimedOutput",
        type: "uint64",
        indexed: false,
        internalType: "uint64",
      },
      {
        name: "challengeDeadline",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "bondWei",
        type: "uint96",
        indexed: false,
        internalType: "uint96",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "DisputeChildrenRevealed",
    inputs: [
      {
        name: "claimId",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "gameNumber",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "responder",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "leftChild",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32",
      },
      {
        name: "rightChild",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32",
      },
      {
        name: "nextResponder",
        type: "address",
        indexed: false,
        internalType: "address",
      },
      {
        name: "nextDeadlineBlock",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "GameBondCredited",
    inputs: [
      {
        name: "claimId",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "gameNumber",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "beneficiary",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "amountWei",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "outcome",
        type: "uint8",
        indexed: false,
        internalType: "enum BisectDisputeRegistryV1.GameOutcome",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "GameResolved",
    inputs: [
      {
        name: "claimId",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "gameNumber",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "outcome",
        type: "uint8",
        indexed: false,
        internalType: "enum BisectDisputeRegistryV1.GameOutcome",
      },
      {
        name: "winner",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "differentIndex",
        type: "uint16",
        indexed: false,
        internalType: "uint16",
      },
      {
        name: "claimStatus",
        type: "uint8",
        indexed: false,
        internalType: "enum BisectClaimRegistry.ClaimStatus",
      },
      {
        name: "proverBondCreditWei",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "challengerBondCreditWei",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "GameTimedOut",
    inputs: [
      {
        name: "claimId",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "gameNumber",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "missedResponder",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "outcome",
        type: "uint8",
        indexed: false,
        internalType: "enum BisectDisputeRegistryV1.GameOutcome",
      },
      {
        name: "winner",
        type: "address",
        indexed: false,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "TerminalEvidenceRevealed",
    inputs: [
      {
        name: "claimId",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "gameNumber",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "responder",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "differentIndex",
        type: "uint16",
        indexed: false,
        internalType: "uint16",
      },
      {
        name: "previousStateHash",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32",
      },
      {
        name: "nextLeafHash",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32",
      },
      {
        name: "nextResponder",
        type: "address",
        indexed: false,
        internalType: "address",
      },
      {
        name: "nextDeadlineBlock",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Withdrawal",
    inputs: [
      {
        name: "account",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "amountWei",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "error",
    name: "ActiveGame",
    inputs: [
      {
        name: "claimId",
        type: "uint256",
        internalType: "uint256",
      },
    ],
  },
  {
    type: "error",
    name: "BaseMainnetDeploymentDisabled",
    inputs: [],
  },
  {
    type: "error",
    name: "BondNotLocked",
    inputs: [
      {
        name: "claimId",
        type: "uint256",
        internalType: "uint256",
      },
    ],
  },
  {
    type: "error",
    name: "ChallengeWindowClosed",
    inputs: [
      {
        name: "deadline",
        type: "uint256",
        internalType: "uint256",
      },
    ],
  },
  {
    type: "error",
    name: "ChallengeWindowOpen",
    inputs: [
      {
        name: "deadline",
        type: "uint256",
        internalType: "uint256",
      },
    ],
  },
  {
    type: "error",
    name: "ChallengerTerminalEvidenceMissing",
    inputs: [],
  },
  {
    type: "error",
    name: "ClaimNotOpen",
    inputs: [
      {
        name: "claimId",
        type: "uint256",
        internalType: "uint256",
      },
    ],
  },
  {
    type: "error",
    name: "DisputeProtocolUnavailable",
    inputs: [],
  },
  {
    type: "error",
    name: "DuplicateActiveGame",
    inputs: [
      {
        name: "claimId",
        type: "uint256",
        internalType: "uint256",
      },
    ],
  },
  {
    type: "error",
    name: "DuplicateClaim",
    inputs: [],
  },
  {
    type: "error",
    name: "GameNotActive",
    inputs: [
      {
        name: "claimId",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "gameNumber",
        type: "uint256",
        internalType: "uint256",
      },
    ],
  },
  {
    type: "error",
    name: "IncorrectBond",
    inputs: [
      {
        name: "expected",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "received",
        type: "uint256",
        internalType: "uint256",
      },
    ],
  },
  {
    type: "error",
    name: "InvalidBondSettlement",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidChildCommitment",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidConfiguration",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidDisagreementIndex",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidExecutionBudget",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidFinancialState",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidInitialAgreement",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidProgram",
    inputs: [
      {
        name: "reason",
        type: "uint8",
        internalType: "enum BisectVerifier.ProgramError",
      },
    ],
  },
  {
    type: "error",
    name: "InvalidTerminalEvidence",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidTraceEvidence",
    inputs: [],
  },
  {
    type: "error",
    name: "NoDifferingChild",
    inputs: [],
  },
  {
    type: "error",
    name: "NoWithdrawableCredit",
    inputs: [],
  },
  {
    type: "error",
    name: "ProgramExceedsMaximumSize",
    inputs: [],
  },
  {
    type: "error",
    name: "ProverCannotChallenge",
    inputs: [
      {
        name: "claimId",
        type: "uint256",
        internalType: "uint256",
      },
    ],
  },
  {
    type: "error",
    name: "ReentrancyGuardReentrantCall",
    inputs: [],
  },
  {
    type: "error",
    name: "SameTraceRoot",
    inputs: [],
  },
  {
    type: "error",
    name: "TurnDeadlinePassed",
    inputs: [
      {
        name: "deadline",
        type: "uint256",
        internalType: "uint256",
      },
    ],
  },
  {
    type: "error",
    name: "UnexpectedEther",
    inputs: [],
  },
  {
    type: "error",
    name: "UnknownClaim",
    inputs: [
      {
        name: "claimId",
        type: "uint256",
        internalType: "uint256",
      },
    ],
  },
  {
    type: "error",
    name: "UnknownGame",
    inputs: [
      {
        name: "claimId",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "gameNumber",
        type: "uint256",
        internalType: "uint256",
      },
    ],
  },
  {
    type: "error",
    name: "WithdrawalFailed",
    inputs: [],
  },
  {
    type: "error",
    name: "WrongGameNumber",
    inputs: [
      {
        name: "expected",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "actual",
        type: "uint256",
        internalType: "uint256",
      },
    ],
  },
  {
    type: "error",
    name: "WrongGamePhase",
    inputs: [
      {
        name: "expected",
        type: "uint8",
        internalType: "enum BisectDisputeRegistryV1.GamePhase",
      },
      {
        name: "actual",
        type: "uint8",
        internalType: "enum BisectDisputeRegistryV1.GamePhase",
      },
    ],
  },
  {
    type: "error",
    name: "WrongResponder",
    inputs: [
      {
        name: "expected",
        type: "address",
        internalType: "address",
      },
      {
        name: "actual",
        type: "address",
        internalType: "address",
      },
    ],
  },
] as const satisfies Abi;
