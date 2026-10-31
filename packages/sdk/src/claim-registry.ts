import { type Address, getContract, type PublicClient, type WalletClient } from "viem";
import { bisectClaimRegistryAbi } from "./abis/bisectClaimRegistry.js";

export { bisectClaimRegistryAbi };

/** Create a read-only viem client for a deployed Bisect claim registry. */
export function getBisectClaimRegistryReader(address: Address, client: PublicClient) {
  return getContract({ address, abi: bisectClaimRegistryAbi, client });
}

/** Create a wallet-bound viem client; signing keys remain with the caller's wallet. */
export function getBisectClaimRegistryWriter(address: Address, client: WalletClient) {
  return getContract({ address, abi: bisectClaimRegistryAbi, client });
}
