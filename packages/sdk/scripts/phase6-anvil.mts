import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { delimiter, join, resolve } from "node:path";
import { createTraceCommitment } from "@bisect/merkle";
import {
  computeLeafHash,
  computeNodeHash,
  computeTraceRoot,
  createMerkleProof,
  createState,
  parseStateJson,
  type State,
} from "@bisect/vm";
import {
  type Abi,
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  type Hex,
  http,
  type TransactionReceipt,
} from "viem";
import { bisectDisputeRegistryV1Abi } from "../src/abis/bisectDisputeRegistryV1.js";

const root = resolve(import.meta.dirname, "../../..");
const port = 18545;
const rpcUrl = `http://127.0.0.1:${port}`;
const foundryDirectory = process.platform === "win32" ? "foundry-v1.8.7" : "foundry-linux-v1.8.7";
const suffixes = process.platform === "win32" ? [".exe", ""] : [""];
const anvilCandidates = [
  ...suffixes.map((suffix) => join(root, ".tools", foundryDirectory, `anvil${suffix}`)),
  ...(process.env["PATH"] ?? "")
    .split(delimiter)
    .flatMap((directory) => suffixes.map((suffix) => join(directory, `anvil${suffix}`))),
];
const anvilPath = anvilCandidates.find(existsSync);
const artifactPath = join(
  root,
  "contracts",
  "out",
  "BisectDisputeRegistryV1.sol",
  "BisectDisputeRegistryV1.json",
);
const bond = 1_000_000_000_000_000_000n;
const budget = 63 as const;
const program = "0x010000050100002a09000000" as Hex;
const publicInput = [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n] as const;
const localAnvil = defineChain({
  id: 31337,
  name: "Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});

interface FoundryArtifact {
  readonly abi: Abi;
  readonly bytecode: { readonly object: Hex };
}

function isArtifact(value: unknown): value is FoundryArtifact {
  if (typeof value !== "object" || value === null) return false;
  const artifact = value as { readonly abi?: unknown; readonly bytecode?: unknown };
  if (
    !Array.isArray(artifact.abi) ||
    typeof artifact.bytecode !== "object" ||
    artifact.bytecode === null
  ) {
    return false;
  }
  const bytecode = artifact.bytecode as { readonly object?: unknown };
  return typeof bytecode.object === "string" && bytecode.object.startsWith("0x");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function mineAnvilBlocks(count: number): Promise<void> {
  if (!Number.isInteger(count) || count < 1 || count > 32) {
    throw new Error(`Refusing to mine an invalid local block count: ${count}.`);
  }
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "anvil_mine",
      params: [`0x${count.toString(16)}`],
    }),
  });
  const body: unknown = await response.json();
  if (!response.ok || !isRecord(body) || body["error"] !== undefined) {
    throw new Error("Anvil refused the bounded local block-mine request.");
  }
}

async function waitForAnvil(
  processHandle: ReturnType<typeof spawn>,
  client: ReturnType<typeof createPublicClient>,
): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (processHandle.exitCode !== null)
      throw new Error(`Anvil exited with ${processHandle.exitCode}.`);
    try {
      if ((await client.getChainId()) === 31337) return;
    } catch {
      await delay(250);
    }
  }
  throw new Error("Anvil JSON-RPC did not become ready on the isolated local port.");
}

async function sendAndWait(
  publicClient: ReturnType<typeof createPublicClient>,
  transactionHash: Hex,
  receipts: TransactionReceipt[],
): Promise<TransactionReceipt> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash });
  if (receipt.status !== "success") {
    const transaction = await publicClient.getTransaction({ hash: transactionHash });
    let reason = "revert data unavailable";
    try {
      await publicClient.call({
        account: transaction.from,
        to: transaction.to ?? undefined,
        data: transaction.input,
        value: transaction.value,
      });
      reason = "eth_call succeeded after the mined revert";
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error);
    }
    throw new Error(
      `Transaction ${transactionHash} reverted: ${reason}; sender=${transaction.from}; gas=${transaction.gas}; gasUsed=${receipt.gasUsed}; input=${transaction.input.slice(0, 10)}`,
    );
  }
  receipts.push(receipt);
  return receipt;
}

