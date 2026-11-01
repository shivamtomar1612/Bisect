import { bisectDisputeRegistryV1Abi } from "@bisect/sdk";
import {
  type Address,
  createPublicClient,
  encodeFunctionData,
  formatEther,
  getAddress,
  type Hex,
  http,
  isAddress,
} from "viem";
import { baseSepolia, foundry } from "viem/chains";

export interface InjectedProvider {
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}

declare global {
  interface Window {
    ethereum?: InjectedProvider;
  }
}

const requestedChain = process.env["NEXT_PUBLIC_BISECT_CHAIN_ID"] ?? "84532";
if (requestedChain !== "84532" && requestedChain !== "31337")
  throw new Error("Unsupported BISECT wallet chain configuration.");
const configuredChainId = requestedChain === "31337" ? 31337 : 84532;
const chain = configuredChainId === 31337 ? foundry : baseSepolia;
const rpcUrl =
  process.env["NEXT_PUBLIC_BISECT_RPC_URL"] ??
  (configuredChainId === 31337 ? "http://127.0.0.1:8545" : "https://sepolia.base.org");
const parsedRpcUrl = new URL(rpcUrl);
if (
  parsedRpcUrl.username ||
  parsedRpcUrl.password ||
  parsedRpcUrl.search ||
  parsedRpcUrl.hash ||
  (configuredChainId === 84532 && parsedRpcUrl.protocol !== "https:") ||
  (configuredChainId === 31337 &&
    (parsedRpcUrl.protocol !== "http:" ||
      !["localhost", "127.0.0.1", "::1"].includes(parsedRpcUrl.hostname)))
)
  throw new Error("Invalid public BISECT RPC configuration.");
export const walletChainId = configuredChainId;
export const walletChainName = configuredChainId === 31337 ? "Local Anvil" : "Base Sepolia";
export const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });

export function registryAddress(): Address | null {
  const value = process.env["NEXT_PUBLIC_BISECT_REGISTRY_ADDRESS"];
  return value && isAddress(value) ? getAddress(value) : null;
}

export function getWalletProvider(): InjectedProvider | null {
  return typeof window === "undefined" ? null : (window.ethereum ?? null);
}

export async function walletChain(): Promise<number> {
  const provider = getWalletProvider();
  if (!provider) throw new Error("Install or enable an EVM wallet first.");
  const result = await provider.request({ method: "eth_chainId" });
  if (typeof result !== "string" || !/^0x[0-9a-f]+$/i.test(result)) {
    throw new Error("Wallet returned an invalid chain ID.");
  }
  const id = Number(BigInt(result));
  if (!Number.isSafeInteger(id)) throw new Error("Wallet chain ID is out of range.");
  return id;
}

export async function walletAccount(requestConnection = false): Promise<Address | null> {
  const provider = getWalletProvider();
  if (!provider) return null;
  const result = await provider.request({
    method: requestConnection ? "eth_requestAccounts" : "eth_accounts",
  });
  if (!Array.isArray(result) || result.length === 0) return null;
  if (typeof result[0] !== "string" || !isAddress(result[0])) {
    throw new Error("Wallet returned an invalid address.");
  }
  return getAddress(result[0]);
}

export async function switchWalletChain(): Promise<void> {
  const provider = getWalletProvider();
  if (!provider) throw new Error("Install or enable an EVM wallet first.");
  if (configuredChainId !== 84532) throw new Error("Switch the wallet to local Anvil manually.");
  await provider.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: "0x14a34" }],
  });
  if ((await walletChain()) !== configuredChainId)
    throw new Error("Wallet did not switch networks.");
}

export async function requireTransactionWallet(): Promise<{
  provider: InjectedProvider;
  account: Address;
  registry: Address;
}> {
  const provider = getWalletProvider();
  if (!provider) throw new Error("Connect an external EVM wallet first.");
  const registry = registryAddress();
  if (!registry) throw new Error("No verified registry address is configured for this network.");
  const account = await walletAccount(false);
  if (!account) throw new Error("Connect your wallet before submitting a transaction.");
  if ((await walletChain()) !== configuredChainId)
    throw new Error(`Switch your wallet to ${walletChainName}.`);
  if ((await publicClient.getChainId()) !== configuredChainId)
    throw new Error("The configured RPC is on the wrong chain.");
  const bytecode = await publicClient.getBytecode({ address: registry });
  if (!bytecode || bytecode === "0x")
    throw new Error("No registry contract exists at the configured address.");
  return { provider, account, registry };
}

export async function sendRegistryTransaction(args: {
  provider: InjectedProvider;
  account: Address;
  registry: Address;
  data: Hex;
  value?: bigint;
  onHash?: (hash: Hex) => void;
}): Promise<{ hash: Hex; blockNumber: bigint }> {
  await publicClient.call({
    account: args.account,
    to: args.registry,
    data: args.data,
    value: args.value ?? 0n,
  });
  if ((await walletChain()) !== configuredChainId)
    throw new Error("Wallet network changed before submission.");
  const result = await args.provider.request({
    method: "eth_sendTransaction",
    params: [
      {
        from: args.account,
        to: args.registry,
        data: args.data,
        value: `0x${(args.value ?? 0n).toString(16)}`,
        chainId: `0x${configuredChainId.toString(16)}`,
      },
    ],
  });
  if (typeof result !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(result)) {
    throw new Error("Wallet returned an invalid transaction hash.");
  }
  const hash = result as Hex;
  args.onHash?.(hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== "success") throw new Error(`Transaction ${hash} reverted on-chain.`);
  window.dispatchEvent(new Event("bisect:transaction-confirmed"));
  return { hash, blockNumber: receipt.blockNumber };
}

export async function readWalletFunds(
  account: Address,
): Promise<{ walletWei: bigint; creditWei: bigint | null }> {
  const registry = registryAddress();
  const walletWei = await publicClient.getBalance({ address: account });
  const creditWei = registry
    ? await publicClient.readContract({
        address: registry,
        abi: bisectDisputeRegistryV1Abi,
        functionName: "withdrawableCredit",
        args: [account],
      })
    : null;
  return { walletWei, creditWei };
}

export function withdrawCalldata(): Hex {
  return encodeFunctionData({ abi: bisectDisputeRegistryV1Abi, functionName: "withdraw" });
}

export function exactEth(wei: bigint): string {
  return formatEther(wei);
}
