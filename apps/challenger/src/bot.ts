import { appendFileSync, mkdirSync } from "node:fs";
import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { bisectDisputeRegistryV1Abi } from "@bisect/sdk";
import {
  type Address,
  createPublicClient,
  createWalletClient,
  defineChain,
  type Hex,
  http,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { ChallengerConfig } from "./config.js";
import {
  buildInitialStateProof,
  buildTransitionProof,
  buildTreeLevels,
  type ClaimEvidenceInput,
  type EvidenceResult,
  evaluateClaimEvidence,
  getSubtreeChildren,
} from "./evidence.js";
import {
  acquireProcessLock,
  type ChallengerState,
  controlPaths,
  loadState,
  saveState,
  type TrackedGame,
} from "./state-store.js";

const CLAIM_OPEN = 1;
const GAME_BISECTION = 1;
const GAME_TERMINAL = 2;
const GAME_CLOSED = 3;
const MAX_LOG_BLOCK_RANGE = 2_000n;

const claimSubmittedEvent = bisectDisputeRegistryV1Abi.find(
  (item) => item.type === "event" && item.name === "ClaimSubmitted",
);
const challengeStartedEvent = bisectDisputeRegistryV1Abi.find(
  (item) => item.type === "event" && item.name === "ChallengeStarted",
);

interface BotContext {
  readonly config: ChallengerConfig;
  readonly publicClient: PublicClient;
  readonly walletClient?: WalletClient;
  readonly address?: Address;
  readonly state: ChallengerState;
  readonly broadcast: boolean;
}

export interface BotStatus {
  readonly chainId: number;
  readonly rpcHealthy: boolean;
  readonly registryAddress: Address;
  readonly mode: "dry-run" | "broadcast";
  readonly signerAddress: Address | null;
  readonly cursorBlock: string | null;
  readonly spentWei: string;
  readonly reservedWei: string;
  readonly attemptedClaims: number;
  readonly trackedGames: number;
  readonly emergencyStop: boolean;
  readonly disabled: boolean;
  readonly pendingWrite: {
    readonly claimId: string;
    readonly action: string;
    readonly status: "reserved" | "submitted" | "uncertain";
    readonly transactionHash: Hex | null;
  } | null;
}

export interface ClaimInspection {
  readonly claimId: string;
  readonly status: number;
  readonly prover: Address;
  readonly transitionCount: number;
  readonly claimRoot: Hex;
  readonly canonicalRoot: Hex;
  readonly contextHash: Hex;
  readonly challengeDeadline: string;
  readonly claimedOutput: string;
  readonly canonicalOutput: string | null;
  readonly haltedWithinBudget: boolean;
  readonly result: EvidenceResult["kind"];
  readonly outputMatches: boolean;
}

export async function getBotStatus(config: ChallengerConfig): Promise<BotStatus> {
  const { state, address, publicClient } = await createContext(config, false);
  const actualChainId = await publicClient.getChainId();
  if (actualChainId !== config.chainId)
    throw new Error(`RPC chain ID ${actualChainId} does not match configured ${config.chainId}.`);
  await verifyRegistryV1(publicClient, config.registryAddress);
  const controls = controlPaths(config.statePath);
  return {
    chainId: config.chainId,
    rpcHealthy: true,
    registryAddress: config.registryAddress,
    mode: config.broadcastAuthorized ? "broadcast" : "dry-run",
    signerAddress: address ?? null,
    cursorBlock: state.cursorBlock,
    spentWei: state.spentWei,
    reservedWei: state.reservedWei,
    attemptedClaims: Object.keys(state.attemptedClaims).length,
    trackedGames: Object.keys(state.games).length,
    emergencyStop:
      (await exists(controls.emergencyStop)) || process.env["BISECT_BOT_EMERGENCY_STOP"] === "true",
    disabled: await exists(controls.disabled),
    pendingWrite:
      state.pendingWrite == null
        ? null
        : {
            claimId: state.pendingWrite.claimId,
            action: state.pendingWrite.action,
            status: state.pendingWrite.status,
            transactionHash: state.pendingWrite.transactionHash ?? null,
          },
  };
}

export async function inspectClaim(
  config: ChallengerConfig,
  claimId: bigint,
): Promise<ClaimInspection> {
  const { publicClient } = await createContext(config, false);
  const claim = await readClaim(publicClient, config.registryAddress, claimId);
  const evidence = evaluateClaimEvidence(toEvidenceInput(claim));
  const canonicalOutput = evidence.trace.haltedWithinBudget
    ? (evidence.trace.states.at(-1)?.registers[0] ?? null)
    : null;
  return {
    claimId: claimId.toString(),
    status: claim.status,
    prover: claim.prover,
    transitionCount: claim.transitionCount,
    claimRoot: claim.traceRoot,
    canonicalRoot: evidence.trace.traceRoot,
    contextHash: claim.contextHash,
    challengeDeadline: claim.challengeDeadline.toString(),
    claimedOutput: claim.claimedOutput.toString(),
    canonicalOutput,
    haltedWithinBudget: evidence.trace.haltedWithinBudget,
    result: evidence.kind,
    outputMatches: evidence.kind === "context-invalid" ? false : evidence.outputMatches,
  };
}

export async function dryRunClaim(config: ChallengerConfig, claimId: bigint): Promise<void> {
  const context = await createContext(config, false);
  const inspection = await inspectClaim(config, claimId);
  const claim = await readClaim(context.publicClient, config.registryAddress, claimId);
  const head = await context.publicClient.getBlockNumber();
  const bond = await context.publicClient.readContract({
    address: config.registryAddress,
    abi: bisectDisputeRegistryV1Abi,
    functionName: "bondWei",
  });
  log(config, "dry_run", {
    claimId: claimId.toString(),
    result: inspection.result,
    claimedOutput: inspection.claimedOutput,
    canonicalOutput: inspection.canonicalOutput,
    outputMatches: inspection.outputMatches,
    claimRoot: inspection.claimRoot,
    canonicalRoot: inspection.canonicalRoot,
    status: claim.status,
    currentBlock: head.toString(),
    challengeDeadline: claim.challengeDeadline.toString(),
    exactBondWei: bond.toString(),
    eligible: claim.status === CLAIM_OPEN && head < claim.challengeDeadline,
    broadcast: false,
  });
}

export async function runOneCycle(
  config: ChallengerConfig,
  broadcast = config.broadcastAuthorized,
): Promise<void> {
  const context = await createContext(config, broadcast);
  const releaseLock = await acquireProcessLock(config);
  try {
    const actualChainId = await context.publicClient.getChainId();
    if (actualChainId !== config.chainId) {
      throw new Error(`RPC chain ID ${actualChainId} does not match configured ${config.chainId}.`);
    }
    await verifyRegistryV1(context.publicClient, config.registryAddress);
    if (await isStopped(config)) {
      log(config, "bot_stopped", { reason: "emergency stop or disabled control is active" });
      return;
    }
    if (!(await reconcilePendingWrite(context))) return;
    await reconcilePendingChallenge(context);
    await rediscoverOwnActiveGames(context);
    await scanConfirmedEvents(context);
    await processTrackedGames(context);
  } finally {
    await releaseLock();
  }
}

export async function startBot(config: ChallengerConfig): Promise<void> {
  const context = await createContext(config, config.broadcastAuthorized);
  const releaseLock = await acquireProcessLock(config);
  let stopRequested = false;
  const requestStop = () => {
    stopRequested = true;
    log(config, "bot_shutdown_requested", { signal: "SIGINT or SIGTERM" });
  };
  try {
    const actualChainId = await context.publicClient.getChainId();
    if (actualChainId !== config.chainId) {
      throw new Error(`RPC chain ID ${actualChainId} does not match configured ${config.chainId}.`);
    }
    await verifyRegistryV1(context.publicClient, config.registryAddress);
    log(config, "bot_started", {
      chainId: actualChainId,
      registryAddress: config.registryAddress,
      mode: context.broadcast ? "broadcast" : "dry-run",
      signerAddress: context.address ?? null,
      confirmations: config.confirmations,
    });
    process.on("SIGINT", requestStop);
    process.on("SIGTERM", requestStop);
    let consecutiveFailures = 0;
    while (!stopRequested) {
      if (await isStopped(config)) {
        log(config, "bot_stopped", { reason: "emergency stop or disabled control is active" });
        return;
      }
      try {
        if (!(await reconcilePendingWrite(context))) {
          await delay(config.pollIntervalMs);
          continue;
        }
        await reconcilePendingChallenge(context);
        await rediscoverOwnActiveGames(context);
        await scanConfirmedEvents(context);
        await processTrackedGames(context);
        consecutiveFailures = 0;
      } catch (error) {
        consecutiveFailures += 1;
        log(config, "cycle_error", { error: sanitizeError(error, config.rpcUrl) });
        if (consecutiveFailures > config.maxRetries) {
          log(config, "read_retry_limit_reached", {
            consecutiveFailures,
            maxRetries: config.maxRetries,
            note: "The bot stopped without treating unavailable RPC data as challenge evidence.",
          });
          return;
        }
      }
      await delay(config.pollIntervalMs);
    }
  } finally {
    process.off("SIGINT", requestStop);
    process.off("SIGTERM", requestStop);
    await releaseLock();
  }
}

async function createContext(
  config: ChallengerConfig,
  requestBroadcast: boolean,
): Promise<BotContext> {
  const chain = defineChain({
    id: config.chainId,
    name: config.chainId === 31337 ? "Anvil" : "Base Sepolia",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
  });
  const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });
  const state = await loadState(config);
  let walletClient: WalletClient | undefined;
  let address: Address | undefined;
  const broadcast = requestBroadcast && config.broadcastAuthorized;
  if (broadcast) {
    if (config.privateKey !== undefined) {
      const account = privateKeyToAccount(config.privateKey);
      if (
        config.signerAddress !== undefined &&
        account.address.toLowerCase() !== config.signerAddress.toLowerCase()
      ) {
        throw new Error("Configured BISECT_BOT_ADDRESS does not match the private-key signer.");
      }
      address = account.address;
      walletClient = createWalletClient({ account, chain, transport: http(config.rpcUrl) });
    } else if (config.unlockedAddress !== undefined && config.chainId === 31337) {
      address = config.unlockedAddress;
      walletClient = createWalletClient({
        account: address,
        chain,
        transport: http(config.rpcUrl),
      });
    }
    if (walletClient === undefined || address === undefined) {
      throw new Error("Authorized broadcast mode has no explicitly configured bot account.");
    }
  } else if (config.privateKey !== undefined) {
    const derived = privateKeyToAccount(config.privateKey).address;
    if (
      config.signerAddress !== undefined &&
      derived.toLowerCase() !== config.signerAddress.toLowerCase()
    ) {
      throw new Error("Configured BISECT_BOT_ADDRESS does not match the private-key signer.");
    }
    address = derived;
  } else if (config.signerAddress !== undefined) {
    address = config.signerAddress;
  }
  return {
    config,
    publicClient,
    ...(walletClient === undefined ? {} : { walletClient }),
    ...(address === undefined ? {} : { address }),
    state,
    broadcast,
  };
}

