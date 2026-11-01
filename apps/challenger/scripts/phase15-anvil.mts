import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { bisectDisputeRegistryV1Abi, generateTraceCommitment } from "@bisect/sdk";
import {
  computeLeafHash,
  computeNodeHash,
  computeTraceRoot,
  createMerkleProof,
  createState,
  parsePublicInput,
  parseStateJson,
  type State,
} from "@bisect/vm";
import {
  type Abi,
  type Address,
  createPublicClient,
  createWalletClient,
  defineChain,
  type Hex,
  http,
  parseAbiItem,
  type TransactionReceipt,
} from "viem";
import { runOneCycle } from "../src/bot.ts";
import { loadChallengerConfig } from "../src/config.ts";
import { getSubtreeChildren } from "../src/evidence.ts";

const projectRoot = resolve(import.meta.dirname, "../../..");
const port = 18546;
const rpcUrl = `http://127.0.0.1:${port}`;
const foundryDirectory = process.platform === "win32" ? "foundry-v1.8.7" : "foundry-linux-v1.8.7";
const suffixes = process.platform === "win32" ? [".exe", ""] : [""];
const anvilPath = [
  ...suffixes.map((suffix) => join(projectRoot, ".tools", foundryDirectory, `anvil${suffix}`)),
  ...(process.env["PATH"] ?? "")
    .split(delimiter)
    .flatMap((directory) => suffixes.map((suffix) => join(directory, `anvil${suffix}`))),
].find(existsSync);
const artifactPath = join(
  projectRoot,
  "contracts",
  "out",
  "BisectDisputeRegistryV1.sol",
  "BisectDisputeRegistryV1.json",
);
const program = "0x010000050100002a09000000" as Hex;
const transitionCount = 63 as const;
const bond = 1_000_000_000_000_000n;

