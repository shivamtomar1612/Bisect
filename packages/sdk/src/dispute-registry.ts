import {
  type Address,
  type GetContractReturnType,
  getContract,
  type PublicClient,
  type WalletClient,
} from "viem";
import { bisectDisputeRegistryV1Abi } from "./abis/bisectDisputeRegistryV1.js";

export { bisectDisputeRegistryV1Abi };

export const DISPUTE_GAME_PHASE = Object.freeze({
  NONE: 0,
  BISECTION: 1,
  TERMINAL: 2,
  CLOSED: 3,
} as const);
export type DisputeGamePhase = (typeof DISPUTE_GAME_PHASE)[keyof typeof DISPUTE_GAME_PHASE];

export const DISPUTE_GAME_OUTCOME = Object.freeze({
  NONE: 0,
  PROVER_TRANSITION_VALID: 1,
  CHALLENGER_TIMEOUT: 2,
  PROVER_TRANSITION_INVALID: 3,
  PROVER_TIMEOUT: 4,
  TERMINAL_COMMITMENT_INCONSISTENCY: 5,
} as const);
export type DisputeGameOutcome = (typeof DISPUTE_GAME_OUTCOME)[keyof typeof DISPUTE_GAME_OUTCOME];
export type Uint64Registers = readonly [
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
];

/** Read model returned by `getGame`; all block heights and indexes retain ABI integer widths. */
export interface DisputeGameView {
  readonly phase: DisputeGamePhase;
  readonly outcome: DisputeGameOutcome;
  readonly challenger: Address;
  readonly challengerRoot: `0x${string}`;
  readonly deadlineBlock: bigint;
  readonly subtreeBaseIndex: number;
  readonly subtreeHeight: number;
  readonly proverNode: `0x${string}`;
  readonly challengerNode: `0x${string}`;
  readonly pendingProverLeft: `0x${string}`;
  readonly pendingProverRight: `0x${string}`;
  readonly proverChildrenRevealed: boolean;
  readonly expectedResponder: Address;
  readonly differentIndex: number;
  readonly selectedProverLeaf: `0x${string}`;
  readonly selectedChallengerLeaf: `0x${string}`;
  readonly challengerBondLocked: boolean;
  readonly settled: boolean;
  readonly challengerTerminalRevealed: boolean;
  readonly challengerPreviousState: {
    readonly pc: number;
    readonly halted: boolean;
    readonly registers: Uint64Registers;
  };
  readonly challengerNextState: {
    readonly pc: number;
    readonly halted: boolean;
    readonly registers: Uint64Registers;
  };
}

/** Read-only typed viem client for the integrated v1 dispute and escrow registry. */
export function getBisectDisputeRegistryV1Reader(
  address: Address,
  client: PublicClient,
): GetContractReturnType<typeof bisectDisputeRegistryV1Abi, PublicClient, Address> {
  return getContract({ address, abi: bisectDisputeRegistryV1Abi, client });
}

/** Wallet-bound typed viem client; signing keys stay in the caller's wallet. */
export function getBisectDisputeRegistryV1Writer(
  address: Address,
  client: WalletClient,
): GetContractReturnType<typeof bisectDisputeRegistryV1Abi, WalletClient, Address> {
  return getContract({ address, abi: bisectDisputeRegistryV1Abi, client });
}