async function scanConfirmedEvents(context: BotContext): Promise<void> {
  const { config, publicClient, state } = context;
  const head = await publicClient.getBlockNumber();
  const confirmationDepth = BigInt(config.confirmations);
  if (head < confirmationDepth) return;
  const confirmedHead = head - confirmationDepth;
  await checkCheckpointReorg(context);

  let from = state.cursorBlock === null ? config.deploymentBlock : BigInt(state.cursorBlock) + 1n;
  while (from <= confirmedHead) {
    const to =
      from + MAX_LOG_BLOCK_RANGE - 1n < confirmedHead
        ? from + MAX_LOG_BLOCK_RANGE - 1n
        : confirmedHead;
    const claimLogs =
      claimSubmittedEvent === undefined
        ? []
        : await publicClient.getContractEvents({
            address: config.registryAddress,
            abi: [claimSubmittedEvent],
            eventName: "ClaimSubmitted",
            fromBlock: from,
            toBlock: to,
          });
    for (const event of claimLogs) {
      const claimId = event.args.claimId;
      if (claimId === undefined) continue;
      log(config, "claim_observed", {
        claimId: claimId.toString(),
        blockNumber: event.blockNumber?.toString() ?? null,
      });
      await evaluateAndMaybeChallenge(context, claimId);
    }

    const gameLogs =
      challengeStartedEvent === undefined
        ? []
        : await publicClient.getContractEvents({
            address: config.registryAddress,
            abi: [challengeStartedEvent],
            eventName: "ChallengeStarted",
            fromBlock: from,
            toBlock: to,
          });
    for (const event of gameLogs) {
      const claimId = event.args.claimId;
      const gameNumber = event.args.gameNumber;
      const challenger = event.args.challenger;
      if (claimId === undefined || gameNumber === undefined || challenger === undefined) continue;
      if (
        context.address !== undefined &&
        challenger.toLowerCase() === context.address.toLowerCase()
      ) {
        trackGame(state, claimId, gameNumber);
        await saveState(config, state);
        log(config, "own_dispute_discovered", {
          claimId: claimId.toString(),
          gameNumber: gameNumber.toString(),
        });
      }
    }

    const checkpoint = await publicClient.getBlock({ blockNumber: to });
    state.cursorBlock = to.toString();
    state.cursorHash = checkpoint.hash;
    await saveState(config, state);
    from = to + 1n;
  }
}

