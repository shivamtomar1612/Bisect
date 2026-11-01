import {
  type Address,
  createPublicClient,
  getAddress,
  type Hash,
  http,
  isAddress,
  keccak256,
} from "viem";
import { baseSepolia } from "viem/chains";
import { bisectDisputeRegistryV1Abi } from "../src/abis/bisectDisputeRegistryV1.js";

const EXPECTED_CHAIN_ID = 84532;
const CONFIRMATION_DEPTH = 6n;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Set ${name} in the process environment before verification.`);
  return value;
}

function decimal(name: string, maximum: bigint): bigint {
  const value = required(name);
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${name} must be an unsigned base-10 integer.`);
  }
  const parsed = BigInt(value);
  if (parsed === 0n || parsed > maximum) throw new Error(`${name} is outside the supported range.`);
  return parsed;
}

const rpcUrl = process.env["BASE_SEPOLIA_RPC_URL"]?.trim() || "https://sepolia.base.org";
const registryText = required("BASE_SEPOLIA_REGISTRY_ADDRESS");
const deployerText = required("BASE_SEPOLIA_DEPLOYER_ADDRESS");
const deploymentBlockText = required("BASE_SEPOLIA_DEPLOYMENT_BLOCK");
const deploymentHashText = required("BASE_SEPOLIA_DEPLOYMENT_TX_HASH");

if (!isAddress(registryText))
  throw new Error("BASE_SEPOLIA_REGISTRY_ADDRESS is not an EVM address.");
if (!isAddress(deployerText))
  throw new Error("BASE_SEPOLIA_DEPLOYER_ADDRESS is not an EVM address.");
if (!/^(0|[1-9][0-9]*)$/.test(deploymentBlockText)) {
  throw new Error("BASE_SEPOLIA_DEPLOYMENT_BLOCK must be an unsigned block number.");
}
if (!/^0x[0-9a-fA-F]{64}$/.test(deploymentHashText)) {
  throw new Error("BASE_SEPOLIA_DEPLOYMENT_TX_HASH must be a 32-byte transaction hash.");
}

const registry = getAddress(registryText);
const deployer = getAddress(deployerText);
const expectedDeploymentBlock = BigInt(deploymentBlockText);
const deploymentHash = deploymentHashText as Hash;
const expectedBondWei = decimal("BASE_SEPOLIA_BOND_WEI", (1n << 96n) - 1n);
const expectedChallengeWindow = decimal("BASE_SEPOLIA_CHALLENGE_WINDOW_BLOCKS", 1_000_000n);
const expectedTurnWindow = decimal("BASE_SEPOLIA_TURN_WINDOW_BLOCKS", 100_000n);

const client = createPublicClient({
  chain: baseSepolia,
  transport: http(rpcUrl, { timeout: 15_000 }),
});
const actualChainId = await client.getChainId();
if (actualChainId !== EXPECTED_CHAIN_ID) {
  throw new Error(
    `Expected Base Sepolia chain ID ${EXPECTED_CHAIN_ID}; received ${actualChainId}.`,
  );
}

const [runtimeCode, receipt, latestBlock] = await Promise.all([
  client.getBytecode({ address: registry }),
  client.getTransactionReceipt({ hash: deploymentHash }),
  client.getBlockNumber(),
]);
if (!runtimeCode || runtimeCode === "0x")
  throw new Error("Registry address has no deployed bytecode.");
if (receipt.status !== "success")
  throw new Error("Recorded deployment transaction did not succeed.");
if (receipt.to !== null || receipt.contractAddress?.toLowerCase() !== registry.toLowerCase()) {
  throw new Error("Recorded transaction is not the registry contract-creation transaction.");
}
if (receipt.from.toLowerCase() !== deployer.toLowerCase()) {
  throw new Error("Deployment receipt sender does not match BASE_SEPOLIA_DEPLOYER_ADDRESS.");
}
if (receipt.blockNumber !== expectedDeploymentBlock) {
  throw new Error("Deployment receipt block does not match BASE_SEPOLIA_DEPLOYMENT_BLOCK.");
}
if (latestBlock < expectedDeploymentBlock + CONFIRMATION_DEPTH) {
  throw new Error("Deployment has not reached the configured six-block confirmation depth.");
}
const deploymentBlock = await client.getBlock({ blockNumber: expectedDeploymentBlock });
if (deploymentBlock.hash !== receipt.blockHash) {
  throw new Error(
    "Deployment receipt is not on the currently canonical block at its recorded height.",
  );
}

const [
  protocolVersion,
  vmVersion,
  encodingVersion,
  declaredChainId,
  bondWei,
  challengeWindow,
  turnWindow,
] = await Promise.all([
  client.readContract({
    address: registry,
    abi: bisectDisputeRegistryV1Abi,
    functionName: "PROTOCOL_VERSION",
  }),
  client.readContract({
    address: registry,
    abi: bisectDisputeRegistryV1Abi,
    functionName: "VM_VERSION",
  }),
  client.readContract({
    address: registry,
    abi: bisectDisputeRegistryV1Abi,
    functionName: "ENCODING_VERSION",
  }),
  client.readContract({
    address: registry,
    abi: bisectDisputeRegistryV1Abi,
    functionName: "BASE_SEPOLIA_CHAIN_ID",
  }),
  client.readContract({
    address: registry,
    abi: bisectDisputeRegistryV1Abi,
    functionName: "bondWei",
  }),
  client.readContract({
    address: registry,
    abi: bisectDisputeRegistryV1Abi,
    functionName: "challengeWindowBlocks",
  }),
  client.readContract({
    address: registry,
    abi: bisectDisputeRegistryV1Abi,
    functionName: "turnWindowBlocks",
  }),
]);

const expectedValues: readonly [string, bigint, bigint][] = [
  ["PROTOCOL_VERSION", BigInt(protocolVersion), 1n],
  ["VM_VERSION", BigInt(vmVersion), 1n],
  ["ENCODING_VERSION", BigInt(encodingVersion), 1n],
  ["BASE_SEPOLIA_CHAIN_ID", declaredChainId, BigInt(EXPECTED_CHAIN_ID)],
  ["bondWei", bondWei, expectedBondWei],
  ["challengeWindowBlocks", BigInt(challengeWindow), expectedChallengeWindow],
  ["turnWindowBlocks", BigInt(turnWindow), expectedTurnWindow],
];
for (const [name, actual, expected] of expectedValues) {
  if (actual !== expected)
    throw new Error(`${name} mismatch: expected ${expected}, received ${actual}.`);
}

const output = {
  status: "verified-read-only",
  chainId: actualChainId,
  latestBlock: latestBlock.toString(),
  confirmations: (latestBlock - expectedDeploymentBlock).toString(),
  registryAddress: registry satisfies Address,
  deploymentTransactionHash: receipt.transactionHash,
  deploymentBlock: receipt.blockNumber.toString(),
  deploymentBlockHash: receipt.blockHash,
  deployerAddress: receipt.from,
  runtimeCodeHash: keccak256(runtimeCode),
  protocolVersion: protocolVersion.toString(),
  vmVersion: vmVersion.toString(),
  encodingVersion: encodingVersion.toString(),
  bondWei: bondWei.toString(),
  challengeWindowBlocks: challengeWindow.toString(),
  turnWindowBlocks: turnWindow.toString(),
  writesSubmitted: false,
};
console.log(JSON.stringify(output, null, 2));
