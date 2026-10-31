import { spawn, spawnSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { existsSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createTraceCommitment } from "@bisect/merkle";
import { bisectDisputeRegistryV1Abi, createExecutionStateProof } from "@bisect/sdk";
import {
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
  defineChain,
  type Hex,
  http,
  type TransactionReceipt,
} from "viem";
import { createIndexerApi } from "../src/api.js";
import { loadIndexerConfig } from "../src/config.js";
import { prisma } from "../src/database.js";
import { runIndexerOnce } from "../src/indexer.js";
import { reconcileLedger } from "../src/reconciliation.js";

interface Artifact {
  readonly abi: Abi;
  readonly bytecode: { readonly object: Hex };
}

const root = resolve(import.meta.dirname, "../../..");
const port = 18547;
const rpcUrl = `http://127.0.0.1:${port}`;
const chainId = 1_000_000_000 + randomInt(0, 1_000_000_000);
const bondWei = 1_000_000_000_000_000n;
const challengeWindowBlocks = 50;
const turnWindowBlocks = 2;
const program = "0x010000050100002a09000000" as Hex;
const publicInput = [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n] as const;
const anvilDirectory = process.platform === "win32" ? "foundry-v1.8.7" : "foundry-linux-v1.8.7";
const suffixes = process.platform === "win32" ? [".exe", ""] : [""];
const candidates = [
  ...suffixes.map((suffix) => join(root, ".tools", anvilDirectory, `anvil${suffix}`)),
  ...(process.env["PATH"] ?? "")
    .split(delimiter)
    .flatMap((directory) => suffixes.map((suffix) => join(directory, `anvil${suffix}`))),
];
const anvilPath = candidates.find(existsSync);
const artifactPath = join(
  root,
  "contracts",
  "out",
  "BisectDisputeRegistryV1.sol",
  "BisectDisputeRegistryV1.json",
);

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readArtifact(value: unknown): Artifact {
  if (!isRecord(value) || !Array.isArray(value["abi"]) || !isRecord(value["bytecode"])) {
    throw new Error("Foundry registry artifact is malformed.");
  }
  const object = value["bytecode"]["object"];
  if (typeof object !== "string" || !object.startsWith("0x"))
    throw new Error("Registry bytecode is missing.");
  return { abi: value["abi"] as Abi, bytecode: { object: object as Hex } };
}

function toStateTuple(state: State) {
  return { pc: state.pc, halted: state.halted, registers: [...state.registers] } as const;
}

function walletAccount(
  wallet: ReturnType<typeof createWalletClient>,
): NonNullable<ReturnType<typeof createWalletClient>["account"]> {
  if (wallet.account === undefined) throw new Error("Anvil wallet client has no selected account.");
  return wallet.account;
}

function mutateTrace(traceSource: readonly State[], index: number, value: bigint): State[] {
  const trace = [...traceSource];
  const current = trace[index];
  if (current === undefined) throw new Error(`Trace state ${index} is missing.`);
  trace[index] = createState(current.pc, current.halted, [value, ...current.registers.slice(1)]);
  return trace;
}

async function rpc(method: string, params: readonly unknown[] = []): Promise<unknown> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const result: unknown = await response.json();
  if (!response.ok || !isRecord(result) || result["error"] !== undefined) {
    throw new Error(`Anvil RPC method ${method} failed.`);
  }
  return result["result"];
}

async function mine(count: number): Promise<void> {
  if (!Number.isSafeInteger(count) || count < 1 || count > 500)
    throw new Error("Invalid bounded mine count.");
  await rpc("anvil_mine", [`0x${count.toString(16)}`]);
}

async function waitForAnvil(
  client: ReturnType<typeof createPublicClient>,
  processHandle: ReturnType<typeof spawn>,
  expectedChainId: number,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (processHandle.exitCode !== null)
      throw new Error(`Anvil exited with ${processHandle.exitCode}.`);
    try {
      if ((await client.getChainId()) === expectedChainId) return;
    } catch {
      await delay(200);
    }
  }
  throw new Error("Anvil did not start on the isolated Phase 8 test port.");
}