async function checkCheckpointReorg(context: BotContext): Promise<void> {
  const { config, publicClient, state } = context;
  if (state.cursorBlock === null || state.cursorHash === null) return;
  const blockNumber = BigInt(state.cursorBlock);
  const head = await publicClient.getBlockNumber();
  let checkpointHash: Hex | null = null;
  if (blockNumber <= head) {
    try {
      checkpointHash = (await publicClient.getBlock({ blockNumber })).hash;
    } catch {
      checkpointHash = null;
    }
  }
  if (checkpointHash?.toLowerCase() === state.cursorHash.toLowerCase()) return;

  state.cursorBlock = null;
  state.cursorHash = null;
  state.games = {};
  await saveState(config, state);
  log(config, "reorganization_detected", {
    previousCheckpoint: blockNumber.toString(),
    currentHead: head.toString(),
    replayFrom: config.deploymentBlock.toString(),
    note: "Events are replayed from deployment. Bond attempts and spend reservations are retained to prevent duplicate financial actions.",
  });
}

async function evaluateAndMaybeChallenge(context: BotContext, claimId: bigint): Promise<void> {
  const key = claimId.toString();
  const prior = context.state.attemptedClaims[key];
  if (prior !== undefined) {
    log(context.config, "claim_deduplicated", { claimId: key, priorStatus: prior.status });
    return;
  }

  let claim: Awaited<ReturnType<typeof readClaim>>;
  try {
    claim = await readClaim(context.publicClient, context.config.registryAddress, claimId);
  } catch (error) {
    log(context.config, "claim_read_unavailable", {
      claimId: key,
      error: sanitizeError(error, context.config.rpcUrl),
    });
    return;
  }
  if (claim.status !== CLAIM_OPEN) {
    log(context.config, "claim_not_eligible", { claimId: key, status: claim.status });
    context.state.attemptedClaims[key] = {
      status: "skipped",
      updatedAt: new Date().toISOString(),
      reason: "claim is not open",
    };
    await saveState(context.config, context.state);
    return;
  }

  let evidence: EvidenceResult;
  try {
    evidence = evaluateClaimEvidence(toEvidenceInput(claim));
  } catch (error) {
    log(context.config, "claim_verification_error", {
      claimId: key,
      error: sanitizeError(error, context.config.rpcUrl),
    });
    return;
  }
  if (evidence.kind === "context-invalid") {
    log(context.config, "claim_context_mismatch", { claimId: key, reason: evidence.reason });
    context.state.attemptedClaims[key] = {
      status: "skipped",
      updatedAt: new Date().toISOString(),
      reason: "canonical context mismatch",
    };
    await saveState(context.config, context.state);
    return;
  }
  if (evidence.kind === "honest") {
    log(context.config, "claim_verified_honest", {
      claimId: key,
      traceRoot: evidence.trace.traceRoot,
      outputMatches: evidence.outputMatches,
      haltedWithinBudget: evidence.trace.haltedWithinBudget,
    });
    context.state.attemptedClaims[key] = {
      status: "skipped",
      updatedAt: new Date().toISOString(),
      reason: "canonical execution root matches",
    };
    await saveState(context.config, context.state);
    return;
  }

  const head = await context.publicClient.getBlockNumber();
  if (head >= claim.challengeDeadline) {
    log(context.config, "suspicious_claim_expired", {
      claimId: key,
      head: head.toString(),
      deadline: claim.challengeDeadline.toString(),
    });
    context.state.attemptedClaims[key] = {
      status: "skipped",
      updatedAt: new Date().toISOString(),
      reason: "challenge deadline is no longer safely reachable",
    };
    await saveState(context.config, context.state);
    return;
  }
  const bond = await context.publicClient.readContract({
    address: context.config.registryAddress,
    abi: bisectDisputeRegistryV1Abi,
    functionName: "bondWei",
  });
  log(context.config, "dishonest_trace_detected", {
    claimId: key,
    claimRoot: claim.traceRoot,
    canonicalRoot: evidence.trace.traceRoot,
    claimedOutput: claim.claimedOutput.toString(),
    canonicalOutput: evidence.trace.haltedWithinBudget
      ? (evidence.trace.states.at(-1)?.registers[0] ?? null)
      : null,
    outputMatches: evidence.outputMatches,
    requiredBondWei: bond.toString(),
    mode: context.broadcast ? "broadcast" : "dry-run",
  });

  if (!context.broadcast) return;
  if (context.address === undefined) throw new Error("Broadcast signer address is unavailable.");
  if (context.address.toLowerCase() === claim.prover.toLowerCase()) {
    log(context.config, "challenge_refused", {
      claimId: key,
      reason: "bot signer is the claim prover",
    });
    return;
  }
  if (bond > context.config.maxBondWei) {
    log(context.config, "challenge_refused", {
      claimId: key,
      reason: "exact bond exceeds per-dispute cap",
      bondWei: bond.toString(),
    });
    return;
  }
  const availableBalance = await context.publicClient.getBalance({
    address: requireAddress(context),
  });
  if (availableBalance < bond) {
    log(context.config, "transaction_refused", {
      claimId: key,
      action: "challenge",
      reason: "insufficient test ETH for the exact challenge bond",
      balanceWei: availableBalance.toString(),
      bondWei: bond.toString(),
    });
    return;
  }
  const initialProof = buildInitialStateProof(evidence.trace);
  const estimated = await context.publicClient.estimateContractGas({
    account: requireAddress(context),
    address: context.config.registryAddress,
    abi: bisectDisputeRegistryV1Abi,
    functionName: "challenge",
    args: [claimId, evidence.trace.traceRoot, initialProof],
    value: bond,
  });
  await executeWrite(context, {
    label: "challenge",
    claimId: key,
    bondExposureWei: bond,
    gasEstimate: estimated,
    send: async (gas, gasPrice) => {
      const client = requireWallet(context);
      return client.writeContract({
        account: requireAddress(context),
        chain: null,
        address: context.config.registryAddress,
        abi: bisectDisputeRegistryV1Abi,
        functionName: "challenge",
        args: [claimId, evidence.trace.traceRoot, initialProof],
        value: bond,
        gas,
        gasPrice,
      });
    },
    onReserved: async (reservation) => {
      context.state.attemptedClaims[key] = {
        status: "reserved",
        updatedAt: new Date().toISOString(),
        reservedWei: reservation.toString(),
        bondWei: bond.toString(),
      };
      await saveState(context.config, context.state);
    },
    onSubmitted: async (hash) => {
      const prior = context.state.attemptedClaims[key];
      context.state.attemptedClaims[key] = {
        status: "submitted",
        updatedAt: new Date().toISOString(),
        transactionHash: hash,
        ...(prior?.reservedWei === undefined ? {} : { reservedWei: prior.reservedWei }),
        ...(prior?.bondWei === undefined ? {} : { bondWei: prior.bondWei }),
      };
      await saveState(context.config, context.state);
    },
    onFinished: async (receipt, actualWei) => {
      const activeGame = await context.publicClient.readContract({
        address: context.config.registryAddress,
        abi: bisectDisputeRegistryV1Abi,
        functionName: "activeGameNumber",
        args: [claimId],
      });
      context.state.attemptedClaims[key] = {
        status: receipt.status === "success" ? "confirmed" : "reverted",
        updatedAt: new Date().toISOString(),
        transactionHash: receipt.transactionHash,
        ...(receipt.status === "success" ? { gameNumber: activeGame.toString() } : {}),
      };
      if (receipt.status === "success" && activeGame > 0n)
        trackGame(context.state, claimId, activeGame);
      await saveState(context.config, context.state);
      if (receipt.status === "success") {
        log(context.config, "challenge_confirmed", {
          claimId: key,
          gameNumber: activeGame.toString(),
          transactionHash: receipt.transactionHash,
          blockNumber: receipt.blockNumber.toString(),
          gasUsed: receipt.gasUsed.toString(),
          gasCostWei: (actualWei - bond).toString(),
          bondWei: bond.toString(),
        });
      }
    },
  });
}