interface FoundryArtifact {
  readonly abi: Abi;
  readonly bytecode: { readonly object: Hex };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function toSolidityState(state: State) {
  return { pc: state.pc, halted: state.halted, registers: state.registers } as const;
}

function receiptCost(receipt: TransactionReceipt): bigint {
  return receipt.gasUsed * (receipt.effectiveGasPrice ?? 0n);
}

async function waitForRpc(
  client: ReturnType<typeof createPublicClient>,
  child: ReturnType<typeof spawn>,
): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Anvil exited with ${child.exitCode}.`);
    try {
      if ((await client.getChainId()) === 31337) return;
    } catch {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    }
  }
  throw new Error("Anvil did not become ready on port 18546.");
}

async function waitReceipt(
  client: ReturnType<typeof createPublicClient>,
  hash: Hex,
): Promise<TransactionReceipt> {
  const receipt = await client.waitForTransactionReceipt({ hash });
  assert(receipt.status === "success", `Transaction ${hash} reverted.`);
  return receipt;
}

async function callAnvil(method: string, params: readonly unknown[] = []): Promise<unknown> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body: unknown = await response.json();
  if (
    !response.ok ||
    typeof body !== "object" ||
    body === null ||
    !("result" in body) ||
    "error" in body
  ) {
    throw new Error(`Anvil RPC method ${method} failed.`);
  }
  return body.result;
}

async function submitClaim(
  client: ReturnType<typeof createPublicClient>,
  wallet: ReturnType<typeof createWalletClient>,
  account: Address,
  registry: Address,
  publicInput: ReturnType<typeof parsePublicInput>,
  traceRoot: Hex,
  traceStates: readonly State[],
  contextHash: Hex,
): Promise<TransactionReceipt> {
  const first = traceStates[0];
  const last = traceStates.at(-1);
  assert(first !== undefined && last !== undefined, "Trace endpoints missing.");
  const hash = await wallet.writeContract({
    account,
    chain: null,
    address: registry,
    abi: bisectDisputeRegistryV1Abi,
    functionName: "submitClaim",
    args: [
      {
        program,
        publicInput,
        transitionCount,
        traceRoot,
        claimedOutput: 42n,
        initialProof: {
          state: toSolidityState(first),
          siblings: createMerkleProof(contextHash, traceStates, 0),
        },
        finalProof: {
          state: toSolidityState(last),
          siblings: createMerkleProof(contextHash, traceStates, transitionCount),
        },
      },
    ],
    value: bond,
    gas: 1_000_000n,
  });
  return waitReceipt(client, hash);
}

async function main(): Promise<void> {
  if (anvilPath === undefined) throw new Error("Pinned Anvil executable is not installed.");
  const artifact: unknown = JSON.parse(await readFile(artifactPath, "utf8")) as unknown;
  assert(
    typeof artifact === "object" &&
      artifact !== null &&
      "abi" in artifact &&
      "bytecode" in artifact,
    "Foundry artifact is malformed.",
  );
  const foundry = artifact as FoundryArtifact;
  const temporaryState = await mkdtemp(join(tmpdir(), "bisect-phase15-"));
  const child = spawn(
    anvilPath,
    ["--host", "127.0.0.1", "--port", String(port), "--chain-id", "31337", "--silent"],
    {
      cwd: projectRoot,
      stdio: "ignore",
      windowsHide: true,
    },
  );
  const chain = defineChain({
    id: 31337,
    name: "Anvil Phase 15",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const unlockedWallet = createWalletClient({ chain, transport: http(rpcUrl) });

  try {
    await waitForRpc(publicClient, child);
    const accounts = await unlockedWallet.getAddresses();
    const proverAddress = accounts[0];
    const botAddress = accounts[1];
    assert(
      proverAddress !== undefined && botAddress !== undefined,
      "Anvil did not expose two test accounts.",
    );
    const prover = createWalletClient({ account: proverAddress, chain, transport: http(rpcUrl) });
    const deploymentHash = await prover.deployContract({
      abi: foundry.abi,
      bytecode: foundry.bytecode.object,
      args: [bond, 100, 20],
    });
    const deployment = await waitReceipt(publicClient, deploymentHash);
    const registry = deployment.contractAddress;
    if (registry === null || registry === undefined)
      throw new Error("Registry deployment omitted its address.");

    const honestInput = parsePublicInput([0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n]);
    const honestTrace = generateTraceCommitment({
      program,
      publicInput: honestInput,
      transitionCount,
    });
    const honestStates = honestTrace.states.map(parseStateJson);
    const honestClaimReceipt = await submitClaim(
      publicClient,
      prover,
      proverAddress,
      registry,
      honestInput,
      honestTrace.traceRoot,
      honestStates,
      honestTrace.executionContextHash,
    );

    const invalidInput = parsePublicInput([0n, 0n, 0n, 0n, 0n, 0n, 0n, 1n]);
    const canonical = generateTraceCommitment({
      program,
      publicInput: invalidInput,
      transitionCount,
    });
    const dishonestStates = canonical.states.map(parseStateJson);
    const altered = dishonestStates[1];
    assert(altered !== undefined, "Canonical trace omitted state one.");
    const registers = [...altered.registers];
    registers[7] = 9n;
    dishonestStates[1] = createState(altered.pc, altered.halted, registers);
    const dishonestRoot = computeTraceRoot(canonical.executionContextHash, dishonestStates);
    const dishonestClaimReceipt = await submitClaim(
      publicClient,
      prover,
      proverAddress,
      registry,
      invalidInput,
      dishonestRoot,
      dishonestStates,
      canonical.executionContextHash,
    );

    process.env["BISECT_BOT_RPC_URL"] = rpcUrl;
    process.env["BISECT_BOT_CHAIN_ID"] = "31337";
    process.env["BISECT_BOT_REGISTRY_ADDRESS"] = registry;
    process.env["BISECT_BOT_DEPLOYMENT_BLOCK"] = deployment.blockNumber.toString();
    process.env["BISECT_BOT_CONFIRMATIONS"] = "0";
    process.env["BISECT_BOT_MAX_RETRIES"] = "2";
    process.env["BISECT_BOT_MAX_TOTAL_SPEND_WEI"] = "1000000000000000000";
    process.env["BISECT_BOT_MAX_BOND_WEI"] = bond.toString();
    process.env["BISECT_BOT_MAX_GAS_PER_TX_WEI"] = "100000000000000000";
    process.env["BISECT_BOT_STATE_PATH"] = join(temporaryState, "state.json");
    process.env["BISECT_BOT_LOG_PATH"] = join(temporaryState, "bot.jsonl");
    process.env["BISECT_BOT_BROADCAST"] = "true";
    process.env["BISECT_BOT_USE_UNLOCKED_ACCOUNT"] = "true";
    process.env["BISECT_BOT_UNLOCKED_ADDRESS"] = botAddress;
    process.env["BISECT_BOT_ADDRESS"] = botAddress;
    const botConfig = loadChallengerConfig();
    await runOneCycle(botConfig, true);

    const dishonestClaimId = 2n;
    await runOneCycle(botConfig, true);
    const activeGame = await publicClient.readContract({
      address: registry,
      abi: bisectDisputeRegistryV1Abi,
      functionName: "activeGameNumber",
      args: [dishonestClaimId],
    });
    assert(
      activeGame === 1n,
      "Bot did not open a real dispute against the dishonest intermediate trace.",
    );

    const proverLevels = localTree(canonical.executionContextHash, dishonestStates);
    let bisectionRounds = 0;
    while (true) {
      const game = await publicClient.readContract({
        address: registry,
        abi: bisectDisputeRegistryV1Abi,
        functionName: "getGame",
        args: [dishonestClaimId, activeGame],
      });
      if (game.phase !== 1) break;
      const [leftChild, rightChild] = getSubtreeChildren(
        proverLevels,
        game.subtreeBaseIndex,
        game.subtreeHeight,
      );
      const hash = await prover.writeContract({
        chain: null,
        address: registry,
        abi: bisectDisputeRegistryV1Abi,
        functionName: "revealChildren",
        args: [dishonestClaimId, activeGame, leftChild, rightChild],
        gas: 500_000n,
      });
      await waitReceipt(publicClient, hash);
      await runOneCycle(botConfig, true);
      bisectionRounds += 1;
      if (bisectionRounds > 12) throw new Error("Bisection exceeded the protocol maximum depth.");
    }

    const terminalGame = await publicClient.readContract({
      address: registry,
      abi: bisectDisputeRegistryV1Abi,
      functionName: "getGame",
      args: [dishonestClaimId, activeGame],
    });
    assert(
      terminalGame.phase === 2 && terminalGame.differentIndex === 1,
      "Protocol did not isolate the first forged state.",
    );
    await runOneCycle(botConfig, true);
    const fraudulentTerminalProof = {
      program,
      publicInput: invalidInput,
      transitionCount,
      traceRoot: dishonestRoot,
      stateIndex: terminalGame.differentIndex - 1,
      predecessor: toSolidityState(dishonestStates[terminalGame.differentIndex - 1] as State),
      predecessorSiblings: createMerkleProof(
        canonical.executionContextHash,
        dishonestStates,
        terminalGame.differentIndex - 1,
      ),
      claimedSuccessor: toSolidityState(dishonestStates[terminalGame.differentIndex] as State),
      successorSiblings: createMerkleProof(
        canonical.executionContextHash,
        dishonestStates,
        terminalGame.differentIndex,
      ),
    };
    const proverTerminalHash = await prover.writeContract({
      chain: null,
      address: registry,
      abi: bisectDisputeRegistryV1Abi,
      functionName: "revealTerminal",
      args: [dishonestClaimId, activeGame, fraudulentTerminalProof],
      gas: 1_000_000n,
    });
    const proverTerminalReceipt = await waitReceipt(publicClient, proverTerminalHash);

    const finalGame = await publicClient.readContract({
      address: registry,
      abi: bisectDisputeRegistryV1Abi,
      functionName: "getGame",
      args: [dishonestClaimId, activeGame],
    });
    const finalClaim = await publicClient.readContract({
      address: registry,
      abi: bisectDisputeRegistryV1Abi,
      functionName: "getClaim",
      args: [dishonestClaimId],
    });
    const botCredit = await publicClient.readContract({
      address: registry,
      abi: bisectDisputeRegistryV1Abi,
      functionName: "withdrawableCredit",
      args: [botAddress],
    });
    const solvent = await publicClient.readContract({
      address: registry,
      abi: bisectDisputeRegistryV1Abi,
      functionName: "accountingInvariantHolds",
    });
    assert(
      finalGame.outcome === 3,
      "Contract did not classify the prover's transition as invalid.",
    );
    assert(finalClaim.status === 4, "Invalid claim was not refuted by the contract.");
    assert(
      botCredit === bond * 2n,
      "The challenger did not receive the exact two-bond pull credit.",
    );
    assert(solvent, "Contract escrow accounting invariant failed.");

    const stateFile = JSON.parse(await readFile(join(temporaryState, "state.json"), "utf8")) as {
      attemptedClaims: Record<string, { status: string; gameNumber?: string; reason?: string }>;
      spentWei: string;
    };
    assert(
      stateFile.attemptedClaims["1"]?.reason === "canonical execution root matches",
      "Honest claim was not recorded as ignored.",
    );
    assert(
      stateFile.attemptedClaims["2"]?.status === "confirmed",
      "Real challenge transaction was not persisted as confirmed.",
    );

    const cappedInput = parsePublicInput([0n, 0n, 0n, 0n, 0n, 0n, 0n, 2n]);
    const cappedCanonical = generateTraceCommitment({
      program,
      publicInput: cappedInput,
      transitionCount,
    });
    const cappedStates = cappedCanonical.states.map(parseStateJson);
    const cappedMiddle = cappedStates[1];
    assert(cappedMiddle !== undefined, "Capped trace omitted its intermediate state.");
    const cappedRegisters = [...cappedMiddle.registers];
    cappedRegisters[7] = 9n;
    cappedStates[1] = createState(cappedMiddle.pc, cappedMiddle.halted, cappedRegisters);
    const cappedRoot = computeTraceRoot(cappedCanonical.executionContextHash, cappedStates);
    const cappedClaimReceipt = await submitClaim(
      publicClient,
      prover,
      proverAddress,
      registry,
      cappedInput,
      cappedRoot,
      cappedStates,
      cappedCanonical.executionContextHash,
    );
    process.env["BISECT_BOT_MAX_TOTAL_SPEND_WEI"] = stateFile.spentWei;
    const cappedConfig = loadChallengerConfig();
    await runOneCycle(cappedConfig, true);
    const cappedAttempt = (
      JSON.parse(await readFile(join(temporaryState, "state.json"), "utf8")) as typeof stateFile
    ).attemptedClaims["3"];
    assert(
      cappedAttempt === undefined,
      "Spend-cap refusal must not reserve or submit another bond.",
    );

    const unfundedAddress = "0x000000000000000000000000000000000000dead" as Address;
    const unfundedConfig = loadChallengerConfig({
      ...process.env,
      BISECT_BOT_ADDRESS: unfundedAddress,
      BISECT_BOT_UNLOCKED_ADDRESS: unfundedAddress,
      BISECT_BOT_MAX_TOTAL_SPEND_WEI: "1000000000000000000",
      BISECT_BOT_STATE_PATH: join(temporaryState, "unfunded", "state.json"),
      BISECT_BOT_LOG_PATH: join(temporaryState, "unfunded", "bot.jsonl"),
    });
    await runOneCycle(unfundedConfig, true);
    const unfundedLog = await readFile(join(temporaryState, "unfunded", "bot.jsonl"), "utf8");
    assert(
      unfundedLog.includes("insufficient test ETH for the exact challenge bond") &&
        (await publicClient.readContract({
          address: registry,
          abi: bisectDisputeRegistryV1Abi,
          functionName: "activeGameNumber",
          args: [3n],
        })) === 0n,
      "An unfunded signer must be refused before challenge submission.",
    );

    const indexedFrom = deployment.blockNumber;
    const indexedTo = await publicClient.getBlockNumber();
    const claims = await publicClient.getContractEvents({
      address: registry,
      abi: [
        parseAbiItem(
          "event ClaimSubmitted(uint256 indexed claimId,address indexed prover,bytes32 indexed contextHash,bytes32 traceRoot,uint16 transitionCount,uint64 claimedOutput,uint256 challengeDeadline,uint96 bondWei)",
        ),
      ],
      eventName: "ClaimSubmitted",
      fromBlock: indexedFrom,
      toBlock: indexedTo,
    });
    const challenges = await publicClient.getContractEvents({
      address: registry,
      abi: [
        parseAbiItem(
          "event ChallengeStarted(uint256 indexed claimId,uint256 indexed gameNumber,address indexed challenger,bytes32 challengerRoot,uint16 initialHeight,address expectedResponder,uint256 deadlineBlock,uint96 bondWei)",
        ),
      ],
      eventName: "ChallengeStarted",
      fromBlock: indexedFrom,
      toBlock: indexedTo,
    });
    const credits = await publicClient.getContractEvents({
      address: registry,
      abi: [
        parseAbiItem(
          "event GameBondCredited(uint256 indexed claimId,uint256 indexed gameNumber,address indexed beneficiary,uint256 amountWei,uint8 outcome)",
        ),
      ],
      eventName: "GameBondCredited",
      fromBlock: indexedFrom,
      toBlock: indexedTo,
    });
    const resolutions = await publicClient.getContractEvents({
      address: registry,
      abi: [
        parseAbiItem(
          "event GameResolved(uint256 indexed claimId,uint256 indexed gameNumber,uint8 outcome,address indexed winner,uint16 differentIndex,uint8 claimStatus,uint256 proverBondCreditWei,uint256 challengerBondCreditWei)",
        ),
      ],
      eventName: "GameResolved",
      fromBlock: indexedFrom,
      toBlock: indexedTo,
    });
    const withdrawals = await publicClient.getContractEvents({
      address: registry,
      abi: [parseAbiItem("event Withdrawal(address indexed account,uint256 amountWei)")],
      eventName: "Withdrawal",
      fromBlock: indexedFrom,
      toBlock: indexedTo,
    });
    const finalized = await publicClient.getContractEvents({
      address: registry,
      abi: [
        parseAbiItem(
          "event ClaimFinalized(uint256 indexed claimId,address indexed prover,uint96 bondWei)",
        ),
      ],
      eventName: "ClaimFinalized",
      fromBlock: indexedFrom,
      toBlock: indexedTo,
    });
    const depositedWei =
      claims.reduce((sum, event) => sum + (event.args.bondWei ?? 0n), 0n) +
      challenges.reduce((sum, event) => sum + (event.args.bondWei ?? 0n), 0n);
    const creditedWei =
      credits.reduce((sum, event) => sum + (event.args.amountWei ?? 0n), 0n) +
      finalized.reduce((sum, event) => sum + (event.args.bondWei ?? 0n), 0n);
    const withdrawnWei = withdrawals.reduce((sum, event) => sum + (event.args.amountWei ?? 0n), 0n);
    const eventDerivedLocked = depositedWei - creditedWei;
    const contractLocked = await publicClient.readContract({
      address: registry,
      abi: bisectDisputeRegistryV1Abi,
      functionName: "totalLockedBonds",
    });
    const contractCredits = await publicClient.readContract({
      address: registry,
      abi: bisectDisputeRegistryV1Abi,
      functionName: "totalCredits",
    });
    const contractLiabilities = await publicClient.readContract({
      address: registry,
      abi: bisectDisputeRegistryV1Abi,
      functionName: "totalLiabilities",
    });
    const custodyBalance = await publicClient.getBalance({ address: registry });
    assert(
      claims.length === 3 &&
        challenges.length === 1 &&
        credits.length === 1 &&
        resolutions.length === 1,
      "Event replay did not reconstruct the expected single disputed settlement.",
    );
    assert(
      resolutions[0]?.args.winner?.toLowerCase() === botAddress.toLowerCase(),
      "Settlement event winner does not match the bot wallet.",
    );
    assert(
      eventDerivedLocked === contractLocked && creditedWei - withdrawnWei === contractCredits,
      "Event-derived locked/credit balances do not match contract state.",
    );
    assert(
      depositedWei - withdrawnWei === contractLiabilities && custodyBalance >= contractLiabilities,
      "Event-derived liabilities do not reconcile to escrow custody.",
    );
    const receiptSet = await getContractReceipts(
      publicClient,
      deployment.blockNumber,
      await publicClient.getBlockNumber(),
      registry,
    );
    const totalGasCost = receiptSet.reduce((sum, receipt) => sum + receiptCost(receipt), 0n);

    const reorgSnapshot = await callAnvil("evm_snapshot");
    assert(typeof reorgSnapshot === "string", "Anvil snapshot did not return an identifier.");
    const firstBranchHash = await prover.sendTransaction({
      chain: null,
      account: proverAddress,
      to: botAddress,
      value: 1n,
      gas: 21_000n,
    });
    await waitReceipt(publicClient, firstBranchHash);
    await runOneCycle(cappedConfig, true);
    const reverted = await callAnvil("evm_revert", [reorgSnapshot]);
    assert(reverted === true, "Anvil could not restore the controlled reorganization snapshot.");
    const replacementBranchHash = await prover.sendTransaction({
      chain: null,
      account: proverAddress,
      to: botAddress,
      value: 2n,
      gas: 21_000n,
    });
    await waitReceipt(publicClient, replacementBranchHash);
    await runOneCycle(cappedConfig, true);
    const operationalLog = await readFile(join(temporaryState, "bot.jsonl"), "utf8");
    assert(
      operationalLog.includes('"event":"reorganization_detected"'),
      "Bot did not detect and rescan after the controlled reorganization.",
    );
    const afterReorgState = JSON.parse(
      await readFile(join(temporaryState, "state.json"), "utf8"),
    ) as typeof stateFile;
    const cappedClaimGame = await publicClient.readContract({
      address: registry,
      abi: bisectDisputeRegistryV1Abi,
      functionName: "activeGameNumber",
      args: [3n],
    });
    assert(
      afterReorgState.attemptedClaims["3"] === undefined && cappedClaimGame === 0n,
      "Reorganization replay bypassed the retained spend cap or repeated the refused challenge.",
    );

    const balanceBeforeOutage = await publicClient.getBalance({ address: botAddress });
    const outageConfig = loadChallengerConfig({
      ...process.env,
      BISECT_BOT_RPC_URL: "http://127.0.0.1:1",
    });
    let outageRejected = false;
    try {
      await runOneCycle(outageConfig, true);
    } catch {
      outageRejected = true;
    }
    assert(outageRejected, "Bot continued despite an unavailable RPC endpoint.");
    assert(
      (await publicClient.getBalance({ address: botAddress })) === balanceBeforeOutage,
      "RPC outage caused an unauthorized transaction or value change.",
    );

    console.log(
      JSON.stringify(
        {
          phase: "15",
          result: "PASS",
          chainId: 31337,
          registry,
          honestClaimId: "1",
          dishonestClaimId: dishonestClaimId.toString(),
          canonicalOutput: "42",
          claimedOutput: "42",
          dishonestRoot: dishonestRoot,
          canonicalRoot: canonical.traceRoot,
          bisectionRounds,
          transactions: receiptSet.length,
          measuredGasUsed: receiptSet
            .reduce((sum, receipt) => sum + receipt.gasUsed, 0n)
            .toString(),
          measuredGasCostWei: totalGasCost.toString(),
          measuredBotSpendWei: stateFile.spentWei,
          outcome: finalGame.outcome,
          botPullCreditWei: botCredit.toString(),
          escrowInvariant: solvent,
          confirmedReceipts: receiptSet.length,
          finalProverResolutionTx: proverTerminalReceipt.transactionHash,
          honestClaimTx: honestClaimReceipt.transactionHash,
          dishonestClaimTx: dishonestClaimReceipt.transactionHash,
          spendCapClaimTx: cappedClaimReceipt.transactionHash,
          indexedDepositsWei: depositedWei.toString(),
          eventDerivedLockedWei: eventDerivedLocked.toString(),
          eventDerivedCreditsWei: (creditedWei - withdrawnWei).toString(),
          contractLiabilitiesWei: contractLiabilities.toString(),
          contractCustodyWei: custodyBalance.toString(),
          escrowEventAccountingReconciliation: "PASS",
          insufficientTestEth: "refused without a transaction",
          controlledReorganization: "detected and rescanned",
          rpcOutage: outageRejected ? "failed closed with no transaction" : "not verified",
          traceAvailability:
            "program/input and roots are on-chain; the bot independently reconstructs the canonical trace",
        },
        null,
        2,
      ),
    );
  } finally {
    child.kill();
    await rm(temporaryState, { recursive: true, force: true });
  }
}

function localTree(contextHash: Hex, states: readonly State[]): Hex[][] {
  let level = states.map((state, index) => computeLeafHash(contextHash, index, state));
  const levels = [level];
  while (level.length > 1) {
    const next: Hex[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index];
      const right = level[index + 1];
      assert(left !== undefined && right !== undefined, "Incomplete prover trace tree.");
      next.push(computeNodeHash(left, right));
    }
    levels.push(next);
    level = next;
  }
  return levels;
}

async function getContractReceipts(
  client: ReturnType<typeof createPublicClient>,
  fromBlock: bigint,
  toBlock: bigint,
  registry: Address,
): Promise<TransactionReceipt[]> {
  const receipts: TransactionReceipt[] = [];
  for (let number = fromBlock; number <= toBlock; number += 1n) {
    const block = await client.getBlock({ blockNumber: number, includeTransactions: true });
    for (const transaction of block.transactions) {
      if (typeof transaction === "string") continue;
      if (transaction.to?.toLowerCase() === registry.toLowerCase() || transaction.to === null) {
        receipts.push(await client.getTransactionReceipt({ hash: transaction.hash }));
      }
    }
  }
  return receipts;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