function treeLevels(contextHash: Hex, trace: readonly State[]): Hex[][] {
  let level = trace.map((state, index) => computeLeafHash(contextHash, index, state));
  const levels = [level];
  while (level.length > 1) {
    const next: Hex[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index];
      const right = level[index + 1];
      if (left === undefined || right === undefined) throw new Error("Incomplete trace tree pair.");
      next.push(computeNodeHash(left, right));
    }
    levels.push(next);
    level = next;
  }
  return levels;
}

function siblingsFor(contextHash: Hex, trace: readonly State[], index: number): readonly Hex[] {
  return createMerkleProof(contextHash, trace, index);
}

function stateTuple(state: State) {
  return { pc: state.pc, halted: state.halted, registers: [...state.registers] } as const;
}

async function main(): Promise<void> {
  if (anvilPath === undefined) {
    throw new Error("Anvil is missing from PATH and the pinned repository tool directory.");
  }
  const artifactValue: unknown = JSON.parse(await readFile(artifactPath, "utf8")) as unknown;
  if (!isArtifact(artifactValue)) throw new Error("Foundry dispute artifact is malformed.");

  const anvil = spawn(
    anvilPath,
    ["--host", "127.0.0.1", "--port", String(port), "--chain-id", "31337", "--silent"],
    {
      cwd: root,
      stdio: "ignore",
      windowsHide: true,
    },
  );
  const publicClient = createPublicClient({ chain: localAnvil, transport: http(rpcUrl) });
  const unlockedWallet = createWalletClient({ chain: localAnvil, transport: http(rpcUrl) });
  const receipts: TransactionReceipt[] = [];

  try {
    await waitForAnvil(anvil, publicClient);
    const [prover, challenger] = await unlockedWallet.getAddresses();
    if (prover === undefined || challenger === undefined)
      throw new Error("Anvil exposed fewer than two accounts.");
    const proverWallet = createWalletClient({
      account: prover,
      chain: localAnvil,
      transport: http(rpcUrl),
    });
    const challengerWallet = createWalletClient({
      account: challenger,
      chain: localAnvil,
      transport: http(rpcUrl),
    });
    const initialProverBalance = await publicClient.getBalance({ address: prover });
    const initialChallengerBalance = await publicClient.getBalance({ address: challenger });

    const deploymentHash = await proverWallet.deployContract({
      abi: artifactValue.abi,
      bytecode: artifactValue.bytecode.object,
      args: [bond, 5, 3],
    });
    const deploymentReceipt = await sendAndWait(publicClient, deploymentHash, receipts);
    const registryAddress = deploymentReceipt.contractAddress;
    if (registryAddress === null || registryAddress === undefined) {
      throw new Error("Deployment receipt omitted its contract address.");
    }

    const honestArtifact = createTraceCommitment(program, publicInput, budget);
    const honestTrace = honestArtifact.states.map(parseStateJson);
    const fraudulentTrace = [...honestTrace];
    const stateOne = fraudulentTrace[1];
    if (stateOne === undefined) throw new Error("Canonical trace has no state one.");
    fraudulentTrace[1] = createState(stateOne.pc, stateOne.halted, [
      9n,
      ...stateOne.registers.slice(1),
    ]);
    const fraudulentRoot = computeTraceRoot(honestArtifact.executionContextHash, fraudulentTrace);
    const honestRoot = honestArtifact.traceRoot;
    const honestInitial = honestTrace[0];
    const fraudulentInitial = fraudulentTrace[0];
    const honestTerminal = honestTrace[budget];
    const fraudulentTerminal = fraudulentTrace[budget];
    if (
      honestInitial === undefined ||
      fraudulentInitial === undefined ||
      honestTerminal === undefined ||
      fraudulentTerminal === undefined
    ) {
      throw new Error("Canonical execution trace is missing an endpoint.");
    }

    const submitHash = await proverWallet.writeContract({
      address: registryAddress,
      abi: bisectDisputeRegistryV1Abi,
      functionName: "submitClaim",
      args: [
        {
          program,
          publicInput,
          transitionCount: budget,
          traceRoot: fraudulentRoot,
          claimedOutput: 42n,
          initialProof: {
            state: stateTuple(fraudulentInitial),
            siblings: siblingsFor(honestArtifact.executionContextHash, fraudulentTrace, 0),
          },
          finalProof: {
            state: stateTuple(fraudulentTerminal),
            siblings: siblingsFor(honestArtifact.executionContextHash, fraudulentTrace, budget),
          },
        },
      ],
      value: bond,
      gas: 1_000_000n,
    });
    await sendAndWait(publicClient, submitHash, receipts);
    const claimId = 1n;

    const challengeHash = await challengerWallet.writeContract({
      address: registryAddress,
      abi: bisectDisputeRegistryV1Abi,
      functionName: "challenge",
      args: [
        claimId,
        honestRoot,
        {
          state: stateTuple(honestInitial),
          siblings: siblingsFor(honestArtifact.executionContextHash, honestTrace, 0),
        },
      ],
      value: bond,
      gas: 600_000n,
    });
    await sendAndWait(publicClient, challengeHash, receipts);
    const gameNumber = 1n;

    const proverLevels = treeLevels(honestArtifact.executionContextHash, fraudulentTrace);
    const challengerLevels = treeLevels(honestArtifact.executionContextHash, honestTrace);
    let baseIndex = 0;
    let height = 6;
    let rounds = 0;
    for (; height > 0; height -= 1) {
      const childLevel = height - 1;
      const childPosition = baseIndex >> childLevel;
      const proverLeft = proverLevels[childLevel]?.[childPosition];
      const proverRight = proverLevels[childLevel]?.[childPosition + 1];
      const challengerLeft = challengerLevels[childLevel]?.[childPosition];
      const challengerRight = challengerLevels[childLevel]?.[childPosition + 1];
      if (
        proverLeft === undefined ||
        proverRight === undefined ||
        challengerLeft === undefined ||
        challengerRight === undefined
      ) {
        throw new Error("Merkle tree omitted a required bisection child.");
      }

      if (rounds === 0) {
        const initialGame = await publicClient.readContract({
          address: registryAddress,
          abi: bisectDisputeRegistryV1Abi,
          functionName: "getGame",
          args: [claimId, gameNumber],
        });
        const proverClaim = await publicClient.readContract({
          address: registryAddress,
          abi: bisectDisputeRegistryV1Abi,
          functionName: "getClaim",
          args: [claimId],
        });
        if (
          initialGame.expectedResponder.toLowerCase() !== prover.toLowerCase() ||
          proverClaim.prover.toLowerCase() !== prover.toLowerCase() ||
          computeNodeHash(proverLeft, proverRight) !== fraudulentRoot
        ) {
          throw new Error(
            "Initial game turn or TypeScript prover subtree does not match stored commitments.",
          );
        }
        await publicClient.simulateContract({
          account: prover,
          address: registryAddress,
          abi: bisectDisputeRegistryV1Abi,
          functionName: "revealChildren",
          args: [claimId, gameNumber, proverLeft, proverRight],
        });
      }

      const proverRevealHash = await proverWallet.writeContract({
        address: registryAddress,
        abi: bisectDisputeRegistryV1Abi,
        functionName: "revealChildren",
        args: [claimId, gameNumber, proverLeft, proverRight],
        // Local Anvil estimation returned the exact gas limit and reverted on the cold storage update.
        // This is only a transaction ceiling; the report uses mined receipt gasUsed.
        gas: 300_000n,
      });
      await sendAndWait(publicClient, proverRevealHash, receipts);
      const challengerRevealHash = await challengerWallet.writeContract({
        address: registryAddress,
        abi: bisectDisputeRegistryV1Abi,
        functionName: "revealChildren",
        args: [claimId, gameNumber, challengerLeft, challengerRight],
        gas: 300_000n,
      });
      await sendAndWait(publicClient, challengerRevealHash, receipts);
      rounds += 1;

      if (proverLeft === challengerLeft) baseIndex += 2 ** childLevel;
    }
    if (baseIndex !== 1) throw new Error(`Dispute isolated state ${baseIndex}; expected state 1.`);

    function terminalProof(trace: readonly State[], traceRoot: Hex) {
      const predecessor = trace[0];
      const successor = trace[1];
      if (predecessor === undefined || successor === undefined)
        throw new Error("Missing terminal states.");
      return {
        program,
        publicInput,
        transitionCount: budget,
        traceRoot,
        stateIndex: 0,
        predecessor: stateTuple(predecessor),
        predecessorSiblings: siblingsFor(honestArtifact.executionContextHash, trace, 0),
        claimedSuccessor: stateTuple(successor),
        successorSiblings: siblingsFor(honestArtifact.executionContextHash, trace, 1),
      } as const;
    }

    const challengerTerminalHash = await challengerWallet.writeContract({
      address: registryAddress,
      abi: bisectDisputeRegistryV1Abi,
      functionName: "revealTerminal",
      args: [claimId, gameNumber, terminalProof(honestTrace, honestRoot)],
      gas: 1_000_000n,
    });
    await sendAndWait(publicClient, challengerTerminalHash, receipts);
    const proverTerminalHash = await proverWallet.writeContract({
      address: registryAddress,
      abi: bisectDisputeRegistryV1Abi,
      functionName: "revealTerminal",
      args: [claimId, gameNumber, terminalProof(fraudulentTrace, fraudulentRoot)],
      gas: 1_000_000n,
    });
    const terminalReceipt = await sendAndWait(publicClient, proverTerminalHash, receipts);

    const creditBeforeWithdrawal = await publicClient.readContract({
      address: registryAddress,
      abi: bisectDisputeRegistryV1Abi,
      functionName: "withdrawableCredit",
      args: [challenger],
    });
    const creditProver = await publicClient.readContract({
      address: registryAddress,
      abi: bisectDisputeRegistryV1Abi,
      functionName: "withdrawableCredit",
      args: [prover],
    });
    if (creditBeforeWithdrawal !== 2n * bond || creditProver !== 0n) {
      throw new Error("Terminal settlement did not credit exactly both bonds to the challenger.");
    }

    const beforeWithdrawalBalance = await publicClient.getBalance({ address: challenger });
    const withdrawalHash = await challengerWallet.writeContract({
      address: registryAddress,
      abi: bisectDisputeRegistryV1Abi,
      functionName: "withdraw",
      gas: 150_000n,
    });
    const withdrawalReceipt = await sendAndWait(publicClient, withdrawalHash, receipts);
    const afterWithdrawalBalance = await publicClient.getBalance({ address: challenger });
    const withdrawalFee = withdrawalReceipt.gasUsed * withdrawalReceipt.effectiveGasPrice;
    const expectedNetBalanceDelta = 2n * bond - withdrawalFee;
    if (afterWithdrawalBalance - beforeWithdrawalBalance !== expectedNetBalanceDelta) {
      throw new Error(
        "Challenger wallet balance delta does not match the real withdrawal less gas.",
      );
    }

    const claim = await publicClient.readContract({
      address: registryAddress,
      abi: bisectDisputeRegistryV1Abi,
      functionName: "getClaim",
      args: [claimId],
    });
    const game = await publicClient.readContract({
      address: registryAddress,
      abi: bisectDisputeRegistryV1Abi,
      functionName: "getGame",
      args: [claimId, gameNumber],
    });
    const locked = await publicClient.readContract({
      address: registryAddress,
      abi: bisectDisputeRegistryV1Abi,
      functionName: "totalLockedBonds",
    });
    const credits = await publicClient.readContract({
      address: registryAddress,
      abi: bisectDisputeRegistryV1Abi,
      functionName: "totalCredits",
    });
    const liabilities = await publicClient.readContract({
      address: registryAddress,
      abi: bisectDisputeRegistryV1Abi,
      functionName: "totalLiabilities",
    });
    const contractBalance = await publicClient.getBalance({ address: registryAddress });
    if (
      claim.status !== 4 ||
      game.outcome !== 3 ||
      !game.settled ||
      locked !== 0n ||
      credits !== 0n ||
      liabilities !== 0n ||
      contractBalance !== 0n
    ) {
      throw new Error(
        "Final on-chain claim, game, or escrow state does not match the expected result.",
      );
    }

    const decodedEvents: Array<{ readonly name: string; readonly args: Record<string, unknown> }> =
      [];
    for (const receipt of receipts) {
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== registryAddress.toLowerCase()) continue;
        try {
          const decoded = decodeEventLog({
            abi: bisectDisputeRegistryV1Abi,
            topics: log.topics,
            data: log.data,
            strict: false,
          });
          if (isRecord(decoded.args)) {
            decodedEvents.push({ name: decoded.eventName, args: decoded.args });
          }
        } catch {
          // Ignore logs from inherited contracts that are not part of this registry ABI.
        }
      }
    }
    const resolved = decodedEvents.find((event) => event.name === "GameResolved");
    const credited = decodedEvents.find((event) => event.name === "GameBondCredited");
    const withdrawn = decodedEvents.find((event) => event.name === "Withdrawal");
    const challengeStarted = decodedEvents.find((event) => event.name === "ChallengeStarted");
    const bisectionEvents = decodedEvents.filter(
      (event) => event.name === "BisectionLevelResolved",
    );
    const childRevealCount = decodedEvents.filter(
      (event) => event.name === "DisputeChildrenRevealed",
    ).length;
    const terminalEvents = decodedEvents.filter(
      (event) => event.name === "TerminalEvidenceRevealed",
    );
    if (
      challengeStarted?.args["challenger"] !== challenger ||
      challengeStarted.args["challengerRoot"] !== honestRoot ||
      bisectionEvents.length !== 6 ||
      childRevealCount !== 12 ||
      bisectionEvents.some(
        (event, index) =>
          event.args["subtreeHeight"] !== 5 - index ||
          event.args["subtreeBaseIndex"] !== (index === 5 ? 1 : 0) ||
          event.args["differentIndex"] !== (index === 5 ? 1 : 0),
      ) ||
      terminalEvents.some(
        (event) =>
          event.args["differentIndex"] !== 1 ||
          event.args["previousStateHash"] !== terminalEvents[0]?.args["previousStateHash"],
      ) ||
      resolved?.args["winner"] !== challenger ||
      resolved.args["claimId"] !== claimId ||
      resolved.args["gameNumber"] !== gameNumber ||
      resolved.args["outcome"] !== 3 ||
      resolved.args["differentIndex"] !== 1 ||
      resolved.args["claimStatus"] !== 4 ||
      resolved.args["proverBondCreditWei"] !== 0n ||
      resolved.args["challengerBondCreditWei"] !== 2n * bond ||
      credited?.args["claimId"] !== claimId ||
      credited.args["gameNumber"] !== gameNumber ||
      credited?.args["amountWei"] !== 2n * bond ||
      credited.args["beneficiary"] !== challenger ||
      withdrawn?.args["account"] !== challenger ||
      withdrawn.args["amountWei"] !== 2n * bond ||
      terminalEvents.length !== 2
    ) {
      throw new Error("Mined registry events do not reconstruct the game result and withdrawal.");
    }

    // A separate real game demonstrates the specified outcome when a prover withholds its
    // required trace response. The challenger rebuilds its valid trace from the stored context;
    // no prover archive or trace download is needed to open the challenge.
    const availabilityBudget = 255 as const;
    const availabilityHonestArtifact = createTraceCommitment(
      program,
      publicInput,
      availabilityBudget,
    );
    const availabilityHonestTrace = availabilityHonestArtifact.states.map(parseStateJson);
    const availabilityFraudulentTrace = [...availabilityHonestTrace];
    const availabilityStateOne = availabilityFraudulentTrace[1];
    if (availabilityStateOne === undefined) {
      throw new Error("Availability scenario trace has no intermediate state.");
    }
    availabilityFraudulentTrace[1] = createState(availabilityStateOne.pc, false, [
      9n,
      ...availabilityStateOne.registers.slice(1),
    ]);
    const availabilityFraudulentRoot = computeTraceRoot(
      availabilityHonestArtifact.executionContextHash,
      availabilityFraudulentTrace,
    );
    if (availabilityFraudulentRoot === availabilityHonestArtifact.traceRoot) {
      throw new Error("Availability scenario did not change the intermediate commitment.");
    }
    const availabilityInitial = availabilityHonestTrace[0];
    const availabilityFraudulentInitial = availabilityFraudulentTrace[0];
    const availabilityFraudulentFinal = availabilityFraudulentTrace[availabilityBudget];
    if (
      availabilityInitial === undefined ||
      availabilityFraudulentInitial === undefined ||
      availabilityFraudulentFinal === undefined
    ) {
      throw new Error("Availability scenario is missing an endpoint state.");
    }

    const unavailableClaimHash = await proverWallet.writeContract({
      address: registryAddress,
      abi: bisectDisputeRegistryV1Abi,
      functionName: "submitClaim",
      args: [
        {
          program,
          publicInput,
          transitionCount: availabilityBudget,
          traceRoot: availabilityFraudulentRoot,
          claimedOutput: 42n,
          initialProof: {
            state: stateTuple(availabilityFraudulentInitial),
            siblings: siblingsFor(
              availabilityHonestArtifact.executionContextHash,
              availabilityFraudulentTrace,
              0,
            ),
          },
          finalProof: {
            state: stateTuple(availabilityFraudulentFinal),
            siblings: siblingsFor(
              availabilityHonestArtifact.executionContextHash,
              availabilityFraudulentTrace,
              availabilityBudget,
            ),
          },
        },
      ],
      value: bond,
      gas: 1_000_000n,
    });
    await sendAndWait(publicClient, unavailableClaimHash, receipts);
    const unavailableClaimId = 2n;
    const unavailableChallengeHash = await challengerWallet.writeContract({
      address: registryAddress,
      abi: bisectDisputeRegistryV1Abi,
      functionName: "challenge",
      args: [
        unavailableClaimId,
        availabilityHonestArtifact.traceRoot,
        {
          state: stateTuple(availabilityInitial),
          siblings: siblingsFor(
            availabilityHonestArtifact.executionContextHash,
            availabilityHonestTrace,
            0,
          ),
        },
      ],
      value: bond,
      gas: 600_000n,
    });
    await sendAndWait(publicClient, unavailableChallengeHash, receipts);
    const unavailableGameNumber = 1n;
    const unavailableGameBeforeTimeout = await publicClient.readContract({
      address: registryAddress,
      abi: bisectDisputeRegistryV1Abi,
      functionName: "getGame",
      args: [unavailableClaimId, unavailableGameNumber],
    });
    if (unavailableGameBeforeTimeout.expectedResponder.toLowerCase() !== prover.toLowerCase()) {
      throw new Error("A withheld-data game did not give the first response to the prover.");
    }
    const currentBlock = await publicClient.getBlockNumber();
    const blocksUntilTimeout = unavailableGameBeforeTimeout.deadlineBlock - currentBlock + 1n;
    if (blocksUntilTimeout < 1n || blocksUntilTimeout > 32n) {
      throw new Error("Unexpected turn deadline for the withheld-data demonstration.");
    }
    await mineAnvilBlocks(Number(blocksUntilTimeout));
    const withheldTimeoutHash = await challengerWallet.writeContract({
      address: registryAddress,
      abi: bisectDisputeRegistryV1Abi,
      functionName: "claimTimeout",
      args: [unavailableClaimId, unavailableGameNumber],
      gas: 500_000n,
    });
    const withheldTimeoutReceipt = await sendAndWait(publicClient, withheldTimeoutHash, receipts);
    const unavailableGame = await publicClient.readContract({
      address: registryAddress,
      abi: bisectDisputeRegistryV1Abi,
      functionName: "getGame",
      args: [unavailableClaimId, unavailableGameNumber],
    });
    const unavailableClaim = await publicClient.readContract({
      address: registryAddress,
      abi: bisectDisputeRegistryV1Abi,
      functionName: "getClaim",
      args: [unavailableClaimId],
    });
    const unavailableCredit = await publicClient.readContract({
      address: registryAddress,
      abi: bisectDisputeRegistryV1Abi,
      functionName: "withdrawableCredit",
      args: [challenger],
    });
    const timeoutLocked = await publicClient.readContract({
      address: registryAddress,
      abi: bisectDisputeRegistryV1Abi,
      functionName: "totalLockedBonds",
    });
    const timeoutCredits = await publicClient.readContract({
      address: registryAddress,
      abi: bisectDisputeRegistryV1Abi,
      functionName: "totalCredits",
    });
    const timeoutLiabilities = await publicClient.readContract({
      address: registryAddress,
      abi: bisectDisputeRegistryV1Abi,
      functionName: "totalLiabilities",
    });
    const timeoutContractBalance = await publicClient.getBalance({ address: registryAddress });
    const timeoutSolvency = await publicClient.readContract({
      address: registryAddress,
      abi: bisectDisputeRegistryV1Abi,
      functionName: "accountingInvariantHolds",
    });
    const timeoutEvents: Array<{
      readonly name: string;
      readonly args: Record<string, unknown>;
    }> = [];
    for (const log of withheldTimeoutReceipt.logs) {
      if (log.address.toLowerCase() !== registryAddress.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({
          abi: bisectDisputeRegistryV1Abi,
          topics: log.topics,
          data: log.data,
          strict: false,
        });
        if (isRecord(decoded.args))
          timeoutEvents.push({ name: decoded.eventName, args: decoded.args });
      } catch {
        // Ignore unrelated registry logs while locating the timeout and resolution records.
      }
    }
    const timeoutEvent = timeoutEvents.find((event) => event.name === "GameTimedOut");
    const timeoutResolution = timeoutEvents.find((event) => event.name === "GameResolved");
    const missedResponder = timeoutEvent?.args["missedResponder"];
    const timeoutWinner = timeoutResolution?.args["winner"];
    if (
      unavailableGame.outcome !== 4 ||
      !unavailableGame.settled ||
      unavailableClaim.status !== 4 ||
      unavailableCredit !== 2n * bond ||
      timeoutLocked !== 0n ||
      timeoutCredits !== 2n * bond ||
      timeoutLiabilities !== 2n * bond ||
      timeoutContractBalance !== 2n * bond ||
      !timeoutSolvency ||
      typeof missedResponder !== "string" ||
      missedResponder.toLowerCase() !== prover.toLowerCase() ||
      timeoutWinner !== challenger
    ) {
      throw new Error("Withheld trace data did not produce the expected solvent prover timeout.");
    }

    const gasUsed = receipts.reduce((sum, receipt) => sum + receipt.gasUsed, 0n);
    const executionFees = receipts.reduce(
      (sum, receipt) => sum + receipt.gasUsed * receipt.effectiveGasPrice,
      0n,
    );
    const proposerFees = receipts.reduce(
      (sum, receipt) =>
        sum +
        (receipt.from.toLowerCase() === prover.toLowerCase()
          ? receipt.gasUsed * receipt.effectiveGasPrice
          : 0n),
      0n,
    );
    const challengerFees = receipts.reduce(
      (sum, receipt) =>
        sum +
        (receipt.from.toLowerCase() === challenger.toLowerCase()
          ? receipt.gasUsed * receipt.effectiveGasPrice
          : 0n),
      0n,
    );
    const finalProverBalance = await publicClient.getBalance({ address: prover });
    const finalChallengerBalance = await publicClient.getBalance({ address: challenger });
    const solvency = await publicClient.readContract({
      address: registryAddress,
      abi: bisectDisputeRegistryV1Abi,
      functionName: "accountingInvariantHolds",
    });
    if (!solvency) throw new Error("Registry accounting invariant is false after withdrawal.");

    console.log(
      JSON.stringify(
        {
          network: "isolated Anvil",
          chainId: await publicClient.getChainId(),
          contractAddress: registryAddress,
          outcome: "PROVER_TRANSITION_INVALID",
          differingStateIndex: 1,
          rounds,
          minedTransactionCount: receipts.length,
          expectedTransactionCount: 21,
          terminalResolutionGas: terminalReceipt.gasUsed.toString(),
          withdrawalGas: withdrawalReceipt.gasUsed.toString(),
          totalGasUsed: gasUsed.toString(),
          totalExecutionFeesWei: executionFees.toString(),
          proverExecutionFeesWei: proposerFees.toString(),
          challengerExecutionFeesWei: challengerFees.toString(),
          challengerCreditBeforeWithdrawalWei: creditBeforeWithdrawal.toString(),
          proverCreditBeforeWithdrawalWei: creditProver.toString(),
          challengerWithdrawalNetBalanceDeltaWei: (
            afterWithdrawalBalance - beforeWithdrawalBalance
          ).toString(),
          challengerInitialBalanceWei: initialChallengerBalance.toString(),
          challengerFinalBalanceWei: finalChallengerBalance.toString(),
          proverInitialBalanceWei: initialProverBalance.toString(),
          proverFinalBalanceWei: finalProverBalance.toString(),
          finalLockedWei: timeoutLocked.toString(),
          finalCreditsWei: timeoutCredits.toString(),
          finalLiabilitiesWei: timeoutLiabilities.toString(),
          finalContractBalanceWei: timeoutContractBalance.toString(),
          accountingInvariantHolds: timeoutSolvency,
          reconstructedEvents: {
            bisectionRounds: bisectionEvents.length,
            childReveals: childRevealCount,
            terminalReveals: terminalEvents.length,
            gameResolved: resolved !== undefined,
            bondCredit: credited !== undefined,
            withdrawal: withdrawn !== undefined,
          },
          withheldTraceScenario: {
            claimId: unavailableClaimId.toString(),
            outcome: "PROVER_TIMEOUT",
            timedOutResponder: prover,
            timeoutGas: withheldTimeoutReceipt.gasUsed.toString(),
            challengerCreditWei: unavailableCredit.toString(),
            registryBalanceWei: timeoutContractBalance.toString(),
            accountingInvariantHolds: timeoutSolvency,
          },
          deploymentTransaction: deploymentReceipt.transactionHash,
        },
        null,
        2,
      ),
    );
  } finally {
    anvil.kill();
  }
}

await main();