interface WriteOperation {
  readonly label: string;
  readonly claimId: string;
  readonly bondExposureWei: bigint;
  readonly gasEstimate: bigint;
  readonly send: (gas: bigint, gasPrice: bigint) => Promise<Hex>;
  readonly onReserved?: (reservationWei: bigint) => Promise<void>;
  readonly onSubmitted?: (hash: Hex) => Promise<void>;
  readonly onFinished?: (receipt: TransactionReceipt, actualWei: bigint) => Promise<void>;
}

async function executeWrite(
  context: BotContext,
  operation: WriteOperation,
): Promise<TransactionReceipt | null> {
  const config = context.config;
  if (await isStopped(config))
    throw new Error("Emergency stop or disabled control became active before transaction.");
  if (context.state.pendingWrite != null)
    throw new Error("A previous transaction is unresolved; no new write will be submitted.");
  const gasLimit = (operation.gasEstimate * 120n) / 100n + 10_000n;
  const gasPrice = await context.publicClient.getGasPrice();
  const estimatedGasCost = gasLimit * gasPrice;
  if (estimatedGasCost > config.maxGasPerTransactionWei) {
    log(config, "transaction_refused", {
      claimId: operation.claimId,
      action: operation.label,
      reason: "estimated gas cost exceeds configured cap",
      estimatedGasWei: estimatedGasCost.toString(),
      gasCapWei: config.maxGasPerTransactionWei.toString(),
    });
    return null;
  }
  if (operation.bondExposureWei > config.maxBondWei)
    throw new Error("Bond exceeds per-dispute cap.");
  const reserve = operation.bondExposureWei + estimatedGasCost;
  const total = BigInt(context.state.spentWei) + BigInt(context.state.reservedWei) + reserve;
  if (total > config.maxTotalSpendWei) {
    log(config, "transaction_refused", {
      claimId: operation.claimId,
      action: operation.label,
      reason: "estimated cumulative exposure exceeds total spend cap",
      projectedSpendWei: total.toString(),
      spendCapWei: config.maxTotalSpendWei.toString(),
    });
    return null;
  }
  const signerBalance = await context.publicClient.getBalance({ address: requireAddress(context) });
  if (signerBalance < operation.bondExposureWei + estimatedGasCost) {
    log(config, "transaction_refused", {
      claimId: operation.claimId,
      action: operation.label,
      reason: "insufficient test ETH for bond plus estimated gas",
      balanceWei: signerBalance.toString(),
      requiredWei: (operation.bondExposureWei + estimatedGasCost).toString(),
    });
    return null;
  }

  context.state.reservedWei = (BigInt(context.state.reservedWei) + reserve).toString();
  const pendingWrite = {
    claimId: operation.claimId,
    action: operation.label,
    status: "reserved" as const,
    reservedWei: reserve.toString(),
    bondWei: operation.bondExposureWei.toString(),
    updatedAt: new Date().toISOString(),
  };
  context.state.pendingWrite = pendingWrite;
  await saveState(config, context.state);
  await operation.onReserved?.(reserve);
  let hash: Hex;
  try {
    hash = await operation.send(gasLimit, gasPrice);
  } catch (error) {
    context.state.pendingWrite = {
      ...pendingWrite,
      status: "uncertain",
      updatedAt: new Date().toISOString(),
    };
    await saveState(config, context.state);
    log(config, "transaction_send_uncertain", {
      claimId: operation.claimId,
      action: operation.label,
      error: sanitizeError(error, config.rpcUrl),
      note: "Reservation retained; automatic resubmission is disabled to prevent duplicate bonds.",
    });
    const attempt = context.state.attemptedClaims[operation.claimId];
    if (attempt !== undefined) {
      context.state.attemptedClaims[operation.claimId] = {
        ...attempt,
        status: "uncertain",
        updatedAt: new Date().toISOString(),
      };
      await saveState(config, context.state);
    }
    return null;
  }
  context.state.pendingWrite = {
    ...pendingWrite,
    status: "submitted",
    transactionHash: hash,
    updatedAt: new Date().toISOString(),
  };
  await saveState(config, context.state);
  await operation.onSubmitted?.(hash);
  log(config, "transaction_submitted", {
    claimId: operation.claimId,
    action: operation.label,
    transactionHash: hash,
  });
  let receipt: TransactionReceipt;
  try {
    receipt = await context.publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  } catch (error) {
    log(config, "transaction_receipt_pending", {
      claimId: operation.claimId,
      action: operation.label,
      transactionHash: hash,
      error: sanitizeError(error, config.rpcUrl),
      note: "Transaction hash persisted; monitor it before any retry.",
    });
    return null;
  }
  const actualGasCost = receipt.gasUsed * (receipt.effectiveGasPrice ?? gasPrice);
  const actualSpend =
    actualGasCost + (receipt.status === "success" ? operation.bondExposureWei : 0n);
  context.state.reservedWei = (BigInt(context.state.reservedWei) - reserve).toString();
  context.state.spentWei = (BigInt(context.state.spentWei) + actualSpend).toString();
  context.state.pendingWrite = null;
  const pendingAttempt = context.state.attemptedClaims[operation.claimId];
  if (pendingAttempt?.status === "submitted") {
    context.state.attemptedClaims[operation.claimId] = {
      status: receipt.status === "success" ? "confirmed" : "reverted",
      updatedAt: new Date().toISOString(),
      transactionHash: receipt.transactionHash,
    };
  }
  await saveState(config, context.state);
  await operation.onFinished?.(receipt, actualSpend);
  if (receipt.status === "reverted") {
    const attempt = context.state.attemptedClaims[operation.claimId];
    if (attempt !== undefined) {
      context.state.attemptedClaims[operation.claimId] = {
        ...attempt,
        status: "reverted",
        updatedAt: new Date().toISOString(),
      };
      await saveState(config, context.state);
    }
    log(config, "transaction_reverted", {
      claimId: operation.claimId,
      action: operation.label,
      transactionHash: hash,
      blockNumber: receipt.blockNumber.toString(),
      gasUsed: receipt.gasUsed.toString(),
      gasCostWei: actualGasCost.toString(),
    });
  }
  return receipt;
}

