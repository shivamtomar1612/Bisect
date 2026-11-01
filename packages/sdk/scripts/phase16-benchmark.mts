import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { delimiter, join, resolve } from "node:path";
import { bisectDisputeRegistryV1Abi, generateTraceCommitment } from "@bisect/sdk";
import {
  computeContextHash,
  computeInputHash,
  computeLeafHash,
  computeNodeHash,
  computeProgramHash,
  computeTraceRoot,
  createMerkleProof,
  createState,
  initialState,
  parseProgram,
  parsePublicInput,
  parseStateJson,
  type State,
  statesEqual,
  step,
} from "@bisect/vm";
import {
  type Abi,
  type Address,
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  type Hex,
  http,
  type TransactionReceipt,
} from "viem";

const root = resolve(import.meta.dirname, "../../..");
const port = 18547;
const rpcUrl = `http://127.0.0.1:${port}`;
const bond = 1_000_000_000_000_000n;
const challengeWindow = 1_000;
const turnWindow = 20;
const budgets = [63, 255, 1023, 4095] as const;
const foundryDir = process.platform === "win32" ? "foundry-v1.8.7" : "foundry-linux-v1.8.7";
const executableSuffixes = process.platform === "win32" ? [".exe", ""] : [""];
const anvilPath = [
  ...executableSuffixes.map((suffix) => join(root, ".tools", foundryDir, `anvil${suffix}`)),
  ...(process.env["PATH"] ?? "")
    .split(delimiter)
    .flatMap((directory) => executableSuffixes.map((suffix) => join(directory, `anvil${suffix}`))),
].find(existsSync);
const directArtifactPath = join(
  root,
  "contracts",
  "out",
  "DirectExecutionBenchmark.sol",
  "DirectExecutionBenchmark.json",
);

type FoundryArtifact = { readonly abi: Abi; readonly bytecode: { readonly object: Hex } };
type RecordValue = Record<string, unknown>;
type TxMeasurement = {
  readonly group: string;
  readonly action: string;
  readonly hash: Hex;
  readonly blockNumber: string;
  readonly gasUsed: string;
  readonly effectiveGasPriceWei: string;
  readonly gasCostWei: string;
  readonly calldataBytes: number;
  readonly valueWei: string;
};
type CaseMetric = {
  readonly gasUsed: string;
  readonly gasCostWei: string;
  readonly transactionCount: number;
  readonly calldataBytes: number;
  readonly transactions: readonly TxMeasurement[];
};
type Prepared = {
  readonly budget: (typeof budgets)[number];
  readonly programHex: Hex;
  readonly input: ReturnType<typeof parsePublicInput>;
  readonly states: readonly State[];
  readonly rootHash: Hex;
  readonly contextHash: Hex;
  readonly output: bigint;
  readonly targetIndex: number;
  readonly timings: {
    readonly vmTransitionsMs: number;
    readonly merkleConstructionMs: number;
    readonly proofGenerationMs: number;
    readonly canonicalSdkReplayMs: number;
    readonly proofSiblingBytes: number;
    readonly proofSiblingCount: number;
  };
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isArtifact(value: unknown): value is FoundryArtifact {
  return (
    isRecord(value) &&
    Array.isArray(value["abi"]) &&
    isRecord(value["bytecode"]) &&
    typeof value["bytecode"]["object"] === "string"
  );
}

function asHex(value: unknown, label: string): Hex {
  assert(typeof value === "string" && /^0x[\da-fA-F]*$/.test(value), `${label} is not hex.`);
  return value as Hex;
}

function toSolidityState(state: State) {
  return { pc: state.pc, halted: state.halted, registers: [...state.registers] } as const;
}

function programFor(budget: number): Hex {
  const iterations = (budget - 3) / 3;
  assert(Number.isInteger(iterations) && iterations <= 0xffff, "Unsupported loop workload.");
  const immediate = iterations.toString(16).padStart(4, "0");
  return `0x0101${immediate}0102000103000002040101020801fffe09000000` as Hex;
}

function makeInput(salt: bigint) {
  return parsePublicInput([0n, 0n, 0n, 0n, 0n, 0n, 0n, salt]);
}

function makePrepared(budget: (typeof budgets)[number], salt: bigint): Prepared {
  const programHex = programFor(budget);
  const program = parseProgram(programHex);
  const input = makeInput(salt);
  const canonicalStart = performance.now();
  const sdkArtifact = generateTraceCommitment({
    program: programHex,
    publicInput: input,
    transitionCount: budget,
  });
  const canonicalSdkReplayMs = performance.now() - canonicalStart;
  const canonicalStates = sdkArtifact.states.map(parseStateJson);

  const vmStart = performance.now();
  const vmStates: State[] = [initialState(input)];
  for (let index = 0; index < budget; index += 1) {
    const previous = vmStates[index];
    assert(previous !== undefined, "VM benchmark state is missing.");
    vmStates.push(step(program, previous));
  }
  const vmTransitionsMs = performance.now() - vmStart;
  assert(vmStates.length === budget + 1, "VM benchmark produced an incorrect trace length.");
  assert(
    vmStates.every((state, index) => {
      const canonical = canonicalStates[index];
      return canonical !== undefined && statesEqual(state, canonical);
    }),
    "Direct v1 transition loop disagrees with the SDK trace.",
  );

  const contextHash = computeContextHash(
    computeProgramHash(program),
    computeInputHash(input),
    budget,
  );
  const merkleStart = performance.now();
  const rootHash = computeTraceRoot(contextHash, vmStates);
  const merkleConstructionMs = performance.now() - merkleStart;
  assert(rootHash === sdkArtifact.traceRoot, "Independent Merkle root differs from SDK root.");

  const targetIndex = Math.floor(budget / 2);
  const proofStart = performance.now();
  const proof = createMerkleProof(contextHash, vmStates, targetIndex);
  const proofGenerationMs = performance.now() - proofStart;
  const finalState = vmStates.at(-1);
  assert(finalState?.halted, "Benchmark workload did not halt within its trace budget.");

  return {
    budget,
    programHex,
    input,
    states: vmStates,
    rootHash,
    contextHash,
    output: finalState.registers[0],
    targetIndex,
    timings: {
      vmTransitionsMs,
      merkleConstructionMs,
      proofGenerationMs,
      canonicalSdkReplayMs,
      proofSiblingBytes: proof.length * 32,
      proofSiblingCount: proof.length,
    },
  };
}

function treeLevels(contextHash: Hex, states: readonly State[]): Hex[][] {
  let level = states.map((state, index) =>
    // computeTraceRoot uses the same domain-separated, index-bound leaf definition.
    computeLeaf(contextHash, index, state),
  );
  const levels = [level];
  while (level.length > 1) {
    const next: Hex[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index];
      const right = level[index + 1];
      assert(left !== undefined && right !== undefined, "Incomplete ordered trace tree.");
      next.push(computeNode(left, right));
    }
    levels.push(next);
    level = next;
  }
  return levels;
}