async function mined(
  client: ReturnType<typeof createPublicClient>,
  hash: Hex,
): Promise<TransactionReceipt> {
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`Anvil transaction ${hash} reverted.`);
  return receipt;
}

function claimSubmission(traceRoot: Hex, trace: readonly State[], contextHash: Hex) {
  const initial = trace[0];
  const final = trace[63];
  if (initial === undefined || final === undefined) throw new Error("Trace endpoints are missing.");
  return {
    program,
    publicInput,
    transitionCount: 63,
    traceRoot,
    claimedOutput: 42n,
    initialProof: {
      state: toStateTuple(initial),
      siblings: createMerkleProof(contextHash, trace, 0),
    },
    finalProof: {
      state: toStateTuple(final),
      siblings: createMerkleProof(contextHash, trace, 63),
    },
  } as const;
}

async function submitClaim(
  wallet: ReturnType<typeof createWalletClient>,
  client: ReturnType<typeof createPublicClient>,
  registry: `0x${string}`,
  rootHash: Hex,
  trace: readonly State[],
  contextHash: Hex,
): Promise<TransactionReceipt> {
  const hash = await wallet.writeContract({
    chain: null,
    account: walletAccount(wallet),
    address: registry,
    abi: bisectDisputeRegistryV1Abi,
    functionName: "submitClaim",
    args: [claimSubmission(rootHash, trace, contextHash)],
    value: bondWei,
    gas: 1_500_000n,
  });
  return mined(client, hash);
}

async function openChallenge(
  wallet: ReturnType<typeof createWalletClient>,
  client: ReturnType<typeof createPublicClient>,
  registry: `0x${string}`,
  claimId: bigint,
  rootHash: Hex,
  trace: readonly State[],
  contextHash: Hex,
): Promise<TransactionReceipt> {
  const initial = trace[0];
  if (initial === undefined) throw new Error("Challenge trace is empty.");
  const hash = await wallet.writeContract({
    chain: null,
    account: walletAccount(wallet),
    address: registry,
    abi: bisectDisputeRegistryV1Abi,
    functionName: "challenge",
    args: [
      claimId,
      rootHash,
      { state: toStateTuple(initial), siblings: createMerkleProof(contextHash, trace, 0) },
    ],
    value: bondWei,
    gas: 800_000n,
  });
  return mined(client, hash);
}

async function timedOutChallenge(
  wallet: ReturnType<typeof createWalletClient>,
  client: ReturnType<typeof createPublicClient>,
  registry: `0x${string}`,
  claimId: bigint,
  gameNumber: bigint,
  parentLeft: Hex,
  parentRight: Hex,
  timeoutCaller: ReturnType<typeof createWalletClient>,
): Promise<TransactionReceipt> {
  const revealHash = await wallet.writeContract({
    chain: null,
    account: walletAccount(wallet),
    address: registry,
    abi: bisectDisputeRegistryV1Abi,
    functionName: "revealChildren",
    args: [claimId, gameNumber, parentLeft, parentRight],
    gas: 500_000n,
  });
  await mined(client, revealHash);
  const game = await client.readContract({
    address: registry,
    abi: bisectDisputeRegistryV1Abi,
    functionName: "getGame",
    args: [claimId, gameNumber],
  });
  const current = await client.getBlockNumber();
  const blocksToMine = Number(game.deadlineBlock - current + 1n);
  await mine(blocksToMine);
  const timeoutHash = await timeoutCaller.writeContract({
    chain: null,
    account: walletAccount(timeoutCaller),
    address: registry,
    abi: bisectDisputeRegistryV1Abi,
    functionName: "claimTimeout",
    args: [claimId, gameNumber],
    gas: 600_000n,
  });
  return mined(client, timeoutHash);
}