async function processTrackedGames(context: BotContext): Promise<void> {
  if (context.state.games === undefined) return;
  for (const tracked of Object.values(context.state.games)) {
    const claimId = BigInt(tracked.claimId);
    const gameNumber = BigInt(tracked.gameNumber);
    let claim: Awaited<ReturnType<typeof readClaim>>;
    let game: Awaited<ReturnType<typeof readGame>>;
    try {
      claim = await readClaim(context.publicClient, context.config.registryAddress, claimId);
      game = await readGame(
        context.publicClient,
        context.config.registryAddress,
        claimId,
        gameNumber,
      );
    } catch (error) {
      log(context.config, "game_read_unavailable", {
        claimId: tracked.claimId,
        gameNumber: tracked.gameNumber,
        error: sanitizeError(error, context.config.rpcUrl),
      });
      continue;
    }
    if (game.phase === GAME_CLOSED || game.settled) {
      log(context.config, "dispute_settlement_observed", {
        claimId: tracked.claimId,
        gameNumber: tracked.gameNumber,
        outcome: game.outcome,
        claimStatus: claim.status,
      });
      delete context.state.games[gameKey(tracked.claimId, tracked.gameNumber)];
      await saveState(context.config, context.state);
      continue;
    }
    if (
      context.address === undefined ||
      game.challenger.toLowerCase() !== context.address.toLowerCase()
    ) {
      log(context.config, "game_tracking_mismatch", {
        claimId: tracked.claimId,
        gameNumber: tracked.gameNumber,
      });
      continue;
    }

    const head = await context.publicClient.getBlockNumber();
    if (game.expectedResponder.toLowerCase() !== context.address.toLowerCase()) {
      if (head > game.deadlineBlock) {
        await submitTimeout(context, claimId, gameNumber, tracked);
      }
      continue;
    }
    if (head >= game.deadlineBlock) {
      // The next mined transaction would be later than deadline equality; settle by the contract rule.
      await submitTimeout(context, claimId, gameNumber, tracked);
      continue;
    }
    if (!context.broadcast) {
      log(context.config, "dispute_move_available", {
        claimId: tracked.claimId,
        gameNumber: tracked.gameNumber,
        phase: game.phase,
        deadlineBlock: game.deadlineBlock.toString(),
        action: game.phase === GAME_BISECTION ? "revealChildren" : "revealTerminal",
        dryRun: true,
      });
      continue;
    }

    const evidence = evaluateClaimEvidence(toEvidenceInput(claim));
    if (evidence.kind !== "suspicious") {
      log(context.config, "tracked_game_context_invalid", {
        claimId: tracked.claimId,
        result: evidence.kind,
      });
      continue;
    }
    if (game.phase === GAME_BISECTION) {
      const levels = buildTreeLevels(evidence.trace);
      const [left, right] = getSubtreeChildren(levels, game.subtreeBaseIndex, game.subtreeHeight);
      const gasEstimate = await context.publicClient.estimateContractGas({
        account: requireAddress(context),
        address: context.config.registryAddress,
        abi: bisectDisputeRegistryV1Abi,
        functionName: "revealChildren",
        args: [claimId, gameNumber, left, right],
      });
      const receipt = await executeWrite(context, {
        label: "revealChildren",
        claimId: tracked.claimId,
        bondExposureWei: 0n,
        gasEstimate,
        send: (gas, gasPrice) =>
          requireWallet(context).writeContract({
            account: requireAddress(context),
            chain: null,
            address: context.config.registryAddress,
            abi: bisectDisputeRegistryV1Abi,
            functionName: "revealChildren",
            args: [claimId, gameNumber, left, right],
            gas,
            gasPrice,
          }),
      });
      if (receipt?.status === "success") {
        log(context.config, "bisection_move_confirmed", {
          claimId: tracked.claimId,
          gameNumber: tracked.gameNumber,
          baseIndex: game.subtreeBaseIndex,
          height: game.subtreeHeight,
          transactionHash: receipt.transactionHash,
          blockNumber: receipt.blockNumber.toString(),
        });
      }
    } else if (game.phase === GAME_TERMINAL) {
      const proof = buildTransitionProof(evidence.trace, game.differentIndex);
      const gasEstimate = await context.publicClient.estimateContractGas({
        account: requireAddress(context),
        address: context.config.registryAddress,
        abi: bisectDisputeRegistryV1Abi,
        functionName: "revealTerminal",
        args: [claimId, gameNumber, proof],
      });
      const receipt = await executeWrite(context, {
        label: "revealTerminal",
        claimId: tracked.claimId,
        bondExposureWei: 0n,
        gasEstimate,
        send: (gas, gasPrice) =>
          requireWallet(context).writeContract({
            account: requireAddress(context),
            chain: null,
            address: context.config.registryAddress,
            abi: bisectDisputeRegistryV1Abi,
            functionName: "revealTerminal",
            args: [claimId, gameNumber, proof],
            gas,
            gasPrice,
          }),
      });
      if (receipt?.status === "success") {
        log(context.config, "terminal_proof_confirmed", {
          claimId: tracked.claimId,
          gameNumber: tracked.gameNumber,
          stateIndex: game.differentIndex,
          transactionHash: receipt.transactionHash,
          blockNumber: receipt.blockNumber.toString(),
        });
      }
    }
  }
}