function terminalProof(
  prepared: Prepared,
  states: readonly State[],
  traceRoot: Hex,
  stateIndex: number,
) {
  const predecessor = states[stateIndex];
  const successor = states[stateIndex + 1];
  assert(predecessor !== undefined && successor !== undefined, "Terminal states are unavailable.");
  return {
    program: prepared.programHex,
    publicInput: prepared.input,
    transitionCount: prepared.budget,
    traceRoot,
    stateIndex,
    predecessor: toSolidityState(predecessor),
    predecessorSiblings: createMerkleProof(prepared.contextHash, states, stateIndex),
    claimedSuccessor: toSolidityState(successor),
    successorSiblings: createMerkleProof(prepared.contextHash, states, stateIndex + 1),
  } as const;
}

function siblingAt(levels: readonly (readonly Hex[])[], baseIndex: number, childHeight: number) {
  const level = levels[childHeight];
  const position = baseIndex >> childHeight;
  const left = level?.[position];
  const right = level?.[position + 1];
  assert(left !== undefined && right !== undefined, "A bisection child is missing.");
  return { left, right };
}

function ms(value: number): string {
  return value.toFixed(3);
}

function minimumBigInt(left: bigint, right: bigint): bigint {
  if (left < right) return left;
  return right;
}

function maximumBigInt(left: bigint, right: bigint): bigint {
  if (left > right) return left;
  return right;
}

