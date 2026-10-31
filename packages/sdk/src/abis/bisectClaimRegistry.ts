import type { Abi } from "viem";

export const bisectClaimRegistryAbi = [
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
    name: "DuplicateClaim",
    inputs: [],
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
    name: "InvalidConfiguration",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidExecutionBudget",
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
    name: "InvalidTraceEvidence",
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
    name: "ReentrancyGuardReentrantCall",
    inputs: [],
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
    name: "WithdrawalFailed",
    inputs: [],
  },
] as const satisfies Abi;