/** Reconcile a durable write record before any subsequent on-chain action. */
async function reconcilePendingWrite(context: BotContext): Promise<boolean> {
  const pending = context.state.pendingWrite;
  if (pending == null) return true;
  if (pending.transactionHash === undefined) {
    if (pending.status !== "uncertain") {
      context.state.pendingWrite = {
        ...pending,
        status: "uncertain",
        updatedAt: new Date().toISOString(),
      };
      await saveState(context.config, context.state);
      log(context.config, "write_requires_operator_reconciliation", {
        claimId: pending.claimId,
        action: pending.action,
        reason:
          "No transaction hash was durably recorded. The bot will not retry this write automatically.",
      });
    }
    return false;
  }

  let receipt: TransactionReceipt;
  try {
    receipt = await context.publicClient.getTransactionReceipt({ hash: pending.transactionHash });
  } catch {
    return false;
  }

  const reserve = BigInt(pending.reservedWei);
  const bond = BigInt(pending.bondWei);
  const gasCost =
    receipt.effectiveGasPrice === undefined
      ? reserve - bond
      : receipt.gasUsed * receipt.effectiveGasPrice;
  const currentReservation = BigInt(context.state.reservedWei);
  context.state.reservedWei = (
    currentReservation >= reserve ? currentReservation - reserve : 0n
  ).toString();
  context.state.spentWei = (
    BigInt(context.state.spentWei) +
    gasCost +
    (receipt.status === "success" ? bond : 0n)
  ).toString();
  context.state.pendingWrite = null;

  if (pending.action === "challenge") {
    if (receipt.status === "success") {
      const activeGame = await context.publicClient.readContract({
        address: context.config.registryAddress,
        abi: bisectDisputeRegistryV1Abi,
        functionName: "activeGameNumber",
        args: [BigInt(pending.claimId)],
      });
      context.state.attemptedClaims[pending.claimId] = {
        status: "confirmed",
        updatedAt: new Date().toISOString(),
        transactionHash: receipt.transactionHash,
        bondWei: bond.toString(),
        gameNumber: activeGame.toString(),
      };
      if (activeGame > 0n) trackGame(context.state, BigInt(pending.claimId), activeGame);
    } else {
      context.state.attemptedClaims[pending.claimId] = {
        status: "reverted",
        updatedAt: new Date().toISOString(),
        transactionHash: receipt.transactionHash,
        bondWei: bond.toString(),
      };
    }
  }

  await saveState(context.config, context.state);
  log(context.config, "pending_write_reconciled", {
    claimId: pending.claimId,
    action: pending.action,
    transactionHash: receipt.transactionHash,
    receiptStatus: receipt.status,
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
  });
  return true;
}