async function waitForNode(
  child: ReturnType<typeof spawn>,
  client: ReturnType<typeof createPublicClient>,
) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Anvil exited with code ${child.exitCode}.`);
    try {
      if ((await client.getChainId()) === 31337) return;
    } catch {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    }
  }
  throw new Error("The isolated Anvil JSON-RPC endpoint did not become ready.");
}

async function mineBlocks(count: bigint): Promise<void> {
  if (count <= 0n) return;
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
  assert(response.ok && isRecord(body) && body["error"] === undefined, "Anvil mining failed.");
}

async function minePastBlock(
  publicClient: ReturnType<typeof createPublicClient>,
  deadline: bigint,
): Promise<void> {
  const current = await publicClient.getBlockNumber();
  if (current <= deadline) await mineBlocks(deadline - current + 1n);
}

function measure(
  group: string,
  action: string,
  receipt: TransactionReceipt,
  txInput: Hex,
  txValue: bigint,
): TxMeasurement {
  const price = receipt.effectiveGasPrice;
  assert(price > 0n, "Receipt did not contain a nonzero effective gas price.");
  return {
    group,
    action,
    hash: receipt.transactionHash,
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPriceWei: price.toString(),
    gasCostWei: (receipt.gasUsed * price).toString(),
    calldataBytes: (txInput.length - 2) / 2,
    valueWei: txValue.toString(),
  };
}

function summarize(transactions: readonly TxMeasurement[]): CaseMetric {
  return {
    gasUsed: transactions.reduce((sum, item) => sum + BigInt(item.gasUsed), 0n).toString(),
    gasCostWei: transactions.reduce((sum, item) => sum + BigInt(item.gasCostWei), 0n).toString(),
    transactionCount: transactions.length,
    calldataBytes: transactions.reduce((sum, item) => sum + item.calldataBytes, 0),
    transactions,
  };
}

function eventArgs(receipt: TransactionReceipt, eventName: string): RecordValue | null {
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: bisectDisputeRegistryV1Abi,
        topics: log.topics,
        data: log.data,
        strict: false,
      });
      if (decoded.eventName === eventName && isRecord(decoded.args)) return decoded.args;
    } catch {
      // The benchmark registry emits inherited and dispute events from one ABI.
    }
  }
  return null;
}

function eventArgsAny(
  receipt: TransactionReceipt,
  abi: Abi,
  eventName: string,
): RecordValue | null {
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi, topics: log.topics, data: log.data, strict: false });
      if (decoded.eventName === eventName && isRecord(decoded.args)) return decoded.args;
    } catch {
      // Skip logs that belong to a different event signature.
    }
  }
  return null;
}

async function main(): Promise<void> {
  assert(anvilPath !== undefined, "Pinned Anvil executable is not installed or not on PATH.");
  const artifactValue: unknown = JSON.parse(await readFile(directArtifactPath, "utf8")) as unknown;
  assert(isArtifact(artifactValue), "Direct execution benchmark artifact is invalid.");
  const anvilVersion = spawnSync(anvilPath, ["--version"], { encoding: "utf8" }).stdout.trim();
  const tmpChild = spawn(
    anvilPath,
    ["--host", "127.0.0.1", "--port", `${port}`, "--chain-id", "31337", "--silent"],
    {
      cwd: root,
      stdio: "ignore",
      windowsHide: true,
    },
  );
  const chain = defineChain({
    id: 31337,
    name: "BISECT Phase 16 Anvil",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const unlockedWallet = createWalletClient({ chain, transport: http(rpcUrl) });
  const transactions: TxMeasurement[] = [];
  let totalBondDepositsWei = 0n;
  let totalWithdrawalsWei = 0n;
  let peakLockedExposureWei = 0n;

  try {
    await waitForNode(tmpChild, publicClient);
    const [prover, challenger, keeper] = await unlockedWallet.getAddresses();
    assert(
      prover !== undefined && challenger !== undefined && keeper !== undefined,
      "Anvil test accounts are missing.",
    );
    const proverWallet = createWalletClient({ account: prover, chain, transport: http(rpcUrl) });
    const challengerWallet = createWalletClient({
      account: challenger,
      chain,
      transport: http(rpcUrl),
    });
    const keeperWallet = createWalletClient({ account: keeper, chain, transport: http(rpcUrl) });

    const directDeployHash = await proverWallet.deployContract({
      abi: artifactValue.abi,
      bytecode: artifactValue.bytecode.object,
    });
    const directDeployReceipt = await publicClient.waitForTransactionReceipt({
      hash: directDeployHash,
    });
    assert(
      directDeployReceipt.status === "success" && directDeployReceipt.contractAddress,
      "Direct harness deployment failed.",
    );
    receiptCache.set(directDeployHash, directDeployReceipt);
    const directAddress = directDeployReceipt.contractAddress;

    const registryAbi = bisectDisputeRegistryV1Abi;
    const registryDeployHash = await proverWallet.deployContract({
      abi: registryAbi,
      bytecode: await readRegistryBytecode(),
      args: [bond, challengeWindow, turnWindow],
    });
    const registryDeployReceipt = await publicClient.waitForTransactionReceipt({
      hash: registryDeployHash,
    });
    assert(
      registryDeployReceipt.status === "success" && registryDeployReceipt.contractAddress,
      "Registry deployment failed.",
    );
    receiptCache.set(registryDeployHash, registryDeployReceipt);
    const registry = registryDeployReceipt.contractAddress;

    const directDeploymentTx = await publicClient.getTransaction({ hash: directDeployHash });
    transactions.push(
      measure(
        "setup",
        "deploy-direct-benchmark",
        directDeployReceipt,
        directDeploymentTx.input,
        0n,
      ),
    );
    const registryDeploymentTx = await publicClient.getTransaction({ hash: registryDeployHash });
    transactions.push(
      measure(
        "setup",
        "deploy-dispute-registry",
        registryDeployReceipt,
        registryDeploymentTx.input,
        0n,
      ),
    );

    async function record(
      group: string,
      action: string,
      hash: Hex,
      expectedValue = 0n,
      registryBalance = true,
    ): Promise<TransactionReceipt> {
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      assert(receipt.status === "success", `${group}/${action} reverted: ${hash}`);
      receiptCache.set(hash, receipt);
      const transaction = await publicClient.getTransaction({ hash });
      assert(
        transaction.value === expectedValue,
        `${group}/${action} used an unexpected ETH value.`,
      );
      const row = measure(group, action, receipt, transaction.input, transaction.value);
      transactions.push(row);
      totalBondDepositsWei += transaction.value;
      if (registryBalance) await assertSolvency();
      return receipt;
    }

    async function assertSolvency(): Promise<void> {
      const [locked, credits, liabilities, balance] = await Promise.all([
        publicClient.readContract({
          address: registry,
          abi: registryAbi,
          functionName: "totalLockedBonds",
        }),
        publicClient.readContract({
          address: registry,
          abi: registryAbi,
          functionName: "totalCredits",
        }),
        publicClient.readContract({
          address: registry,
          abi: registryAbi,
          functionName: "totalLiabilities",
        }),
        publicClient.getBalance({ address: registry }),
      ]);
      assert(liabilities === locked + credits, "Contract total liabilities do not reconcile.");
      assert(balance >= liabilities, "Contract balance is below recognized liabilities.");
      if (locked > peakLockedExposureWei) peakLockedExposureWei = locked;
    }

    async function withdraw(
      group: string,
      wallet: typeof proverWallet,
      account: Address,
      expectedCredit: bigint,
    ) {
      const credit = await publicClient.readContract({
        address: registry,
        abi: registryAbi,
        functionName: "withdrawableCredit",
        args: [account],
      });
      assert(credit > 0n, `${group} has no withdrawable contract credit.`);
      assert(
        credit === expectedCredit,
        `${group} credit does not match the expected contract settlement.`,
      );
      const walletBalanceBefore = await publicClient.getBalance({ address: account });
      const hash = await wallet.writeContract({
        address: registry,
        abi: registryAbi,
        functionName: "withdraw",
        gas: 200_000n,
      });
      const receipt = await record(group, "withdraw", hash);
      const remaining = await publicClient.readContract({
        address: registry,
        abi: registryAbi,
        functionName: "withdrawableCredit",
        args: [account],
      });
      assert(remaining === 0n, `${group} withdrawal did not clear the caller's credit.`);
      totalWithdrawalsWei += credit;
      const event = eventArgs(receipt, "Withdrawal");
      assert(
        event?.["amountWei"] === credit,
        `${group} withdrawal event differs from the credited amount.`,
      );
      const walletBalanceAfter = await publicClient.getBalance({ address: account });
      const withdrawalFee = receipt.gasUsed * (receipt.effectiveGasPrice ?? 0n);
      assert(
        walletBalanceAfter + withdrawalFee === walletBalanceBefore + credit,
        `${group} wallet balance delta does not equal the actual ETH credit less receipt gas.`,
      );
      return receipt;
    }

    async function submit(
      group: string,
      prepared: Prepared,
      states: readonly State[],
      traceRoot: Hex,
    ): Promise<{
      readonly claimId: bigint;
      readonly deadline: bigint;
      readonly receipt: TransactionReceipt;
    }> {
      const initial = states[0];
      const final = states.at(-1);
      assert(initial !== undefined && final !== undefined, "Claim endpoints are missing.");
      const claimId = await publicClient.readContract({
        address: registry,
        abi: registryAbi,
        functionName: "nextClaimId",
      });
      const hash = await proverWallet.writeContract({
        address: registry,
        abi: registryAbi,
        functionName: "submitClaim",
        args: [
          {
            program: prepared.programHex,
            publicInput: prepared.input,
            transitionCount: prepared.budget,
            traceRoot,
            claimedOutput: prepared.output,
            initialProof: {
              state: toSolidityState(initial),
              siblings: createMerkleProof(prepared.contextHash, states, 0),
            },
            finalProof: {
              state: toSolidityState(final),
              siblings: createMerkleProof(prepared.contextHash, states, prepared.budget),
            },
          },
        ],
        value: bond,
        gas: 1_500_000n,
      });
      const receipt = await record(group, "claim-submit-and-prover-bond", hash, bond);
      const deadline = receipt.blockNumber + BigInt(challengeWindow);
      return { claimId, deadline, receipt };
    }

    async function challenge(
      group: string,
      prepared: Prepared,
      claimId: bigint,
      challengerStates: readonly State[],
      challengerRoot: Hex,
    ): Promise<TransactionReceipt> {
      const initial = challengerStates[0];
      assert(initial !== undefined, "Challenger initial state is missing.");
      const hash = await challengerWallet.writeContract({
        address: registry,
        abi: registryAbi,
        functionName: "challenge",
        args: [
          claimId,
          challengerRoot,
          {
            state: toSolidityState(initial),
            siblings: createMerkleProof(prepared.contextHash, challengerStates, 0),
          },
        ],
        value: bond,
        gas: 700_000n,
      });
      return record(group, "challenge-open-and-challenger-bond", hash, bond);
    }

    async function playDispute(
      group: string,
      prepared: Prepared,
      claimId: bigint,
      proverStates: readonly State[],
      proverRoot: Hex,
      challengerStates: readonly State[],
      challengerRoot: Hex,
      targetIndex: number,
    ): Promise<{
      readonly rounds: readonly CaseMetric[];
      readonly terminalReceipts: readonly [TransactionReceipt, TransactionReceipt];
    }> {
      const gameNumber = 1n;
      const proverLevels = treeLevels(prepared.contextHash, proverStates);
      const challengerLevels = treeLevels(prepared.contextHash, challengerStates);
      let baseIndex = 0;
      let height = Math.log2(prepared.budget + 1);
      const rounds: CaseMetric[] = [];
      for (let round = 0; height > 0; round += 1, height -= 1) {
        const roundTxStart = transactions.length;
        const childHeight = height - 1;
        const proverChildren = siblingAt(proverLevels, baseIndex, childHeight);
        const challengerChildren = siblingAt(challengerLevels, baseIndex, childHeight);
        const proverHash = await proverWallet.writeContract({
          address: registry,
          abi: registryAbi,
          functionName: "revealChildren",
          args: [claimId, gameNumber, proverChildren.left, proverChildren.right],
          gas: 350_000n,
        });
        await record(group, `round-${round + 1}-prover-move`, proverHash);
        const challengerHash = await challengerWallet.writeContract({
          address: registry,
          abi: registryAbi,
          functionName: "revealChildren",
          args: [claimId, gameNumber, challengerChildren.left, challengerChildren.right],
          gas: 350_000n,
        });
        await record(group, `round-${round + 1}-challenger-move`, challengerHash);
        rounds.push(summarize(transactions.slice(roundTxStart)));
        if (proverChildren.left === challengerChildren.left) baseIndex += 2 ** childHeight;
      }
      assert(
        baseIndex === targetIndex,
        `Bisection selected ${baseIndex}, expected ${targetIndex}.`,
      );
      const active = await publicClient.readContract({
        address: registry,
        abi: registryAbi,
        functionName: "getGame",
        args: [claimId, gameNumber],
      });
      assert(
        active.differentIndex === targetIndex,
        "On-chain game selected the wrong differing state.",
      );

      const challengerTerminal = await challengerWallet.writeContract({
        address: registry,
        abi: registryAbi,
        functionName: "revealTerminal",
        args: [
          claimId,
          gameNumber,
          terminalProof(prepared, challengerStates, challengerRoot, targetIndex - 1),
        ],
        gas: 2_000_000n,
      });
      const challengerTerminalReceipt = await record(
        group,
        "terminal-challenger-evidence",
        challengerTerminal,
      );
      const proverTerminal = await proverWallet.writeContract({
        address: registry,
        abi: registryAbi,
        functionName: "revealTerminal",
        args: [
          claimId,
          gameNumber,
          terminalProof(prepared, proverStates, proverRoot, targetIndex - 1),
        ],
        gas: 2_000_000n,
      });
      const proverTerminalReceipt = await record(
        group,
        "terminal-prover-one-step-adjudication-and-settlement",
        proverTerminal,
      );
      return { rounds, terminalReceipts: [challengerTerminalReceipt, proverTerminalReceipt] };
    }

    const preparedByBudget = new Map<number, Prepared>();
    const honestClaims: Array<{
      readonly prepared: Prepared;
      readonly claimId: bigint;
      readonly deadline: bigint;
      readonly group: string;
    }> = [];
    const benchmarkBudgets: RecordValue[] = [];
    for (const [ordinal, budgetValue] of budgets.entries()) {
      const budget = budgetValue;
      const prepared = makePrepared(budget, BigInt(ordinal + 1));
      preparedByBudget.set(budget, prepared);

      const directHash = await proverWallet.writeContract({
        address: directAddress,
        abi: artifactValue.abi,
        functionName: "execute",
        args: [prepared.programHex, prepared.input, prepared.budget],
        gas: 29_000_000n,
      });
      const directReceipt = await publicClient.waitForTransactionReceipt({ hash: directHash });
      assert(directReceipt.status === "success", `Direct ${budget}-transition execution failed.`);
      receiptCache.set(directHash, directReceipt);
      const directTx = await publicClient.getTransaction({ hash: directHash });
      const directRow = measure(
        `budget-${budget}-direct`,
        "direct-full-execution",
        directReceipt,
        directTx.input,
        0n,
      );
      transactions.push(directRow);
      const directEvent = eventArgsAny(directReceipt, artifactValue.abi, "ExecutionCompleted");
      assert(
        directEvent?.["output"] === prepared.output,
        "Direct EVM output differs from the TypeScript VM.",
      );
      assert(directEvent?.["halted"] === true, "Direct EVM workload did not halt.");

      const honestGroup = `budget-${budget}-honest`;
      const honestClaim = await submit(honestGroup, prepared, prepared.states, prepared.rootHash);
      honestClaims.push({
        prepared,
        claimId: honestClaim.claimId,
        deadline: honestClaim.deadline,
        group: honestGroup,
      });
      benchmarkBudgets.push({
        budget,
        expectedRounds: Math.log2(budget + 1),
        measuredRounds: null,
        directExecution: summarize([directRow]),
        honestClaimLifecycle: null,
        successfulDisputeLifecycle: null,
        isolatedOneStepVerifier: null,
        offchain: {
          vmTransitionsMs: ms(prepared.timings.vmTransitionsMs),
          merkleConstructionMs: ms(prepared.timings.merkleConstructionMs),
          proofGenerationMs: ms(prepared.timings.proofGenerationMs),
          canonicalSdkReplayMs: ms(prepared.timings.canonicalSdkReplayMs),
          proofSiblingCount: prepared.timings.proofSiblingCount,
          proofSiblingBytes: prepared.timings.proofSiblingBytes,
        },
      });
    }

    const fraudSummaries = new Map<number, RecordValue>();
    for (const budget of budgets) {
      const prepared = preparedByBudget.get(budget);
      assert(prepared !== undefined, "Prepared workload is missing.");
      const dishonestStates = [...prepared.states];
      const honestAtMismatch = dishonestStates[prepared.targetIndex];
      assert(honestAtMismatch !== undefined, "Selected fraud state is missing.");
      const changedRegisters = [...honestAtMismatch.registers];
      const changedRegister7 = changedRegisters[7];
      assert(changedRegister7 !== undefined, "Selected state is missing register seven.");
      changedRegisters[7] = (changedRegister7 + 1n) % (1n << 64n);
      dishonestStates[prepared.targetIndex] = createState(
        honestAtMismatch.pc,
        honestAtMismatch.halted,
        changedRegisters,
      );
      const dishonestRoot = computeTraceRoot(prepared.contextHash, dishonestStates);
      assert(
        dishonestRoot !== prepared.rootHash,
        "Dishonest intermediate trace did not change its root.",
      );
      const group = `budget-${budget}-successful-dispute`;
      const before = transactions.length;
      const claim = await submit(group, prepared, dishonestStates, dishonestRoot);

      const dishonestTerminal = terminalProof(
        prepared,
        dishonestStates,
        dishonestRoot,
        prepared.targetIndex - 1,
      );
      const isolatedCheckHash = await proverWallet.writeContract({
        address: directAddress,
        abi: artifactValue.abi,
        functionName: "verifyOneStep",
        args: [dishonestTerminal],
        gas: 2_000_000n,
      });
      const isolatedCheckReceipt = await publicClient.waitForTransactionReceipt({
        hash: isolatedCheckHash,
      });
      assert(
        isolatedCheckReceipt.status === "success",
        "Standalone one-step verification transaction reverted.",
      );
      receiptCache.set(isolatedCheckHash, isolatedCheckReceipt);
      const isolatedTx = await publicClient.getTransaction({ hash: isolatedCheckHash });
      const isolatedRow = measure(
        group,
        "isolated-one-step-verifier",
        isolatedCheckReceipt,
        isolatedTx.input,
        0n,
      );
      transactions.push(isolatedRow);
      const checkEvent = eventArgsAny(
        isolatedCheckReceipt,
        artifactValue.abi,
        "OneStepCheckCompleted",
      );
      assert(
        checkEvent?.["valid"] === false,
        "One-step verifier accepted the dishonest transition.",
      );

      await challenge(group, prepared, claim.claimId, prepared.states, prepared.rootHash);
      const dispute = await playDispute(
        group,
        prepared,
        claim.claimId,
        dishonestStates,
        dishonestRoot,
        prepared.states,
        prepared.rootHash,
        prepared.targetIndex,
      );
      const game = await publicClient.readContract({
        address: registry,
        abi: registryAbi,
        functionName: "getGame",
        args: [claim.claimId, 1n],
      });
      const claimState = await publicClient.readContract({
        address: registry,
        abi: registryAbi,
        functionName: "getClaim",
        args: [claim.claimId],
      });
      assert(
        game.outcome === 3 && game.settled && claimState.status === 4,
        "Invalid trace was not settled for the challenger.",
      );
      const credited = await publicClient.readContract({
        address: registry,
        abi: registryAbi,
        functionName: "withdrawableCredit",
        args: [challenger],
      });
      assert(credited === 2n * bond, "Successful challenger did not receive exactly both bonds.");
      await withdraw(group, challengerWallet, challenger, 2n * bond);

      const scenarioTx = transactions.slice(before);
      const lifecycleTx = scenarioTx.filter((tx) => tx.action !== "isolated-one-step-verifier");
      const roundMetrics = dispute.rounds;
      const terminalProver = scenarioTx.find(
        (tx) => tx.action === "terminal-prover-one-step-adjudication-and-settlement",
      );
      assert(terminalProver !== undefined, "Prover terminal receipt is missing.");
      const submitRow = scenarioTx.find((tx) => tx.action === "claim-submit-and-prover-bond");
      const challengeRow = scenarioTx.find(
        (tx) => tx.action === "challenge-open-and-challenger-bond",
      );
      const terminals = scenarioTx.filter((tx) => tx.action.startsWith("terminal-"));
      const midpointMoves = scenarioTx.filter((tx) => tx.action.includes("-move"));
      assert(
        submitRow !== undefined && challengeRow !== undefined,
        "Dispute entry receipts are missing.",
      );
      fraudSummaries.set(budget, {
        lifecycle: summarize(lifecycleTx),
        rounds: roundMetrics,
        actualRoundCount: roundMetrics.length,
        claimSubmissionGas: submitRow.gasUsed,
        proverBondDepositGasSameTransaction: submitRow.gasUsed,
        challengeBondDepositGasSameTransaction: challengeRow.gasUsed,
        gasPerRound: roundMetrics.map((round) => ({
          gasUsedBothMoves: round.gasUsed,
          gasCostWeiBothMoves: round.gasCostWei,
          transactions: round.transactionCount,
          calldataBytes: round.calldataBytes,
        })),
        midpointMoveTransactions: midpointMoves.length,
        finalOneStepAdjudicationGasInclusiveOfProofAndSettlement: terminalProver.gasUsed,
        isolatedOneStepVerifier: summarize([isolatedRow]),
        terminalProofCalldataBytes: terminals.map((tx) => tx.calldataBytes),
        authenticatedState: prepared.targetIndex,
        outcome: "PROVER_TRANSITION_INVALID",
        challengerCreditWei: (2n * bond).toString(),
      });
      const outputRow = benchmarkBudgets.find((row) => row["budget"] === budget);
      assert(outputRow !== undefined, "Budget report row is missing.");
      outputRow["measuredRounds"] = roundMetrics.length;
      outputRow["successfulDisputeLifecycle"] = fraudSummaries.get(budget)?.["lifecycle"];
      outputRow["fraudDetails"] = fraudSummaries.get(budget);
    }

    for (const honest of honestClaims) {
      await minePastBlock(publicClient, honest.deadline);
      const finalizeHash = await keeperWallet.writeContract({
        address: registry,
        abi: registryAbi,
        functionName: "finalize",
        args: [honest.claimId],
        gas: 150_000n,
      });
      await record(honest.group, "claim-finalize-after-challenge-window", finalizeHash);
      await withdraw(honest.group, proverWallet, prover, bond);
    }

    const failedGroup = "failed-challenge-honest-prover";
    const failedPrepared = makePrepared(63, 101n);
    const failedStates = [...failedPrepared.states];
    const failedIndex = Math.floor(63 / 2);
    const failedOriginal = failedStates[failedIndex];
    assert(failedOriginal !== undefined, "Failed-challenge mutation state missing.");
    const failedRegisters = [...failedOriginal.registers];
    const failedRegister7 = failedRegisters[7];
    assert(failedRegister7 !== undefined, "Failed-challenge state is missing register seven.");
    failedRegisters[7] = (failedRegister7 + 3n) % (1n << 64n);
    failedStates[failedIndex] = createState(
      failedOriginal.pc,
      failedOriginal.halted,
      failedRegisters,
    );
    const failedRoot = computeTraceRoot(failedPrepared.contextHash, failedStates);
    const failedStart = transactions.length;
    const failedClaim = await submit(
      failedGroup,
      failedPrepared,
      failedPrepared.states,
      failedPrepared.rootHash,
    );
    await challenge(failedGroup, failedPrepared, failedClaim.claimId, failedStates, failedRoot);
    const failedDispute = await playDispute(
      failedGroup,
      failedPrepared,
      failedClaim.claimId,
      failedPrepared.states,
      failedPrepared.rootHash,
      failedStates,
      failedRoot,
      failedIndex,
    );
    const failedGame = await publicClient.readContract({
      address: registry,
      abi: registryAbi,
      functionName: "getGame",
      args: [failedClaim.claimId, 1n],
    });
    assert(
      failedGame.outcome === 1 && failedGame.settled,
      "Honest proposer did not win the failed challenge.",
    );
    await minePastBlock(publicClient, failedClaim.deadline);
    const failedFinalizeHash = await keeperWallet.writeContract({
      address: registry,
      abi: registryAbi,
      functionName: "finalize",
      args: [failedClaim.claimId],
      gas: 150_000n,
    });
    await record(failedGroup, "finalize-after-failed-challenge", failedFinalizeHash);
    await withdraw(failedGroup, proverWallet, prover, 2n * bond);
    const failedRows = transactions.slice(failedStart);
    const failedSettlements = failedRows.filter(
      (tx) => tx.action.includes("round-") || tx.action.startsWith("terminal-"),
    );
    const failedChallengeCredit = eventArgs(failedDispute.terminalReceipts[1], "GameResolved");
    assert(failedChallengeCredit?.["winner"] === prover, "Failed challenge paid the wrong winner.");

    const timeoutGroup = "prover-timeout-dispute";
    const timeoutPrepared = makePrepared(63, 102n);
    const timeoutMutated = [...timeoutPrepared.states];
    const timeoutState = timeoutMutated[12];
    assert(timeoutState !== undefined, "Timeout witness state missing.");
    const timeoutRegister7 = timeoutState.registers[7];
    timeoutMutated[12] = createState(timeoutState.pc, timeoutState.halted, [
      ...timeoutState.registers.slice(0, 7),
      timeoutRegister7 + 1n,
    ]);
    const timeoutRoot = computeTraceRoot(timeoutPrepared.contextHash, timeoutMutated);
    const timeoutStart = transactions.length;
    const timeoutClaim = await submit(timeoutGroup, timeoutPrepared, timeoutMutated, timeoutRoot);
    const timeoutChallenge = await challenge(
      timeoutGroup,
      timeoutPrepared,
      timeoutClaim.claimId,
      timeoutPrepared.states,
      timeoutPrepared.rootHash,
    );
    const timeoutGame = await publicClient.readContract({
      address: registry,
      abi: registryAbi,
      functionName: "getGame",
      args: [timeoutClaim.claimId, 1n],
    });
    await minePastBlock(publicClient, timeoutGame.deadlineBlock);
    const timeoutHash = await keeperWallet.writeContract({
      address: registry,
      abi: registryAbi,
      functionName: "claimTimeout",
      args: [timeoutClaim.claimId, 1n],
      gas: 250_000n,
    });
    const timeoutReceipt = await record(
      timeoutGroup,
      "timeout-after-prover-missed-move",
      timeoutHash,
    );
    const timeoutResolved = eventArgs(timeoutReceipt, "GameTimedOut");
    assert(
      timeoutResolved?.["outcome"] === 4,
      "Timeout did not apply the specified prover-timeout outcome.",
    );
    await withdraw(timeoutGroup, challengerWallet, challenger, 2n * bond);
    const timeoutRows = transactions.slice(timeoutStart);
    assert(timeoutChallenge.status === "success", "Timeout challenge was not actually confirmed.");

    const multiGroup = "multiple-simultaneous-claims";
    const multiStart = transactions.length;
    const multiClaims = [];
    for (const salt of [201n, 202n]) {
      const prepared = makePrepared(63, salt);
      const claim = await submit(multiGroup, prepared, prepared.states, prepared.rootHash);
      multiClaims.push({ prepared, ...claim });
    }
    const lockedTogether = await publicClient.readContract({
      address: registry,
      abi: registryAbi,
      functionName: "totalLockedBonds",
    });
    assert(
      lockedTogether === 2n * bond,
      "Two simultaneous claims did not lock exactly two prover bonds.",
    );
    for (const claim of multiClaims) await minePastBlock(publicClient, claim.deadline);
    for (const claim of multiClaims) {
      const finalizeHash = await keeperWallet.writeContract({
        address: registry,
        abi: registryAbi,
        functionName: "finalize",
        args: [claim.claimId],
        gas: 150_000n,
      });
      await record(multiGroup, "finalize-independent-claim", finalizeHash);
    }
    await withdraw(multiGroup, proverWallet, prover, 2n * bond);
    const multiRows = transactions.slice(multiStart);

    const endState = await assertFinalAccounting();

    const creditedWei =
      sumEventAmounts(transactions, "ClaimFinalized", "bondWei") +
      sumEventAmounts(transactions, "GameBondCredited", "amountWei");
    const settlementOutcomes = transactions.flatMap((tx) => {
      const receipt = receiptCache.get(tx.hash);
      if (receipt === undefined) return [];
      const args = eventArgs(receipt, "GameResolved");
      const outcome = args?.["outcome"];
      return typeof outcome === "number" ? [outcome] : [];
    });
    assert(
      settlementOutcomes.length === 6,
      "The real dispute receipts did not contain six game settlements.",
    );
    const slashedCollateralWei = settlementOutcomes.reduce((total, outcome) => {
      assert(outcome >= 1 && outcome <= 5, "A game settled with an unknown outcome.");
      return total + bond;
    }, 0n);
    const budgetRows: RecordValue[] = benchmarkBudgets.map((row): RecordValue => {
      const budget = row["budget"] as number;
      const honestGroup = `budget-${budget}-honest`;
      const honestRows = transactions.filter((tx) => tx.group === honestGroup);
      const honestMetric = summarize(honestRows);
      row["honestClaimLifecycle"] = honestMetric;
      const directMetric = row["directExecution"] as CaseMetric;
      const dispute = row["successfulDisputeLifecycle"] as CaseMetric;
      return {
        ...row,
        breakEvenAgainstDirectByGasUnits: BigInt(dispute.gasUsed) <= BigInt(directMetric.gasUsed),
        optimisticNoDisputeSavingsVsDirectGasUnits: (
          BigInt(directMetric.gasUsed) - BigInt(honestMetric.gasUsed)
        ).toString(),
        disputedDeltaVsDirectGasUnits: (
          BigInt(dispute.gasUsed) - BigInt(directMetric.gasUsed)
        ).toString(),
      };
    });
    const allBenchmarkRows = [...budgetRows];
    const setupRows = transactions.filter((tx) => tx.group === "setup");
    const nonSetupRows = transactions.filter((tx) => tx.group !== "setup");
    const feePrices = nonSetupRows.map((tx) => BigInt(tx.effectiveGasPriceWei));
    const transactionBlocks = nonSetupRows.map((tx) => BigInt(tx.blockNumber));
    assert(
      feePrices.length > 0 && transactionBlocks.length > 0,
      "No measured receipts were recorded.",
    );
    const minimumFeePrice = feePrices.reduce(minimumBigInt);
    const maximumFeePrice = feePrices.reduce(maximumBigInt);
    const firstMeasuredBlock = transactionBlocks.reduce(minimumBigInt);
    const lastMeasuredBlock = transactionBlocks.reduce(maximumBigInt);
    const failedMetric = summarize(failedRows);
    const timeoutMetric = summarize(timeoutRows);
    const multiMetric = summarize(multiRows);

    const result = {
      schema: "bisect.phase16.benchmarks.v1",
      sampleDateUtc: new Date().toISOString(),
      environment: {
        chain: "Local Anvil; no public testnet used",
        chainId: await publicClient.getChainId(),
        anvilVersion,
        foundryVersion: foundryVersion(),
        solcVersion: "0.8.30",
        optimizer: true,
        optimizerRuns: 200,
        feeSource: "Per-transaction receipt effectiveGasPrice × gasUsed",
        feeConditions: {
          minimumEffectiveGasPriceWei: minimumFeePrice.toString(),
          maximumEffectiveGasPriceWei: maximumFeePrice.toString(),
          firstMeasuredTransactionBlock: firstMeasuredBlock.toString(),
          lastMeasuredTransactionBlock: lastMeasuredBlock.toString(),
        },
        challengeWindowBlocks: challengeWindow,
        turnWindowBlocks: turnWindow,
        bondWei: bond.toString(),
        deploymentReceipts: summarize(setupRows),
        deploymentIncludedInLifecycleTotals: false,
      },
      comparison: {
        workload:
          "Same loop program bytes, eight public uint64 inputs, output register, and approved transition count for direct and optimistic runs.",
        directBaseline:
          "Benchmark-only non-view contract executes BisectVerifier.validateProgram and the exact BisectVerifier.step implementation for every transition in one transaction.",
        honestOptimistic:
          "Actual submitClaim with exact prover bond, then permissionless finalize and actual pull withdrawal after the challenge window.",
        disputedLifecycle:
          "Actual dishonest same-output trace claim, challenger bond, both authenticated child-hash moves per round, both terminal reveals, one-step adjudication, settlement and actual withdrawal.",
        gasAndCollateral:
          "Gas is measured from receipts. msg.value bonds are tracked as collateral deposits and never added to gas cost.",
        directDoesNotModelProofSettlement:
          "Direct baseline measures computation only and excludes a claim protocol or financial settlement; lifecycle comparisons state this explicitly.",
      },
      budgets: budgetRows,
      additionalScenarios: {
        failedChallengeAgainstHonestProver: {
          metric: failedMetric,
          outcome:
            "PROVER_TRANSITION_VALID; challenger bond credited to prover; claim then finalized",
          settleAndWithdrawalIncludesGas: true,
          gasForBisectionAndTerminal: summarize(failedSettlements),
        },
        proverTimeout: {
          metric: timeoutMetric,
          outcome: "PROVER_TIMEOUT; both bonds credited to challenger after missed move deadline",
        },
        multipleSimultaneousClaims: {
          metric: multiMetric,
          claimCount: 2,
          lockedExposureObservedWei: lockedTogether.toString(),
          independentFinalizations: 2,
        },
      },
      economics: {
        bondIsCollateral: true,
        totalBondDepositsWei: totalBondDepositsWei.toString(),
        peakLockedExposureWei: peakLockedExposureWei.toString(),
        totalSettlementAndFinalizationCreditsWei: creditedWei.toString(),
        confirmedWithdrawalsWei: totalWithdrawalsWei.toString(),
        slashedCollateralWei: slashedCollateralWei.toString(),
        settledGamesByOutcome: {
          proverTransitionValid: settlementOutcomes.filter((outcome) => outcome === 1).length,
          challengerTimeout: settlementOutcomes.filter((outcome) => outcome === 2).length,
          proverTransitionInvalid: settlementOutcomes.filter((outcome) => outcome === 3).length,
          proverTimeout: settlementOutcomes.filter((outcome) => outcome === 4).length,
          terminalCommitmentInconsistency: settlementOutcomes.filter((outcome) => outcome === 5)
            .length,
        },
        slashedCollateralExplanation:
          "Four invalid-prover wins and one prover timeout each redistribute the prover's bond; one failed challenge redistributes the challenger's bond. Bonds remain ETH liabilities until withdrawal.",
        finalLockedWei: endState.locked.toString(),
        finalCreditsWei: endState.credits.toString(),
        finalLiabilitiesWei: endState.liabilities.toString(),
        finalContractBalanceWei: endState.balance.toString(),
        solventAtEveryCheckedOperation: true,
        protocolFeeWei: "0",
        actualBaseSepoliaMeasurements: false,
      },
      transactionCount: nonSetupRows.length,
      totalMeasuredGasUnitsExcludingDeployments: summarize(nonSetupRows).gasUsed,
      totalMeasuredGasCostWeiExcludingDeployments: summarize(nonSetupRows).gasCostWei,
      rawTransactions: transactions,
      notes: [
        "Bond deposits are transaction value and collateral, not gas expense.",
        "The claimant bond and its deposit gas are the same submitClaim receipt; the challenger bond and its deposit gas are the same challenge receipt.",
        "The isolated verifier harness transaction is reported separately and is not included in dispute lifecycle totals.",
        "One-step adjudication receipt gas includes terminal membership verification, transition verification, settlement storage writes and events; the isolated harness receipt separately measures the verifier library call path.",
        "Local Anvil gas prices and block execution do not predict Base Sepolia inclusion fees or congestion.",
      ],
    };

    assert(
      creditedWei === totalBondDepositsWei,
      "Observed finalization/settlement credits do not conserve all bond deposits.",
    );
    assert(
      totalWithdrawalsWei === totalBondDepositsWei,
      "Observed withdrawals do not equal the deposited collateral.",
    );
    await writeOutputs(result, allBenchmarkRows);
    console.log(
      JSON.stringify(
        {
          output: "docs/benchmarks/phase-16-results.json",
          chainId: result.environment.chainId,
          sampleDateUtc: result.sampleDateUtc,
          transactionCount: result.transactionCount,
          totalMeasuredGasUnitsExcludingDeployments:
            result.totalMeasuredGasUnitsExcludingDeployments,
          totalMeasuredGasCostWeiExcludingDeployments:
            result.totalMeasuredGasCostWeiExcludingDeployments,
          totalBondDepositsWei: result.economics.totalBondDepositsWei,
          totalWithdrawalsWei: result.economics.confirmedWithdrawalsWei,
          budgets: budgetRows.map((row) => ({
            budget: row["budget"],
            directGas: (row["directExecution"] as CaseMetric).gasUsed,
            noDisputeGas: (row["honestClaimLifecycle"] as CaseMetric).gasUsed,
            disputedGas: (row["successfulDisputeLifecycle"] as CaseMetric).gasUsed,
            rounds: row["measuredRounds"],
          })),
        },
        null,
        2,
      ),
    );

    async function assertFinalAccounting() {
      await assertSolvency();
      const [locked, credits, liabilities, balance] = await Promise.all([
        publicClient.readContract({
          address: registry,
          abi: registryAbi,
          functionName: "totalLockedBonds",
        }),
        publicClient.readContract({
          address: registry,
          abi: registryAbi,
          functionName: "totalCredits",
        }),
        publicClient.readContract({
          address: registry,
          abi: registryAbi,
          functionName: "totalLiabilities",
        }),
        publicClient.getBalance({ address: registry }),
      ]);
      assert(
        locked === 0n && credits === 0n && liabilities === 0n,
        "Benchmark left an unpaid liability.",
      );
      return { locked, credits, liabilities, balance };
    }

    function sumEventAmounts(rows: readonly TxMeasurement[], name: string, field: string): bigint {
      let total = 0n;
      for (const row of rows) {
        const receipt = receiptCache.get(row.hash);
        if (receipt === undefined) continue;
        const args = eventArgs(receipt, name);
        const amount = args?.[field];
        if (typeof amount === "bigint") total += amount;
      }
      return total;
    }

    async function writeOutputs(output: unknown, _rows: readonly RecordValue[]): Promise<void> {
      const directory = join(root, "docs", "benchmarks");
      const publicDirectory = join(root, "apps", "web", "public", "benchmarks");
      await mkdir(directory, { recursive: true });
      await mkdir(publicDirectory, { recursive: true });
      const serialized = `${JSON.stringify(output, null, 2)}\n`;
      await writeFile(join(directory, "phase-16-results.json"), serialized, "utf8");
      await writeFile(join(publicDirectory, "phase-16-results.json"), serialized, "utf8");
      const budgetsData = _rows.map((row) => ({
        budget: Number(row["budget"]),
        direct: BigInt((row["directExecution"] as CaseMetric).gasUsed),
        honest: BigInt((row["honestClaimLifecycle"] as CaseMetric).gasUsed),
        disputed: BigInt((row["successfulDisputeLifecycle"] as CaseMetric).gasUsed),
        rounds: Number(row["measuredRounds"]),
      }));
      const gasSvg = makeGasSvg(budgetsData);
      const roundsSvg = makeRoundsSvg(budgetsData);
      await writeFile(join(directory, "phase-16-gas.svg"), gasSvg, "utf8");
      await writeFile(join(directory, "phase-16-rounds.svg"), roundsSvg, "utf8");
      await writeFile(join(publicDirectory, "phase-16-gas.svg"), gasSvg, "utf8");
      await writeFile(join(publicDirectory, "phase-16-rounds.svg"), roundsSvg, "utf8");
    }
  } finally {
    tmpChild.kill();
  }

  async function readRegistryBytecode(): Promise<Hex> {
    const artifactPath = join(
      root,
      "contracts",
      "out",
      "BisectDisputeRegistryV1.sol",
      "BisectDisputeRegistryV1.json",
    );
    const parsed: unknown = JSON.parse(await readFile(artifactPath, "utf8")) as unknown;
    assert(
      isRecord(parsed) && isRecord(parsed["bytecode"]),
      "Registry artifact is missing bytecode.",
    );
    return asHex(parsed["bytecode"]["object"], "Registry bytecode");
  }
}