async function runRestartedIndexer(): Promise<void> {
  const cli = fileURLToPath(import.meta.resolve("tsx/cli"));
  const cwd = resolve(import.meta.dirname, "..");
  const result = spawnSync(process.execPath, [cli, "src/run-once.ts"], {
    cwd,
    env: process.env,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0)
    throw new Error(`Restarted indexer failed: ${result.stderr || result.stdout}`);
}

async function verifyApi(
  config: ReturnType<typeof loadIndexerConfig>,
  address: string,
): Promise<void> {
  const server = createIndexerApi(config);
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  try {
    const addressInfo = server.address();
    if (addressInfo === null || typeof addressInfo === "string")
      throw new Error("API failed to bind an ephemeral port.");
    const baseUrl = `http://127.0.0.1:${addressInfo.port}`;
    const [
      claims,
      overview,
      activity,
      status,
      disputes,
      deposits,
      lockedBonds,
      penalties,
      settlements,
      rewards,
      withdrawals,
      reconciliation,
      invalid,
      invalidAddress,
      invalidCursor,
      invalidStatus,
      post,
    ] = await Promise.all([
      fetch(`${baseUrl}/v1/claims?limit=1`),
      fetch(`${baseUrl}/v1/accounts/${address}/overview`),
      fetch(`${baseUrl}/v1/wallets/${address}/activity?limit=1`),
      fetch(`${baseUrl}/v1/indexer/status`),
      fetch(`${baseUrl}/v1/disputes?limit=1`),
      fetch(`${baseUrl}/v1/deposits?limit=1`),
      fetch(`${baseUrl}/v1/locked-bonds?limit=1`),
      fetch(`${baseUrl}/v1/penalties?limit=1`),
      fetch(`${baseUrl}/v1/settlements?limit=1`),
      fetch(`${baseUrl}/v1/rewards?limit=1`),
      fetch(`${baseUrl}/v1/withdrawals?limit=1`),
      fetch(`${baseUrl}/v1/reconciliation?limit=1`),
      fetch(`${baseUrl}/v1/claims?limit=101`),
      fetch(`${baseUrl}/v1/accounts/not-an-address/overview`),
      fetch(`${baseUrl}/v1/claims?cursor=bad.cursor`),
      fetch(`${baseUrl}/v1/disputes?status=NOT_A_STATUS`),
      fetch(`${baseUrl}/v1/claims`, { method: "POST" }),
    ]);
    if (
      claims.status !== 200 ||
      overview.status !== 200 ||
      activity.status !== 200 ||
      status.status !== 200 ||
      disputes.status !== 200 ||
      deposits.status !== 200 ||
      lockedBonds.status !== 200 ||
      penalties.status !== 200 ||
      settlements.status !== 200 ||
      rewards.status !== 200 ||
      withdrawals.status !== 200 ||
      reconciliation.status !== 200
    ) {
      throw new Error("Read-only indexer API did not return indexed data.");
    }
    const claimPage: unknown = await claims.json();
    if (
      !isRecord(claimPage) ||
      !Array.isArray(claimPage["data"]) ||
      claimPage["data"].length !== 1 ||
      typeof claimPage["nextCursor"] !== "string"
    ) {
      throw new Error("API page did not return the expected bounded cursor result.");
    }
    const next = await fetch(
      `${baseUrl}/v1/claims?limit=1&cursor=${encodeURIComponent(claimPage["nextCursor"])}`,
    );
    const nextJson: unknown = await next.json();
    if (
      next.status !== 200 ||
      !isRecord(nextJson) ||
      !Array.isArray(nextJson["data"]) ||
      nextJson["data"].length !== 1
    ) {
      throw new Error("API cursor did not retrieve the next claim page.");
    }
    const activityPage: unknown = await activity.json();
    if (
      !isRecord(activityPage) ||
      !Array.isArray(activityPage["data"]) ||
      activityPage["data"].length !== 1 ||
      typeof activityPage["nextCursor"] !== "string"
    ) {
      throw new Error("Wallet activity did not return a bounded cursor page.");
    }
    const nextActivity = await fetch(
      `${baseUrl}/v1/wallets/${address}/activity?limit=1&cursor=${encodeURIComponent(activityPage["nextCursor"])}`,
    );
    const nextActivityJson: unknown = await nextActivity.json();
    if (
      nextActivity.status !== 200 ||
      !isRecord(nextActivityJson) ||
      !Array.isArray(nextActivityJson["data"]) ||
      nextActivityJson["data"].length !== 1
    ) {
      throw new Error("Wallet activity cursor did not retrieve the next page.");
    }
    if (
      invalid.status !== 400 ||
      invalidAddress.status !== 400 ||
      invalidCursor.status !== 400 ||
      invalidStatus.status !== 400 ||
      post.status !== 405
    ) {
      throw new Error("API failed to reject invalid query/address or write method.");
    }
  } finally {
    await new Promise<void>((resolveClose, reject) =>
      server.close((error) => (error ? reject(error) : resolveClose())),
    );
  }
}

async function main(): Promise<void> {
  if (anvilPath === undefined) throw new Error("Pinned Anvil binary was not found.");
  const artifact = readArtifact(
    JSON.parse(await (await import("node:fs/promises")).readFile(artifactPath, "utf8")) as unknown,
  );
  const anvil = spawn(
    anvilPath,
    ["--host", "127.0.0.1", "--port", String(port), "--chain-id", String(chainId), "--silent"],
    {
      cwd: root,
      stdio: "ignore",
      windowsHide: true,
    },
  );
  const localChain = defineChain({
    id: chainId,
    name: "Anvil Phase 8",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  const client = createPublicClient({ chain: localChain, transport: http(rpcUrl) });
  const unlocked = createWalletClient({ chain: localChain, transport: http(rpcUrl) });
  try {
    await waitForAnvil(client, anvil, chainId);
    const accounts = await unlocked.getAddresses();
    const prover1 = accounts[0];
    const challenger1 = accounts[1];
    const prover2 = accounts[2];
    const permissionlessCaller = accounts[3];
    if (
      prover1 === undefined ||
      challenger1 === undefined ||
      prover2 === undefined ||
      permissionlessCaller === undefined
    ) {
      throw new Error("Anvil did not expose four funded unlocked accounts.");
    }
    const wallet = (account: `0x${string}`) =>
      createWalletClient({ account, chain: localChain, transport: http(rpcUrl) });
    const proposerWallet = wallet(prover1);
    const challengerWallet = wallet(challenger1);
    const secondProverWallet = wallet(prover2);
    const publicCallerWallet = wallet(permissionlessCaller);

    const deployHash = await proposerWallet.deployContract({
      account: walletAccount(proposerWallet),
      abi: artifact.abi,
      bytecode: artifact.bytecode.object,
      args: [bondWei, challengeWindowBlocks, turnWindowBlocks],
    });
    const deployReceipt = await mined(client, deployHash);
    const deployedRegistry = deployReceipt.contractAddress;
    if (deployedRegistry === null || deployedRegistry === undefined)
      throw new Error("Anvil deployment omitted the registry address.");
    const registry = deployedRegistry;
    const deploymentBlock = deployReceipt.blockNumber;
    const configEnv = {
      ...process.env,
      INDEXER_RPC_URL: rpcUrl,
      INDEXER_CHAIN_ID: String(chainId),
      INDEXER_CONTRACT_ADDRESS: registry,
      INDEXER_DEPLOYMENT_BLOCK: deploymentBlock.toString(),
      INDEXER_CONFIRMATIONS: "2",
      INDEXER_SCAN_RANGE: "100",
      INDEXER_MAX_REORG_DEPTH: "128",
      INDEXER_POLL_INTERVAL_MS: "250",
    };
    for (const [key, value] of Object.entries(configEnv))
      if (value !== undefined) process.env[key] = value;
    const config = loadIndexerConfig();
    await runIndexerOnce(config);
    await mine(2);
    await runIndexerOnce(config);

    const canonicalArtifact = createTraceCommitment(program, publicInput, 63);
    const canonicalTrace = canonicalArtifact.states.map(parseStateJson);
    const dishonestTrace = mutateTrace(canonicalTrace, 1, 9n);
    const dishonestRoot = computeTraceRoot(canonicalArtifact.executionContextHash, dishonestTrace);
    await submitClaim(
      proposerWallet,
      client,
      registry,
      dishonestRoot,
      dishonestTrace,
      canonicalArtifact.executionContextHash,
    );

    const pendingRun = await runIndexerOnce(config);
    const pendingEvent = await prisma.chainEvent.findFirst({
      where: {
        chainId,
        contractAddress: registry.toLowerCase(),
        eventName: "ClaimSubmitted",
        status: "OBSERVED",
      },
    });
    if (
      pendingEvent === null ||
      (await prisma.claim.count({
        where: { chainId, contractAddress: registry.toLowerCase() },
      })) !== 0
    ) {
      throw new Error("Unconfirmed claim was exposed as a confirmed ledger/read-model entry.");
    }
    await mine(2);
    const confirmedRun = await runIndexerOnce(config);
    const firstClaim = await prisma.claim.findUnique({
      where: {
        chainId_contractAddress_claimId: {
          chainId,
          contractAddress: registry.toLowerCase(),
          claimId: "1",
        },
      },
    });
    if (
      firstClaim === null ||
      pendingRun.newlyConfirmedEvents !== 0 ||
      confirmedRun.newlyConfirmedEvents !== 1
    ) {
      throw new Error(
        "Confirmed claim ingestion did not advance exactly after the configured depth.",
      );
    }

    await openChallenge(
      challengerWallet,
      client,
      registry,
      1n,
      canonicalArtifact.traceRoot,
      canonicalTrace,
      canonicalArtifact.executionContextHash,
    );
    const firstGame = await client.readContract({
      address: registry,
      abi: bisectDisputeRegistryV1Abi,
      functionName: "getGame",
      args: [1n, 1n],
    });
    const afterFirstChallenge = await client.getBlockNumber();
    await mine(Number(firstGame.deadlineBlock - afterFirstChallenge + 1n));
    const proverTimeoutHash = await challengerWallet.writeContract({
      chain: null,
      account: walletAccount(challengerWallet),
      address: registry,
      abi: bisectDisputeRegistryV1Abi,
      functionName: "claimTimeout",
      args: [1n, 1n],
      gas: 600_000n,
    });
    await mined(client, proverTimeoutHash);

    const honestReceipt = await submitClaim(
      secondProverWallet,
      client,
      registry,
      canonicalArtifact.traceRoot,
      canonicalTrace,
      canonicalArtifact.executionContextHash,
    );
    if (honestReceipt.status !== "success") throw new Error("Honest claim submission failed.");
    const badTraceOne = mutateTrace(canonicalTrace, 1, 7n);
    const badTraceTwo = mutateTrace(canonicalTrace, 2, 8n);
    const badRootOne = computeTraceRoot(canonicalArtifact.executionContextHash, badTraceOne);
    const badRootTwo = computeTraceRoot(canonicalArtifact.executionContextHash, badTraceTwo);
    const leafValues = canonicalTrace.map(
      (_, index) =>
        createExecutionStateProof({ trace: canonicalArtifact, stateIndex: index }).leafHash,
    );
    let level: Hex[] = leafValues;
    const levels: Hex[][] = [level];
    while (level.length > 1) {
      const next: Hex[] = [];
      for (let i = 0; i < level.length; i += 2) {
        const left = level[i];
        const right = level[i + 1];
        if (left === undefined || right === undefined)
          throw new Error("Incomplete trace tree pair.");
        next.push(computeNodeHash(left, right));
      }
      level = next;
      levels.push(level);
    }
    if (levels.at(-1)?.[0] !== canonicalArtifact.traceRoot)
      throw new Error("Test Merkle levels disagree with the SDK trace root.");
    const rootChildLeft = levels[levels.length - 2]?.[0];
    const rootChildRight = levels[levels.length - 2]?.[1];
    if (rootChildLeft === undefined || rootChildRight === undefined)
      throw new Error("Root children are unavailable.");
    for (const [gameIndex, badTrace] of [
      [1n, badTraceOne],
      [2n, badTraceTwo],
    ] as const) {
      const badRoot = gameIndex === 1n ? badRootOne : badRootTwo;
      await openChallenge(
        challengerWallet,
        client,
        registry,
        2n,
        badRoot,
        badTrace,
        canonicalArtifact.executionContextHash,
      );
      await timedOutChallenge(
        secondProverWallet,
        client,
        registry,
        2n,
        gameIndex,
        rootChildLeft,
        rootChildRight,
        publicCallerWallet,
      );
    }
    const claimTwoOnChain = await client.readContract({
      address: registry,
      abi: bisectDisputeRegistryV1Abi,
      functionName: "getClaim",
      args: [2n],
    });
    const currentBeforeFinalize = await client.getBlockNumber();
    const untilFinalizable = Number(claimTwoOnChain.challengeDeadline - currentBeforeFinalize + 1n);
    if (untilFinalizable > 0) await mine(untilFinalizable);
    const finalizeHash = await publicCallerWallet.writeContract({
      chain: null,
      account: walletAccount(publicCallerWallet),
      address: registry,
      abi: bisectDisputeRegistryV1Abi,
      functionName: "finalize",
      args: [2n],
      gas: 500_000n,
    });
    await mined(client, finalizeHash);
    const withdrawSecondHash = await secondProverWallet.writeContract({
      chain: null,
      account: walletAccount(secondProverWallet),
      address: registry,
      abi: bisectDisputeRegistryV1Abi,
      functionName: "withdraw",
      args: [],
      gas: 300_000n,
    });
    await mined(client, withdrawSecondHash);

    await mine(2);
    const indexResult = await runIndexerOnce(config);
    if (indexResult.newlyConfirmedEvents < 10)
      throw new Error("Expected real claim, game and settlement events were not indexed.");
    const [claims, disputes, deposits, settlements, withdrawals, journals, postings] =
      await Promise.all([
        prisma.claim.count({ where: { chainId, contractAddress: registry.toLowerCase() } }),
        prisma.dispute.count({ where: { chainId, contractAddress: registry.toLowerCase() } }),
        prisma.bondDeposit.count({ where: { chainId, contractAddress: registry.toLowerCase() } }),
        prisma.settlement.count({ where: { chainId, contractAddress: registry.toLowerCase() } }),
        prisma.withdrawal.count({ where: { chainId, contractAddress: registry.toLowerCase() } }),
        prisma.journalTransaction.count({
          where: { chainId, contractAddress: registry.toLowerCase() },
        }),
        prisma.journalPosting.count({
          where: { journal: { chainId, contractAddress: registry.toLowerCase() } },
        }),
      ]);
    if (
      claims !== 2 ||
      disputes !== 3 ||
      deposits !== 5 ||
      settlements !== 4 ||
      withdrawals !== 1 ||
      journals !== 10 ||
      postings !== 21
    ) {
      throw new Error(
        `Unexpected read model/journal counts: claims=${claims}, disputes=${disputes}, deposits=${deposits}, settlements=${settlements}, withdrawals=${withdrawals}, journals=${journals}, postings=${postings}.`,
      );
    }
    const firstProverDeposit = await prisma.bondDeposit.findFirstOrThrow({
      where: {
        chainId,
        contractAddress: registry.toLowerCase(),
        kind: "PROVER",
        claim: { claimId: "1" },
      },
    });
    if (firstProverDeposit.status !== "SLASHED") {
      throw new Error(
        "Dishonest prover bond was not classified as slashed after challenger settlement.",
      );
    }
    const unbalanced = await prisma.$queryRaw<Array<{ id: bigint }>>`
      SELECT journal."id"
      FROM "JournalTransaction" journal
      JOIN "JournalPosting" posting ON posting."journalId" = journal."id"
      WHERE journal."chainId" = ${chainId} AND journal."contractAddress" = ${registry.toLowerCase()}
      GROUP BY journal."id"
      HAVING COUNT(*) < 2 OR
        SUM(CASE WHEN posting."side" = 'DEBIT' THEN posting."amountWei" ELSE 0 END) <>
        SUM(CASE WHEN posting."side" = 'CREDIT' THEN posting."amountWei" ELSE 0 END)
    `;
    if (unbalanced.length !== 0) throw new Error("Database contains an unbalanced journal entry.");
    let rejectedEmptyJournal = false;
    try {
      await prisma.journalTransaction.create({
        data: {
          chainId,
          contractAddress: registry.toLowerCase(),
          transactionHash: "phase8-unbalanced-constraint-probe",
          blockNumber: BigInt(indexResult.confirmedThroughBlock),
          blockHash: deployReceipt.blockHash,
          kind: "BOND_LOCK",
        },
      });
    } catch {
      rejectedEmptyJournal = true;
    }
    const journalCountAfterConstraintProbe = await prisma.journalTransaction.count({
      where: { chainId, contractAddress: registry.toLowerCase() },
    });
    if (!rejectedEmptyJournal || journalCountAfterConstraintProbe !== journals) {
      throw new Error("PostgreSQL did not reject a committed journal without balanced postings.");
    }
    const immutableEntry = await prisma.journalTransaction.findFirstOrThrow({
      where: { chainId, contractAddress: registry.toLowerCase() },
      orderBy: { id: "asc" },
    });
    let rejectedJournalMutation = false;
    try {
      await prisma.journalTransaction.update({
        where: { id: immutableEntry.id },
        data: { transactionHash: "changed" },
      });
    } catch {
      rejectedJournalMutation = true;
    }
    if (!rejectedJournalMutation)
      throw new Error("PostgreSQL allowed mutation of append-only journal history.");
    const firstReconcile = await reconcileLedger(config);
    if (
      firstReconcile.status !== "MATCH" ||
      firstReconcile.indexedLockedWei !== "0" ||
      firstReconcile.indexedCreditsWei !== (2n * bondWei).toString() ||
      firstReconcile.contractBalanceWei !== (2n * bondWei).toString() ||
      firstReconcile.unallocatedSurplusWei !== "0"
    ) {
      throw new Error(
        `Pre-reorg reconciliation did not match the contract: ${JSON.stringify(firstReconcile)}.`,
      );
    }

    const apiChallenger = challenger1;
    await verifyApi(config, prover2);
    const beforeIdempotent = await prisma.journalTransaction.count({
      where: { chainId, contractAddress: registry.toLowerCase() },
    });
    await runIndexerOnce(config);
    await runIndexerOnce(config);
    const afterIdempotent = await prisma.journalTransaction.count({
      where: { chainId, contractAddress: registry.toLowerCase() },
    });
    if (beforeIdempotent !== afterIdempotent)
      throw new Error("Indexer restart/replay created duplicate journal transactions.");
    await runRestartedIndexer();

    const snapshot = await rpc("evm_snapshot");
    if (typeof snapshot !== "string") throw new Error("Anvil snapshot identifier is malformed.");
    const challengerBefore = await client.readContract({
      address: registry,
      abi: bisectDisputeRegistryV1Abi,
      functionName: "withdrawableCredit",
      args: [apiChallenger],
    });
    const challengerWithdrawHash = await challengerWallet.writeContract({
      chain: null,
      account: walletAccount(challengerWallet),
      address: registry,
      abi: bisectDisputeRegistryV1Abi,
      functionName: "withdraw",
      args: [],
      gas: 300_000n,
    });
    const orphanedWithdrawal = await mined(client, challengerWithdrawHash);
    await mine(2);
    await runIndexerOnce(config);
    const reverted = await rpc("evm_revert", [snapshot]);
    if (reverted !== true)
      throw new Error("Anvil refused the controlled withdrawal reorganization.");
    await mine(2);
    await runIndexerOnce(config);
    const orphanRow = await prisma.chainEvent.findFirst({
      where: {
        chainId,
        transactionHash: orphanedWithdrawal.transactionHash,
        eventName: "Withdrawal",
      },
    });
    const reversalCount = await prisma.journalTransaction.count({
      where: { chainId, contractAddress: registry.toLowerCase(), kind: "REORG_REVERSAL" },
    });
    const restoredCredit = await client.readContract({
      address: registry,
      abi: bisectDisputeRegistryV1Abi,
      functionName: "withdrawableCredit",
      args: [apiChallenger],
    });
    if (
      orphanRow?.status !== "ORPHANED" ||
      reversalCount !== 1 ||
      restoredCredit !== challengerBefore
    ) {
      throw new Error(
        "Controlled reorganization did not orphan and reverse the confirmed withdrawal.",
      );
    }
    const afterReorgReconcile = await reconcileLedger(config);
    if (afterReorgReconcile.status !== "MATCH")
      throw new Error("Ledger did not reconcile after reorganization rollback.");

    const rewithdrawHash = await challengerWallet.writeContract({
      chain: null,
      account: walletAccount(challengerWallet),
      address: registry,
      abi: bisectDisputeRegistryV1Abi,
      functionName: "withdraw",
      args: [],
      gas: 300_000n,
    });
    const rewithdrawReceipt = await mined(client, rewithdrawHash);
    await mine(2);
    await runIndexerOnce(config);
    const currentReconcile = await reconcileLedger(config);
    if (
      currentReconcile.status !== "MATCH" ||
      currentReconcile.indexedLockedWei !== "0" ||
      currentReconcile.indexedCreditsWei !== "0" ||
      currentReconcile.contractBalanceWei !== "0" ||
      currentReconcile.unallocatedSurplusWei !== "0"
    ) {
      throw new Error("Replacement withdrawal did not replay cleanly after reorganization.");
    }
    await runRestartedIndexer();
    const finalEventCount = await prisma.chainEvent.count({
      where: { chainId, contractAddress: registry.toLowerCase(), status: "CONFIRMED" },
    });
    const allJournalEntries = await prisma.journalTransaction.count({
      where: { chainId, contractAddress: registry.toLowerCase() },
    });
    const finalPostings = await prisma.journalPosting.count({
      where: { journal: { chainId, contractAddress: registry.toLowerCase() } },
    });
    const finalUnbalanced = await prisma.$queryRaw<Array<{ id: bigint }>>`
      SELECT journal."id"
      FROM "JournalTransaction" journal
      JOIN "JournalPosting" posting ON posting."journalId" = journal."id"
      WHERE journal."chainId" = ${chainId} AND journal."contractAddress" = ${registry.toLowerCase()}
      GROUP BY journal."id"
      HAVING COUNT(*) < 2 OR
        SUM(CASE WHEN posting."side" = 'DEBIT' THEN posting."amountWei" ELSE 0 END) <>
        SUM(CASE WHEN posting."side" = 'CREDIT' THEN posting."amountWei" ELSE 0 END)
    `;
    if (finalUnbalanced.length !== 0)
      throw new Error("Reorganization left an unbalanced journal entry.");
    console.log(
      JSON.stringify(
        {
          status: "PASS",
          network: "isolated Anvil",
          chainId,
          registry,
          deploymentBlock: deploymentBlock.toString(),
          confirmationDepth: 2,
          initialRealEvents: indexResult.newlyConfirmedEvents,
          finalConfirmedEvents: finalEventCount,
          claims,
          disputes,
          deposits,
          settlements,
          withdrawalsAfterReorgReplay: await prisma.withdrawal.count({
            where: { chainId, contractAddress: registry.toLowerCase() },
          }),
          journalTransactionsIncludingReversals: allJournalEntries,
          balancedPostingCountBeforeReorg: postings,
          finalPostingCountIncludingReversals: finalPostings,
          journalEntriesBalancedAfterReorgReplay: finalUnbalanced.length === 0,
          contractAndLedgerReconciliation: currentReconcile.status,
          finalAccountedWei: {
            contractBalance: currentReconcile.contractBalanceWei,
            indexedLocked: currentReconcile.indexedLockedWei,
            indexedWithdrawableCredits: currentReconcile.indexedCreditsWei,
            unallocatedSurplus: currentReconcile.unallocatedSurplusWei,
          },
          reorganization: {
            orphanedWithdrawalTransaction: orphanedWithdrawal.transactionHash,
            replacementWithdrawalTransaction: rewithdrawReceipt.transactionHash,
            appendOnlyReversalEntries: reversalCount,
            restoredCreditAfterRevertWei: restoredCredit.toString(),
            status: "passed",
          },
          idempotentRestartReplay: "passed",
          apiAllReadRoutesPaginationValidationAndReadOnlyBehavior: "passed",
        },
        null,
        2,
      ),
    );
  } finally {
    anvil.kill();
    await prisma.$disconnect();
  }
}

await main();