async function reconcilePendingChallenge(context: BotContext): Promise<void> {
  for (const [claimId, attempt] of Object.entries(context.state.attemptedClaims)) {
    if (attempt.status !== "submitted" || attempt.transactionHash === undefined) continue;
    let receipt: TransactionReceipt;
    try {
      receipt = await context.publicClient.getTransactionReceipt({ hash: attempt.transactionHash });
    } catch {
      // A not-yet-included or reorganized transaction is never resent automatically.
      continue;
    }
    const reservation = BigInt(attempt.reservedWei ?? "0");
    const bond = BigInt(attempt.bondWei ?? "0");
    const gasCost = receipt.gasUsed * (receipt.effectiveGasPrice ?? 0n);
    const safeReserved = BigInt(context.state.reservedWei);
    context.state.reservedWei = (
      safeReserved >= reservation ? safeReserved - reservation : 0n
    ).toString();
    context.state.spentWei = (
      BigInt(context.state.spentWei) +
      gasCost +
      (receipt.status === "success" ? bond : 0n)
    ).toString();
    if (receipt.status === "success") {
      const activeGame = await context.publicClient.readContract({
        address: context.config.registryAddress,
        abi: bisectDisputeRegistryV1Abi,
        functionName: "activeGameNumber",
        args: [BigInt(claimId)],
      });
      context.state.attemptedClaims[claimId] = {
        status: "confirmed",
        updatedAt: new Date().toISOString(),
        transactionHash: receipt.transactionHash,
        gameNumber: activeGame.toString(),
      };
      if (activeGame > 0n) trackGame(context.state, BigInt(claimId), activeGame);
    } else {
      context.state.attemptedClaims[claimId] = {
        status: "reverted",
        updatedAt: new Date().toISOString(),
        transactionHash: receipt.transactionHash,
      };
    }
    await saveState(context.config, context.state);
    log(context.config, "pending_challenge_reconciled", {
      claimId,
      transactionHash: receipt.transactionHash,
      receiptStatus: receipt.status,
      gasUsed: receipt.gasUsed.toString(),
      bondWei: receipt.status === "success" ? bond.toString() : "0",
    });
  }
}