function computeLeaf(contextHash: Hex, index: number, state: State): Hex {
  return computeLeafHash(contextHash, index, state);
}

function computeNode(left: Hex, right: Hex): Hex {
  return computeNodeHash(left, right);
}

function foundryVersion(): string {
  const suffix = process.platform === "win32" ? ".exe" : "";
  const candidates = [
    ...(process.env["PATH"] ?? "")
      .split(delimiter)
      .map((directory) => join(directory, `forge${suffix}`)),
    join(root, ".tools", foundryDir, `forge${suffix}`),
  ];
  const forgePath = candidates.find(existsSync);
  return forgePath === undefined
    ? "unavailable"
    : spawnSync(forgePath, ["--version"], { encoding: "utf8" }).stdout.trim();
}

const receiptCache = new Map<Hex, TransactionReceipt>();

function makeGasSvg(
  rows: readonly { budget: number; direct: bigint; honest: bigint; disputed: bigint }[],
): string {
  const width = 900;
  const height = 420;
  const max = rows.reduce(
    (highest, row) => [row.direct, row.honest, row.disputed].reduce(maximumBigInt, highest),
    1n,
  );
  const y = (value: bigint) => height - 72 - Number((value * 270n) / max);
  const xPositions = rows.map((_, index) => 140 + index * 195);
  const series = [
    { key: "direct" as const, label: "Direct on-chain VM", color: "#6574cd" },
    { key: "honest" as const, label: "Optimistic, no dispute", color: "#11998e" },
    { key: "disputed" as const, label: "Invalid claim, disputed", color: "#d97706" },
  ];
  const bars = rows
    .flatMap((row, index) =>
      series
        .map((item, seriesIndex) => {
          const value = row[item.key];
          const barX = (xPositions[index] ?? 140) + seriesIndex * 34 - 42;
          const barY = y(value);
          const barHeight = height - 72 - barY;
          return `<rect x="${barX}" y="${barY}" width="26" height="${barHeight}" rx="4" fill="${item.color}"/><title>${row.budget} transitions — ${item.label}: ${value.toString()} gas</title>`;
        })
        .join(""),
    )
    .join("");
  const labels = rows
    .map(
      (row, index) =>
        `<text x="${xPositions[index]}" y="${height - 42}" text-anchor="middle">${row.budget.toLocaleString()} transitions</text>`,
    )
    .join("");
  const legend = series
    .map(
      (item, index) =>
        `<rect x="${70 + index * 255}" y="28" width="12" height="12" rx="3" fill="${item.color}"/><text x="${88 + index * 255}" y="39">${item.label}</text>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc"><title id="title">Measured gas by trace budget</title><desc id="desc">Actual local Anvil receipt gas for direct execution, honest no-dispute claims, and successful disputed claims.</desc><rect width="100%" height="100%" fill="#fff"/>${legend}<path d="M70 348H850M70 258H850M70 168H850M70 78H850" stroke="#e5e7eb"/>${bars}${labels}<text x="24" y="216" transform="rotate(-90 24 216)">Gas used</text></svg>`;
}

function makeRoundsSvg(rows: readonly { budget: number; rounds: number }[]): string {
  const width = 900;
  const height = 300;
  const x = (index: number) => 150 + index * 190;
  const y = (rounds: number) => 228 - rounds * 15;
  const points = rows.map((row, index) => `${x(index)},${y(row.rounds)}`).join(" ");
  const circles = rows
    .map(
      (row, index) =>
        `<circle cx="${x(index)}" cy="${y(row.rounds)}" r="6" fill="#6574cd"/><text x="${x(index)}" y="${y(row.rounds) - 14}" text-anchor="middle">${row.rounds} rounds</text><text x="${x(index)}" y="262" text-anchor="middle">${row.budget.toLocaleString()} transitions</text>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc"><title id="title">Measured interactive dispute rounds</title><desc id="desc">Actual on-chain child-hash bisection round counts across all approved trace budgets.</desc><rect width="100%" height="100%" fill="#fff"/><path d="M80 228H840M80 168H840M80 108H840M80 48H840" stroke="#e5e7eb"/><polyline points="${points}" fill="none" stroke="#6574cd" stroke-width="3"/>${circles}</svg>`;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