async function rediscoverOwnActiveGames(context: BotContext): Promise<void> {
  if (context.address === undefined) return;
  for (const [claimId, attempt] of Object.entries(context.state.attemptedClaims)) {
    if (attempt.status !== "confirmed") continue;
    const activeGame = await context.publicClient.readContract({
      address: context.config.registryAddress,
      abi: bisectDisputeRegistryV1Abi,
      functionName: "activeGameNumber",
      args: [BigInt(claimId)],
    });
    if (activeGame === 0n) continue;
    const key = gameKey(claimId, activeGame.toString());
    if (context.state.games[key] !== undefined) continue;
    trackGame(context.state, BigInt(claimId), activeGame);
    await saveState(context.config, context.state);
    log(context.config, "active_game_recovered", {
      claimId,
      gameNumber: activeGame.toString(),
      source: "authoritative activeGameNumber view",
    });
  }
}

async function submitTimeout(
  context: BotContext,
  claimId: bigint,
  gameNumber: bigint,
  tracked: TrackedGame,
): Promise<void> {
  if (!context.broadcast) {
    log(context.config, "timeout_resolution_available", {
      claimId: tracked.claimId,
      gameNumber: tracked.gameNumber,
      dryRun: true,
    });
    return;
  }
  if (context.address === undefined) return;
  const gasEstimate = await context.publicClient.estimateContractGas({
    account: requireAddress(context),
    address: context.config.registryAddress,
    abi: bisectDisputeRegistryV1Abi,
    functionName: "claimTimeout",
    args: [claimId, gameNumber],
  });
  await executeWrite(context, {
    label: "claimTimeout",
    claimId: tracked.claimId,
    bondExposureWei: 0n,
    gasEstimate,
    send: (gas, gasPrice) =>
      requireWallet(context).writeContract({
        account: requireAddress(context),
        chain: null,
        address: context.config.registryAddress,
        abi: bisectDisputeRegistryV1Abi,
        functionName: "claimTimeout",
        args: [claimId, gameNumber],
        gas,
        gasPrice,
      }),
  });
}

async function readClaim(client: PublicClient, address: Address, claimId: bigint) {
  return client.readContract({
    address,
    abi: bisectDisputeRegistryV1Abi,
    functionName: "getClaim",
    args: [claimId],
  });
}

async function readGame(
  client: PublicClient,
  address: Address,
  claimId: bigint,
  gameNumber: bigint,
) {
  return client.readContract({
    address,
    abi: bisectDisputeRegistryV1Abi,
    functionName: "getGame",
    args: [claimId, gameNumber],
  });
}

function toEvidenceInput(claim: Awaited<ReturnType<typeof readClaim>>): ClaimEvidenceInput {
  return {
    status: claim.status,
    prover: claim.prover,
    program: claim.program,
    publicInput: claim.publicInput,
    transitionCount: claim.transitionCount,
    traceRoot: claim.traceRoot,
    claimedOutput: claim.claimedOutput,
    contextHash: claim.contextHash,
    challengeDeadline: claim.challengeDeadline,
  };
}

function trackGame(state: ChallengerState, claimId: bigint, gameNumber: bigint): void {
  const claim = claimId.toString();
  const number = gameNumber.toString();
  state.games[gameKey(claim, number)] = {
    claimId: claim,
    gameNumber: number,
    discoveredAt: new Date().toISOString(),
  };
}

function gameKey(claimId: string, gameNumber: string): string {
  return `${claimId}:${gameNumber}`;
}

async function isStopped(config: ChallengerConfig): Promise<boolean> {
  const paths = controlPaths(config.statePath);
  return (
    process.env["BISECT_BOT_EMERGENCY_STOP"] === "true" ||
    (await exists(paths.emergencyStop)) ||
    (await exists(paths.disabled))
  );
}

function requireWallet(context: BotContext): WalletClient {
  if (!context.broadcast || context.walletClient === undefined) {
    throw new Error("Transaction requested while the bot is in dry-run mode.");
  }
  return context.walletClient;
}

function requireAddress(context: BotContext): Address {
  if (context.address === undefined) throw new Error("Signer address is not configured.");
  return context.address;
}

function log(config: ChallengerConfig, event: string, fields: Record<string, unknown>): void {
  const record = {
    timestamp: new Date().toISOString(),
    service: "bisect-challenger",
    event,
    ...fields,
  };
  const serialized = JSON.stringify(record, (_key, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value,
  );
  console.log(serialized);
  const path = resolve(config.logPath);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${serialized}\n`, { encoding: "utf8", mode: 0o600 });
}

function sanitizeError(error: unknown, rpcUrl: string): string {
  const message = error instanceof Error ? error.message : String(error);
  const host = new URL(rpcUrl).host;
  return message.replaceAll(rpcUrl, `${new URL(rpcUrl).protocol}//${host}`).slice(0, 500);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function verifyRegistryV1(client: PublicClient, address: Address): Promise<void> {
  const versions = await Promise.all([
    client.readContract({
      address,
      abi: bisectDisputeRegistryV1Abi,
      functionName: "PROTOCOL_VERSION",
    }),
    client.readContract({ address, abi: bisectDisputeRegistryV1Abi, functionName: "VM_VERSION" }),
    client.readContract({
      address,
      abi: bisectDisputeRegistryV1Abi,
      functionName: "ENCODING_VERSION",
    }),
  ]);
  if (versions.some((version) => version !== 1)) {
    throw new Error("Configured registry does not expose the locked protocol/VM/encoding v1.");
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
