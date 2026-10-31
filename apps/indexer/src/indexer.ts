import { bisectDisputeRegistryV1Abi } from "@bisect/sdk";
import {
  createPublicClient,
  decodeEventLog,
  defineChain,
  getAddress,
  type Hex,
  http,
  type PublicClient,
} from "viem";
import type { IndexerConfig } from "./config.js";
import { prisma } from "./database.js";
import type { Prisma } from "./generated/prisma/client.js";
import {
  challengerLockedCode,
  contractCustodyCode,
  ensureBalanced,
  type LedgerEntryPlan,
  parseWei,
  planBondLock,
  planLiabilityTransfer,
  planWithdrawal,
  proverLockedCode,
  reverseLines,
  walletCreditCode,
} from "./ledger.js";

export interface IndexerRunResult {
  readonly chainId: number;
  readonly scannedFromBlock: string | null;
  readonly scannedToBlock: string | null;
  readonly confirmedThroughBlock: string;
  readonly observedEvents: number;
  readonly newlyConfirmedEvents: number;
  readonly reorgAncestor: string | null;
}

interface DecodedEvent {
  readonly eventName: string;
  readonly payload: Prisma.InputJsonObject;
}

interface StoredEvent {
  readonly id: bigint;
  readonly chainId: number;
  readonly blockNumber: bigint;
  readonly blockHash: string;
  readonly transactionHash: string;
  readonly logIndex: number;
  readonly contractAddress: string;
  readonly eventName: string;
  readonly payload: Prisma.JsonValue;
}

interface AccountSpec {
  readonly code: string;
  readonly name: string;
  readonly type: "ASSET" | "LOCKED_LIABILITY" | "WITHDRAWABLE_LIABILITY";
  readonly walletId?: string;
}

const maximumPostingsPerEvent = 5;

function minBigInt(left: bigint, right: bigint): bigint {
  if (left < right) return left;
  return right;
}

function maxBigInt(left: bigint, right: bigint): bigint {
  if (left > right) return left;
  return right;
}

function requireRecord(value: Prisma.JsonValue, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} payload must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} is missing.`);
  return value;
}

function requireAddress(value: unknown, label: string): `0x${string}` {
  const raw = requireString(value, label);
  try {
    return getAddress(raw);
  } catch {
    throw new Error(`${label} is not a valid EVM address.`);
  }
}

function requireInteger(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new Error(`${label} is not a valid integer.`);
  return parsed;
}

function requireEventWei(payload: Record<string, unknown>, field: string): bigint {
  return parseWei(payload[field], field);
}

function decodeLog(log: { readonly data: Hex; readonly topics: readonly Hex[] }): DecodedEvent {
  const signature = log.topics[0];
  if (signature === undefined) throw new Error("Registry event is missing its signature topic.");
  const topics: [Hex, ...Hex[]] = [signature, ...log.topics.slice(1)];
  const decoded = decodeEventLog({
    abi: bisectDisputeRegistryV1Abi,
    data: log.data,
    topics,
    strict: true,
  });
  const args = decoded.args as unknown;
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    throw new Error(`Event ${decoded.eventName} arguments are malformed.`);
  }
  const payloadEntries: Array<[string, Prisma.InputJsonValue]> = [];
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "bigint") payloadEntries.push([key, value.toString()]);
    else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      payloadEntries.push([key, value]);
    } else throw new Error(`Event ${decoded.eventName}.${key} has an unsupported value.`);
  }
  return { eventName: decoded.eventName, payload: Object.fromEntries(payloadEntries) };
}

async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= values.length) return;
      const value = values[index];
      if (value === undefined) return;
      results[index] = await mapper(value);
    }
  });
  await Promise.all(workers);
  return results;
}

function clientFor(config: IndexerConfig): PublicClient {
  const chain = defineChain({
    id: config.chainId,
    name: config.chainId === 84532 ? "Base Sepolia" : `EVM chain ${config.chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
  });
  return createPublicClient({ chain, transport: http(config.rpcUrl, { timeout: 15_000 }) });
}

function toBlockJson(value: bigint): string {
  return value.toString();
}

async function getCheckpoint(client: PublicClient, config: IndexerConfig) {
  const existing = await prisma.indexerCheckpoint.findUnique({
    where: {
      chainId_contractAddress: {
        chainId: config.chainId,
        contractAddress: config.contractAddress.toLowerCase(),
      },
    },
  });
  if (existing !== null) {
    if (existing.deploymentBlock !== config.deploymentBlock) {
      throw new Error(
        "INDEXER_DEPLOYMENT_BLOCK differs from the persisted checkpoint configuration.",
      );
    }
    if (existing.confirmationDepth !== config.confirmations) {
      throw new Error("INDEXER_CONFIRMATIONS differs from the persisted checkpoint policy.");
    }
    return existing;
  }
  const beforeDeployment = config.deploymentBlock - 1n;
  let lastBlockHash = `0x${"00".repeat(32)}`;
  if (beforeDeployment >= 0n) {
    const previousBlock = await client.getBlock({ blockNumber: beforeDeployment });
    lastBlockHash = previousBlock.hash;
  }
  return prisma.indexerCheckpoint.create({
    data: {
      chainId: config.chainId,
      contractAddress: config.contractAddress.toLowerCase(),
      deploymentBlock: config.deploymentBlock,
      confirmationDepth: config.confirmations,
      lastBlockNumber: beforeDeployment,
      lastBlockHash,
      confirmedBlock: beforeDeployment,
    },
  });
}

async function scanChunk(
  client: PublicClient,
  config: IndexerConfig,
  fromBlock: bigint,
  toBlock: bigint,
  expectedParentHash: string | null,
): Promise<void> {
  const range = Array.from(
    { length: Number(toBlock - fromBlock + 1n) },
    (_, index) => fromBlock + BigInt(index),
  );
  const headers = await mapConcurrent(range, 16, async (blockNumber) =>
    client.getBlock({ blockNumber }),
  );
  const blockByNumber = new Map<bigint, (typeof headers)[number]>();
  for (const header of headers) {
    if (header.number === null) throw new Error("RPC returned a block without its number.");
    blockByNumber.set(header.number, header);
  }
  for (let index = 1; index < headers.length; index += 1) {
    const previous = headers[index - 1];
    const current = headers[index];
    if (previous === undefined || current === undefined || current.parentHash !== previous.hash) {
      throw new Error("RPC chain changed during a scan range; retry after the next poll.");
    }
  }
  const firstHeader = headers[0];
  if (
    expectedParentHash !== null &&
    firstHeader?.parentHash.toLowerCase() !== expectedParentHash.toLowerCase()
  ) {
    throw new Error(
      "RPC chain changed at the scan checkpoint; indexer will retry after reorganization recovery.",
    );
  }
  const logs = await client.getLogs({
    address: config.contractAddress,
    fromBlock,
    toBlock,
  });
  const decodedLogs = logs.map((log) => ({ log, decoded: decodeLog(log) }));
  for (const { log } of decodedLogs) {
    if (log.blockNumber === null || log.blockHash === null || !blockByNumber.has(log.blockNumber)) {
      throw new Error("RPC returned a log without a matching scanned block header.");
    }
    if (blockByNumber.get(log.blockNumber)?.hash !== log.blockHash) {
      throw new Error("RPC log block hash disagrees with the canonical header.");
    }
  }
  await prisma.$transaction(async (tx) => {
    for (const header of headers) {
      const blockNumber = header.number;
      if (blockNumber === null) throw new Error("Block number unexpectedly absent.");
      if (header.timestamp > 8_640_000_000_000n) {
        throw new Error("RPC block timestamp is outside the supported PostgreSQL timestamp range.");
      }
      await tx.chainBlock.upsert({
        where: { chainId_hash: { chainId: config.chainId, hash: header.hash } },
        create: {
          chainId: config.chainId,
          blockNumber,
          hash: header.hash,
          parentHash: header.parentHash,
          timestamp: new Date(Number(header.timestamp) * 1000),
          status: "OBSERVED",
        },
        update: {
          blockNumber,
          parentHash: header.parentHash,
          timestamp: new Date(Number(header.timestamp) * 1000),
          status: "OBSERVED",
        },
      });
    }
    for (const { log, decoded } of decodedLogs) {
      if (log.blockNumber === null || log.blockHash === null || log.transactionHash === null) {
        throw new Error("RPC returned an event without canonical transaction coordinates.");
      }
      await tx.chainEvent.upsert({
        where: {
          chainId_blockHash_transactionHash_logIndex: {
            chainId: config.chainId,
            blockHash: log.blockHash,
            transactionHash: log.transactionHash,
            logIndex: log.logIndex,
          },
        },
        create: {
          chainId: config.chainId,
          blockNumber: log.blockNumber,
          blockHash: log.blockHash,
          transactionHash: log.transactionHash,
          transactionIndex: log.transactionIndex,
          logIndex: log.logIndex,
          contractAddress: config.contractAddress.toLowerCase(),
          eventName: decoded.eventName,
          payload: decoded.payload,
          rawTopics: [...log.topics],
          rawData: log.data,
          status: "OBSERVED",
        },
        update: {
          eventName: decoded.eventName,
          payload: decoded.payload,
          rawTopics: [...log.topics],
          rawData: log.data,
          status: "OBSERVED",
        },
      });
    }
    const lastHeader = headers.at(-1);
    if (lastHeader?.number === null || lastHeader?.number === undefined) {
      throw new Error("Scan range did not return its terminal block.");
    }
    await tx.indexerCheckpoint.update({
      where: {
        chainId_contractAddress: {
          chainId: config.chainId,
          contractAddress: config.contractAddress.toLowerCase(),
        },
      },
      data: { lastBlockNumber: lastHeader.number, lastBlockHash: lastHeader.hash },
    });
  });
}

async function ensureWallet(
  tx: Prisma.TransactionClient,
  chainId: number,
  address: string,
): Promise<{ id: string; address: string }> {
  const normalized = requireAddress(address, "wallet address").toLowerCase();
  return tx.walletAccount.upsert({
    where: { chainId_address: { chainId, address: normalized } },
    create: { chainId, address: normalized },
    update: {},
    select: { id: true, address: true },
  });
}

async function ensureLedgerAccount(
  tx: Prisma.TransactionClient,
  config: IndexerConfig,
  spec: AccountSpec,
): Promise<string> {
  const existing = await tx.ledgerAccount.findUnique({
    where: { code: spec.code },
    select: { id: true },
  });
  if (existing !== null) return existing.id;
  const data = {
    code: spec.code,
    name: spec.name,
    type: spec.type,
    normalSide: spec.type === "ASSET" ? ("DEBIT" as const) : ("CREDIT" as const),
    chainId: config.chainId,
    contractAddress: config.contractAddress.toLowerCase(),
    ...(spec.walletId === undefined ? {} : { walletId: spec.walletId }),
  };
  const created = await tx.ledgerAccount.create({ data, select: { id: true } });
  return created.id;
}

async function postJournal(
  tx: Prisma.TransactionClient,
  config: IndexerConfig,
  event: StoredEvent,
  plan: LedgerEntryPlan,
): Promise<void> {
  const original = await tx.journalTransaction.findUnique({
    where: { eventId: event.id },
    include: { postings: { include: { account: true } } },
  });
  if (original !== null) {
    const { tail, reversalDepth } = await journalTail(tx, original);
    if (reversalDepth % 2 === 0) return;
    await createInverseJournal(tx, config, event, tail, event.blockNumber, event.blockHash);
    return;
  }
  if (plan.lines.length > maximumPostingsPerEvent)
    throw new Error("Journal exceeds its posting bound.");
  ensureBalanced(plan.lines);
  const accounts = new Map<string, string>();
  for (const line of plan.lines) {
    let type: AccountSpec["type"];
    let walletId: string | undefined;
    if (line.accountCode.endsWith(":custody")) type = "ASSET";
    else if (line.accountCode.includes(":wallet:")) {
      type = "WITHDRAWABLE_LIABILITY";
      const addressPart = line.accountCode.split(":wallet:")[1]?.split(":")[0];
      if (addressPart === undefined) throw new Error("Wallet liability account code is malformed.");
      walletId = (await ensureWallet(tx, config.chainId, addressPart)).id;
    } else type = "LOCKED_LIABILITY";
    accounts.set(
      line.accountCode,
      await ensureLedgerAccount(tx, config, {
        code: line.accountCode,
        name: line.accountName,
        type,
        ...(walletId === undefined ? {} : { walletId }),
      }),
    );
  }
  const postings = plan.lines.map((line) => {
    const accountId = accounts.get(line.accountCode);
    if (accountId === undefined) throw new Error("Journal posting lost its account reference.");
    return { accountId, side: line.side, amountWei: line.amountWei.toString() };
  });
  await tx.journalTransaction.create({
    data: {
      chainId: config.chainId,
      contractAddress: config.contractAddress.toLowerCase(),
      eventId: event.id,
      transactionHash: event.transactionHash,
      blockNumber: event.blockNumber,
      blockHash: event.blockHash,
      kind: plan.kind,
      postings: { create: postings },
    },
  });
}

type JournalWithPostings = Prisma.JournalTransactionGetPayload<{
  include: { postings: { include: { account: true } } };
}>;

async function journalTail(
  tx: Prisma.TransactionClient,
  start: JournalWithPostings,
): Promise<{ readonly tail: JournalWithPostings; readonly reversalDepth: number }> {
  let tail = start;
  let reversalDepth = 0;
  while (reversalDepth < 64) {
    const child = await tx.journalTransaction.findUnique({
      where: { reversalOfId: tail.id },
      include: { postings: { include: { account: true } } },
    });
    if (child === null) return { tail, reversalDepth };
    tail = child;
    reversalDepth += 1;
  }
  throw new Error("Journal reversal chain exceeded 64 entries; operator review is required.");
}

async function createInverseJournal(
  tx: Prisma.TransactionClient,
  config: IndexerConfig,
  event: Pick<StoredEvent, "transactionHash" | "blockHash" | "logIndex">,
  target: JournalWithPostings,
  blockNumber: bigint,
  blockHash: string,
): Promise<void> {
  const reversed = reverseLines(
    target.postings.map((posting) => ({
      accountCode: posting.account.code,
      accountName: posting.account.name,
      side: posting.side,
      amountWei: BigInt(posting.amountWei.toFixed(0)),
    })),
  );
  ensureBalanced(reversed);
  const accounts = new Map<string, string>();
  for (const line of reversed) {
    const account = target.postings.find(
      (posting) => posting.account.code === line.accountCode,
    )?.accountId;
    if (account === undefined) throw new Error("Journal reversal lost an account reference.");
    accounts.set(line.accountCode, account);
  }
  const postings = reversed.map((line) => {
    const accountId = accounts.get(line.accountCode);
    if (accountId === undefined) throw new Error("Journal reversal lost an account reference.");
    return { accountId, side: line.side, amountWei: line.amountWei.toString() };
  });
  await tx.journalTransaction.create({
    data: {
      chainId: config.chainId,
      contractAddress: config.contractAddress.toLowerCase(),
      transactionHash: `reorg:${event.blockHash}:${event.transactionHash}:${event.logIndex}`,
      blockNumber,
      blockHash,
      kind: "REORG_REVERSAL",
      reversalOfId: target.id,
      postings: { create: postings },
    },
  });
}

async function projectClaimSubmitted(
  tx: Prisma.TransactionClient,
  config: IndexerConfig,
  event: StoredEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  const claimId = parseWei(payload["claimId"], "claimId").toString();
  const prover = await ensureWallet(
    tx,
    config.chainId,
    requireAddress(payload["prover"], "prover"),
  );
  const bondWei = requireEventWei(payload, "bondWei");
  const claim = await tx.claim.upsert({
    where: {
      chainId_contractAddress_claimId: {
        chainId: config.chainId,
        contractAddress: config.contractAddress.toLowerCase(),
        claimId,
      },
    },
    create: {
      chainId: config.chainId,
      contractAddress: config.contractAddress.toLowerCase(),
      claimId,
      proverWalletId: prover.id,
      contextHash: requireString(payload["contextHash"], "contextHash"),
      traceRoot: requireString(payload["traceRoot"], "traceRoot"),
      transitionCount: requireInteger(payload["transitionCount"], "transitionCount"),
      claimedOutput: parseWei(payload["claimedOutput"], "claimedOutput").toString(),
      challengeDeadline: parseWei(payload["challengeDeadline"], "challengeDeadline"),
      submittedBlock: event.blockNumber,
      sourceEventId: event.id,
      status: "OPEN",
    },
    update: {
      proverWalletId: prover.id,
      contextHash: requireString(payload["contextHash"], "contextHash"),
      traceRoot: requireString(payload["traceRoot"], "traceRoot"),
      transitionCount: requireInteger(payload["transitionCount"], "transitionCount"),
      claimedOutput: parseWei(payload["claimedOutput"], "claimedOutput").toString(),
      challengeDeadline: parseWei(payload["challengeDeadline"], "challengeDeadline"),
      submittedBlock: event.blockNumber,
      sourceEventId: event.id,
      status: "OPEN",
    },
  });
  await tx.bondDeposit.upsert({
    where: { eventId: event.id },
    create: {
      chainId: config.chainId,
      contractAddress: config.contractAddress.toLowerCase(),
      claimRecordId: claim.id,
      walletId: prover.id,
      kind: "PROVER",
      amountWei: bondWei.toString(),
      eventId: event.id,
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash,
    },
    update: { claimRecordId: claim.id, walletId: prover.id, amountWei: bondWei.toString() },
  });
  const custody = contractCustodyCode(config.chainId, config.contractAddress);
  const locked = proverLockedCode(config.chainId, config.contractAddress, claimId);
  await postJournal(
    tx,
    config,
    event,
    planBondLock(custody, locked, `Claim ${claimId} prover bond locked`, bondWei),
  );
}

async function projectChallengeStarted(
  tx: Prisma.TransactionClient,
  config: IndexerConfig,
  event: StoredEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  const claimId = parseWei(payload["claimId"], "claimId").toString();
  const claim = await tx.claim.findUnique({
    where: {
      chainId_contractAddress_claimId: {
        chainId: config.chainId,
        contractAddress: config.contractAddress.toLowerCase(),
        claimId,
      },
    },
  });
  if (claim === null) throw new Error(`ChallengeStarted references unindexed claim ${claimId}.`);
  const challenger = await ensureWallet(
    tx,
    config.chainId,
    requireAddress(payload["challenger"], "challenger"),
  );
  const gameNumber = parseWei(payload["gameNumber"], "gameNumber").toString();
  const dispute = await tx.dispute.upsert({
    where: {
      chainId_contractAddress_claimId_gameNumber: {
        chainId: config.chainId,
        contractAddress: config.contractAddress.toLowerCase(),
        claimId,
        gameNumber,
      },
    },
    create: {
      claimRecordId: claim.id,
      chainId: config.chainId,
      contractAddress: config.contractAddress.toLowerCase(),
      claimId,
      gameNumber,
      challengerWalletId: challenger.id,
      challengerRoot: requireString(payload["challengerRoot"], "challengerRoot"),
      initialHeight: requireInteger(payload["initialHeight"], "initialHeight"),
      expectedResponder: requireAddress(
        payload["expectedResponder"],
        "expectedResponder",
      ).toLowerCase(),
      deadlineBlock: parseWei(payload["deadlineBlock"], "deadlineBlock"),
      phase: "BISECTION",
      sourceEventId: event.id,
      status: "ACTIVE",
    },
    update: {
      challengerWalletId: challenger.id,
      challengerRoot: requireString(payload["challengerRoot"], "challengerRoot"),
      initialHeight: requireInteger(payload["initialHeight"], "initialHeight"),
      expectedResponder: requireAddress(
        payload["expectedResponder"],
        "expectedResponder",
      ).toLowerCase(),
      deadlineBlock: parseWei(payload["deadlineBlock"], "deadlineBlock"),
      phase: "BISECTION",
      differentIndex: null,
      sourceEventId: event.id,
      status: "ACTIVE",
      outcome: null,
    },
  });
  await tx.claim.update({ where: { id: claim.id }, data: { status: "GAME_ACTIVE" } });
  const amount = requireEventWei(payload, "bondWei");
  const deposit = await tx.bondDeposit.upsert({
    where: { eventId: event.id },
    create: {
      chainId: config.chainId,
      contractAddress: config.contractAddress.toLowerCase(),
      claimRecordId: claim.id,
      disputeId: dispute.id,
      walletId: challenger.id,
      kind: "CHALLENGER",
      amountWei: amount.toString(),
      eventId: event.id,
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash,
    },
    update: {
      claimRecordId: claim.id,
      disputeId: dispute.id,
      walletId: challenger.id,
      amountWei: amount.toString(),
    },
  });
  void deposit;
  await postJournal(
    tx,
    config,
    event,
    planBondLock(
      contractCustodyCode(config.chainId, config.contractAddress),
      challengerLockedCode(config.chainId, config.contractAddress, claimId, gameNumber),
      `Claim ${claimId} game ${gameNumber} challenger bond locked`,
      amount,
    ),
  );
}

async function projectGameBondCredited(
  tx: Prisma.TransactionClient,
  config: IndexerConfig,
  event: StoredEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  const claimId = parseWei(payload["claimId"], "claimId").toString();
  const gameNumber = parseWei(payload["gameNumber"], "gameNumber").toString();
  const claim = await tx.claim.findUnique({
    where: {
      chainId_contractAddress_claimId: {
        chainId: config.chainId,
        contractAddress: config.contractAddress.toLowerCase(),
        claimId,
      },
    },
  });
  const dispute = await tx.dispute.findUnique({
    where: {
      chainId_contractAddress_claimId_gameNumber: {
        chainId: config.chainId,
        contractAddress: config.contractAddress.toLowerCase(),
        claimId,
        gameNumber,
      },
    },
  });
  if (claim === null || dispute === null)
    throw new Error("GameBondCredited references an unknown claim/game.");
  const beneficiaryAddress = requireAddress(payload["beneficiary"], "beneficiary").toLowerCase();
  const beneficiary = await ensureWallet(tx, config.chainId, beneficiaryAddress);
  const amount = requireEventWei(payload, "amountWei");
  const outcome = requireInteger(payload["outcome"], "outcome");
  const proverDeposit = await tx.bondDeposit.findFirst({
    where: { claimRecordId: claim.id, kind: "PROVER" },
    orderBy: { blockNumber: "asc" },
  });
  const challengerDeposit = await tx.bondDeposit.findFirst({
    where: { disputeId: dispute.id, kind: "CHALLENGER" },
  });
  if (proverDeposit === null || challengerDeposit === null) {
    throw new Error("Game settlement is missing one of its confirmed bond deposits.");
  }
  const proverBond = BigInt(proverDeposit.amountWei.toFixed(0));
  const challengerBond = BigInt(challengerDeposit.amountWei.toFixed(0));
  if (proverBond !== challengerBond)
    throw new Error("V1 prover and challenger bond amounts differ.");
  const challengerWon = outcome >= 3 && outcome <= 5;
  if (
    (challengerWon && amount !== proverBond + challengerBond) ||
    (!challengerWon && amount !== challengerBond)
  ) {
    throw new Error("GameBondCredited amount does not match the v1 settlement outcome.");
  }
  const expectedWallet = await tx.walletAccount.findUniqueOrThrow({
    where: { id: challengerWon ? dispute.challengerWalletId : claim.proverWalletId },
  });
  if (beneficiaryAddress !== expectedWallet.address)
    throw new Error("Settlement beneficiary disagrees with v1 outcome.");
  const debitAccounts = challengerWon
    ? [
        {
          accountCode: proverLockedCode(config.chainId, config.contractAddress, claimId),
          accountName: `Claim ${claimId} prover bond locked`,
          amountWei: proverBond,
        },
        {
          accountCode: challengerLockedCode(
            config.chainId,
            config.contractAddress,
            claimId,
            gameNumber,
          ),
          accountName: `Claim ${claimId} game ${gameNumber} challenger bond locked`,
          amountWei: challengerBond,
        },
      ]
    : [
        {
          accountCode: challengerLockedCode(
            config.chainId,
            config.contractAddress,
            claimId,
            gameNumber,
          ),
          accountName: `Claim ${claimId} game ${gameNumber} challenger bond locked`,
          amountWei: challengerBond,
        },
      ];
  const creditCode = walletCreditCode(config.chainId, config.contractAddress, beneficiaryAddress);
  await postJournal(
    tx,
    config,
    event,
    planLiabilityTransfer(
      debitAccounts,
      creditCode,
      `${beneficiaryAddress} withdrawable ETH liability`,
      amount,
    ),
  );
  await tx.settlement.upsert({
    where: { eventId: event.id },
    create: {
      chainId: config.chainId,
      contractAddress: config.contractAddress.toLowerCase(),
      claimRecordId: claim.id,
      disputeId: dispute.id,
      beneficiaryWalletId: beneficiary.id,
      kind: "GAME_CREDIT",
      outcome,
      amountWei: amount.toString(),
      eventId: event.id,
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash,
    },
    update: { beneficiaryWalletId: beneficiary.id, outcome, amountWei: amount.toString() },
  });
  await tx.bondAllocation.upsert({
    where: {
      eventId_allocationType: {
        eventId: event.id,
        allocationType: challengerWon ? "BOTH_BONDS_CREDITED" : "CHALLENGER_BOND_CREDITED",
      },
    },
    create: {
      chainId: config.chainId,
      contractAddress: config.contractAddress.toLowerCase(),
      claimRecordId: claim.id,
      disputeId: dispute.id,
      allocationType: challengerWon ? "BOTH_BONDS_CREDITED" : "CHALLENGER_BOND_CREDITED",
      amountWei: amount.toString(),
      eventId: event.id,
    },
    update: { amountWei: amount.toString() },
  });
  await tx.bondDeposit.updateMany({
    where: { disputeId: dispute.id },
    data: { status: "RELEASED" },
  });
  if (challengerWon) {
    await tx.bondDeposit.updateMany({
      where: { claimRecordId: claim.id, kind: "PROVER" },
      data: { status: "SLASHED" },
    });
  }
  await tx.dispute.update({
    where: { id: dispute.id },
    data: { status: challengerWon ? "CHALLENGER_WON" : "PROVER_WON", outcome, phase: "CLOSED" },
  });
}

async function projectClaimFinalized(
  tx: Prisma.TransactionClient,
  config: IndexerConfig,
  event: StoredEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  const claimId = parseWei(payload["claimId"], "claimId").toString();
  const claim = await tx.claim.findUnique({
    where: {
      chainId_contractAddress_claimId: {
        chainId: config.chainId,
        contractAddress: config.contractAddress.toLowerCase(),
        claimId,
      },
    },
  });
  if (claim === null) throw new Error(`ClaimFinalized references unknown claim ${claimId}.`);
  const amount = requireEventWei(payload, "bondWei");
  const prover = await tx.walletAccount.findUniqueOrThrow({ where: { id: claim.proverWalletId } });
  const proverDeposit = await tx.bondDeposit.findFirst({
    where: { claimRecordId: claim.id, kind: "PROVER" },
  });
  if (proverDeposit === null || amount !== BigInt(proverDeposit.amountWei.toFixed(0))) {
    throw new Error("ClaimFinalized amount does not match the locked prover bond.");
  }
  const beneficiary = await ensureWallet(tx, config.chainId, prover.address);
  await postJournal(
    tx,
    config,
    event,
    planLiabilityTransfer(
      [
        {
          accountCode: proverLockedCode(config.chainId, config.contractAddress, claimId),
          accountName: `Claim ${claimId} prover bond locked`,
          amountWei: amount,
        },
      ],
      walletCreditCode(config.chainId, config.contractAddress, prover.address),
      `${prover.address} withdrawable ETH liability`,
      amount,
    ),
  );
  await tx.settlement.upsert({
    where: { eventId: event.id },
    create: {
      chainId: config.chainId,
      contractAddress: config.contractAddress.toLowerCase(),
      claimRecordId: claim.id,
      beneficiaryWalletId: beneficiary.id,
      kind: "CLAIM_FINALIZATION",
      amountWei: amount.toString(),
      eventId: event.id,
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash,
    },
    update: { beneficiaryWalletId: beneficiary.id, amountWei: amount.toString() },
  });
  await tx.bondAllocation.upsert({
    where: {
      eventId_allocationType: { eventId: event.id, allocationType: "PROVER_BOND_TO_CREDIT" },
    },
    create: {
      chainId: config.chainId,
      contractAddress: config.contractAddress.toLowerCase(),
      claimRecordId: claim.id,
      allocationType: "PROVER_BOND_TO_CREDIT",
      amountWei: amount.toString(),
      eventId: event.id,
    },
    update: { amountWei: amount.toString() },
  });
  await tx.bondDeposit.updateMany({
    where: { claimRecordId: claim.id, kind: "PROVER" },
    data: { status: "RELEASED" },
  });
  await tx.claim.update({ where: { id: claim.id }, data: { status: "FINALIZED" } });
}

async function projectWithdrawal(
  tx: Prisma.TransactionClient,
  config: IndexerConfig,
  event: StoredEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  const address = requireAddress(payload["account"], "withdrawal account").toLowerCase();
  const wallet = await ensureWallet(tx, config.chainId, address);
  const amount = requireEventWei(payload, "amountWei");
  await postJournal(
    tx,
    config,
    event,
    planWithdrawal(
      walletCreditCode(config.chainId, config.contractAddress, address),
      address,
      contractCustodyCode(config.chainId, config.contractAddress),
      amount,
    ),
  );
  await tx.withdrawal.upsert({
    where: { eventId: event.id },
    create: {
      chainId: config.chainId,
      contractAddress: config.contractAddress.toLowerCase(),
      walletId: wallet.id,
      amountWei: amount.toString(),
      eventId: event.id,
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash,
    },
    update: { walletId: wallet.id, amountWei: amount.toString() },
  });
}

async function applyReadModelEvent(config: IndexerConfig, event: StoredEvent): Promise<void> {
  const payload = requireRecord(event.payload, event.eventName);
  await prisma.$transaction(async (tx) => {
    switch (event.eventName) {
      case "ClaimSubmitted":
        await projectClaimSubmitted(tx, config, event, payload);
        return;
      case "ChallengeStarted":
        await projectChallengeStarted(tx, config, event, payload);
        return;
      case "GameBondCredited":
        await projectGameBondCredited(tx, config, event, payload);
        return;
      case "GameResolved": {
        const claimId = parseWei(payload["claimId"], "claimId").toString();
        const claim = await tx.claim.findUnique({
          where: {
            chainId_contractAddress_claimId: {
              chainId: config.chainId,
              contractAddress: config.contractAddress.toLowerCase(),
              claimId,
            },
          },
        });
        if (claim === null) throw new Error(`GameResolved references unknown claim ${claimId}.`);
        const statusCode = requireInteger(payload["claimStatus"], "claimStatus");
        const status =
          (["UNKNOWN", "OPEN", "GAME_ACTIVE", "FINALIZED", "REFUTED"] as const)[statusCode] ??
          "UNKNOWN";
        await tx.claim.update({ where: { id: claim.id }, data: { status } });
        const gameNumber = parseWei(payload["gameNumber"], "gameNumber").toString();
        const outcome = requireInteger(payload["outcome"], "outcome");
        await tx.dispute.update({
          where: {
            chainId_contractAddress_claimId_gameNumber: {
              chainId: config.chainId,
              contractAddress: config.contractAddress.toLowerCase(),
              claimId,
              gameNumber,
            },
          },
          data: {
            phase: "CLOSED",
            differentIndex: requireInteger(payload["differentIndex"], "differentIndex"),
            outcome,
            status: outcome === 1 || outcome === 2 ? "PROVER_WON" : "CHALLENGER_WON",
          },
        });
        return;
      }
      case "ClaimFinalized":
        await projectClaimFinalized(tx, config, event, payload);
        return;
      case "Withdrawal":
        await projectWithdrawal(tx, config, event, payload);
        return;
      case "DisputeChildrenRevealed":
      case "TerminalEvidenceRevealed": {
        const claimId = parseWei(payload["claimId"], "claimId").toString();
        const gameNumber = parseWei(payload["gameNumber"], "gameNumber").toString();
        await tx.dispute.update({
          where: {
            chainId_contractAddress_claimId_gameNumber: {
              chainId: config.chainId,
              contractAddress: config.contractAddress.toLowerCase(),
              claimId,
              gameNumber,
            },
          },
          data: {
            ...(event.eventName === "TerminalEvidenceRevealed"
              ? {
                  phase: "TERMINAL" as const,
                  differentIndex: requireInteger(payload["differentIndex"], "differentIndex"),
                }
              : {}),
            expectedResponder: requireAddress(
              payload["nextResponder"],
              "nextResponder",
            ).toLowerCase(),
            deadlineBlock: parseWei(payload["nextDeadlineBlock"], "nextDeadlineBlock"),
          },
        });
        return;
      }
      case "BisectionLevelResolved": {
        const claimId = parseWei(payload["claimId"], "claimId").toString();
        const gameNumber = parseWei(payload["gameNumber"], "gameNumber").toString();
        const subtreeHeight = requireInteger(payload["subtreeHeight"], "subtreeHeight");
        await tx.dispute.update({
          where: {
            chainId_contractAddress_claimId_gameNumber: {
              chainId: config.chainId,
              contractAddress: config.contractAddress.toLowerCase(),
              claimId,
              gameNumber,
            },
          },
          data: {
            phase: subtreeHeight === 0 ? "TERMINAL" : "BISECTION",
            differentIndex:
              subtreeHeight === 0
                ? requireInteger(payload["differentIndex"], "differentIndex")
                : null,
            expectedResponder: requireAddress(
              payload["expectedResponder"],
              "expectedResponder",
            ).toLowerCase(),
            deadlineBlock: parseWei(payload["deadlineBlock"], "deadlineBlock"),
          },
        });
        return;
      }
      case "GameTimedOut": {
        const claimId = parseWei(payload["claimId"], "claimId").toString();
        const gameNumber = parseWei(payload["gameNumber"], "gameNumber").toString();
        const outcome = requireInteger(payload["outcome"], "outcome");
        await tx.dispute.update({
          where: {
            chainId_contractAddress_claimId_gameNumber: {
              chainId: config.chainId,
              contractAddress: config.contractAddress.toLowerCase(),
              claimId,
              gameNumber,
            },
          },
          data: {
            outcome,
            phase: "CLOSED",
            status: outcome === 1 || outcome === 2 ? "PROVER_WON" : "CHALLENGER_WON",
          },
        });
        return;
      }
      default:
        throw new Error(
          `Unsupported registry event ${event.eventName}; indexer refuses silent omission.`,
        );
    }
  });
}

async function rollbackToAncestor(
  config: IndexerConfig,
  checkpoint: {
    readonly lastBlockNumber: bigint;
    readonly lastBlockHash: string;
    readonly confirmedBlock: bigint;
  },
  ancestor: { readonly number: bigint; readonly hash: string } | null,
): Promise<void> {
  const ancestorNumber = ancestor?.number ?? config.deploymentBlock - 1n;
  const ancestorHash = ancestor?.hash ?? `0x${"00".repeat(32)}`;
  await prisma.$transaction(async (tx) => {
    const orphanedEvents = await tx.chainEvent.findMany({
      where: {
        chainId: config.chainId,
        contractAddress: config.contractAddress.toLowerCase(),
        blockNumber: { gt: ancestorNumber },
        status: { not: "ORPHANED" },
      },
      orderBy: [{ blockNumber: "asc" }, { logIndex: "asc" }],
    });
    for (const event of orphanedEvents) {
      const original = await tx.journalTransaction.findUnique({
        where: { eventId: event.id },
        include: { postings: { include: { account: true } } },
      });
      if (original === null) continue;
      const { tail, reversalDepth } = await journalTail(tx, original);
      if (reversalDepth % 2 === 0) {
        await createInverseJournal(tx, config, event, tail, ancestorNumber, ancestorHash);
      }
    }
    await tx.chainEvent.updateMany({
      where: {
        chainId: config.chainId,
        contractAddress: config.contractAddress.toLowerCase(),
        blockNumber: { gt: ancestorNumber },
      },
      data: { status: "ORPHANED" },
    });
    await tx.chainBlock.updateMany({
      where: {
        chainId: config.chainId,
        blockNumber: { gt: ancestorNumber },
        status: { not: "ORPHANED" },
      },
      data: { status: "ORPHANED" },
    });
    await tx.withdrawal.deleteMany({
      where: { chainId: config.chainId, contractAddress: config.contractAddress.toLowerCase() },
    });
    await tx.settlement.deleteMany({
      where: { chainId: config.chainId, contractAddress: config.contractAddress.toLowerCase() },
    });
    await tx.bondAllocation.deleteMany({
      where: { chainId: config.chainId, contractAddress: config.contractAddress.toLowerCase() },
    });
    await tx.bondDeposit.deleteMany({
      where: { chainId: config.chainId, contractAddress: config.contractAddress.toLowerCase() },
    });
    await tx.dispute.deleteMany({
      where: { chainId: config.chainId, contractAddress: config.contractAddress.toLowerCase() },
    });
    await tx.claim.deleteMany({
      where: { chainId: config.chainId, contractAddress: config.contractAddress.toLowerCase() },
    });
    await tx.indexerCheckpoint.update({
      where: {
        chainId_contractAddress: {
          chainId: config.chainId,
          contractAddress: config.contractAddress.toLowerCase(),
        },
      },
      data: {
        lastBlockNumber: ancestorNumber,
        lastBlockHash: ancestorHash,
        confirmedBlock: minBigInt(checkpoint.confirmedBlock, ancestorNumber),
      },
    });
  });
  const resetCheckpoint = await prisma.indexerCheckpoint.findUniqueOrThrow({
    where: {
      chainId_contractAddress: {
        chainId: config.chainId,
        contractAddress: config.contractAddress.toLowerCase(),
      },
    },
  });
  const canonicalEvents = await prisma.chainEvent.findMany({
    where: {
      chainId: config.chainId,
      contractAddress: config.contractAddress.toLowerCase(),
      status: "CONFIRMED",
      blockNumber: { lte: resetCheckpoint.confirmedBlock },
    },
    orderBy: [{ blockNumber: "asc" }, { transactionIndex: "asc" }, { logIndex: "asc" }],
  });
  for (const event of canonicalEvents) await applyReadModelEvent(config, event);
}

async function verifyAndRepairReorg(
  client: PublicClient,
  config: IndexerConfig,
  checkpoint: Awaited<ReturnType<typeof getCheckpoint>>,
): Promise<bigint | null> {
  if (checkpoint.lastBlockNumber < config.deploymentBlock) return null;
  let headBlock: Awaited<ReturnType<typeof client.getBlock>> | null;
  try {
    headBlock = await client.getBlock({ blockNumber: checkpoint.lastBlockNumber });
  } catch {
    headBlock = null;
  }
  if (
    headBlock !== null &&
    headBlock.hash !== null &&
    headBlock.hash.toLowerCase() === checkpoint.lastBlockHash.toLowerCase()
  ) {
    return null;
  }
  const minimumBound = checkpoint.lastBlockNumber - config.maxReorgDepth;
  const lowerBound = maxBigInt(minimumBound, config.deploymentBlock);
  let ancestor: { number: bigint; hash: string } | null = null;
  for (let number = checkpoint.lastBlockNumber; number >= lowerBound; number -= 1n) {
    let canonical: Awaited<ReturnType<typeof client.getBlock>> | null;
    try {
      canonical = await client.getBlock({ blockNumber: number });
    } catch {
      canonical = null;
    }
    if (canonical === null || canonical.hash === null) continue;
    const stored = await prisma.chainBlock.findFirst({
      where: {
        chainId: config.chainId,
        blockNumber: number,
        hash: canonical.hash,
        status: { not: "ORPHANED" },
      },
      select: { id: true },
    });
    if (stored !== null) {
      ancestor = { number, hash: canonical.hash };
      break;
    }
  }
  if (ancestor === null && lowerBound === config.deploymentBlock) {
    ancestor = { number: config.deploymentBlock - 1n, hash: `0x${"00".repeat(32)}` };
  }
  if (ancestor === null) {
    throw new Error(
      `Detected a chain reorganization deeper than INDEXER_MAX_REORG_DEPTH=${config.maxReorgDepth}. Indexing halted for operator review.`,
    );
  }
  await rollbackToAncestor(config, checkpoint, ancestor);
  return ancestor.number;
}

async function confirmThrough(
  config: IndexerConfig,
  targetBlock: bigint,
): Promise<{ readonly confirmed: number; readonly lastConfirmedBlock: bigint }> {
  const checkpoint = await prisma.indexerCheckpoint.findUniqueOrThrow({
    where: {
      chainId_contractAddress: {
        chainId: config.chainId,
        contractAddress: config.contractAddress.toLowerCase(),
      },
    },
  });
  const fromBlock = checkpoint.confirmedBlock + 1n;
  if (targetBlock < fromBlock)
    return { confirmed: 0, lastConfirmedBlock: checkpoint.confirmedBlock };
  await prisma.$transaction(async (tx) => {
    await tx.chainBlock.updateMany({
      where: {
        chainId: config.chainId,
        blockNumber: { gte: fromBlock, lte: targetBlock },
        status: "OBSERVED",
      },
      data: { status: "CONFIRMED" },
    });
    await tx.chainEvent.updateMany({
      where: {
        chainId: config.chainId,
        contractAddress: config.contractAddress.toLowerCase(),
        blockNumber: { gte: fromBlock, lte: targetBlock },
        status: "OBSERVED",
      },
      data: { status: "CONFIRMED" },
    });
  });
  const events = await prisma.chainEvent.findMany({
    where: {
      chainId: config.chainId,
      contractAddress: config.contractAddress.toLowerCase(),
      status: "CONFIRMED",
      blockNumber: { gte: fromBlock, lte: targetBlock },
    },
    orderBy: [{ blockNumber: "asc" }, { transactionIndex: "asc" }, { logIndex: "asc" }],
  });
  for (const event of events) await applyReadModelEvent(config, event);
  await prisma.indexerCheckpoint.update({
    where: {
      chainId_contractAddress: {
        chainId: config.chainId,
        contractAddress: config.contractAddress.toLowerCase(),
      },
    },
    data: { confirmedBlock: targetBlock },
  });
  return { confirmed: events.length, lastConfirmedBlock: targetBlock };
}

export async function runIndexerOnce(config: IndexerConfig): Promise<IndexerRunResult> {
  const client = clientFor(config);
  const connectedChainId = await client.getChainId();
  if (connectedChainId !== config.chainId) {
    throw new Error(
      `Configured chain ID ${config.chainId} does not match RPC chain ID ${connectedChainId}.`,
    );
  }
  let checkpoint = await getCheckpoint(client, config);
  const reorgAncestor = await verifyAndRepairReorg(client, config, checkpoint);
  checkpoint = await prisma.indexerCheckpoint.findUniqueOrThrow({
    where: {
      chainId_contractAddress: {
        chainId: config.chainId,
        contractAddress: config.contractAddress.toLowerCase(),
      },
    },
  });
  const latest = await client.getBlockNumber();
  let scanFrom: bigint | null = null;
  let scanTo: bigint | null = null;
  while (checkpoint.lastBlockNumber < latest) {
    const fromBlock = checkpoint.lastBlockNumber + 1n;
    const end = fromBlock + config.scanRange - 1n;
    const toBlock = minBigInt(end, latest);
    const expectedParentHash = checkpoint.lastBlockNumber >= 0n ? checkpoint.lastBlockHash : null;
    await scanChunk(client, config, fromBlock, toBlock, expectedParentHash);
    scanFrom ??= fromBlock;
    scanTo = toBlock;
    checkpoint = await prisma.indexerCheckpoint.findUniqueOrThrow({
      where: {
        chainId_contractAddress: {
          chainId: config.chainId,
          contractAddress: config.contractAddress.toLowerCase(),
        },
      },
    });
  }
  const safeBlock =
    latest >= config.confirmations ? latest - config.confirmations : config.deploymentBlock - 1n;
  const targetBlock = minBigInt(safeBlock, checkpoint.lastBlockNumber);
  const confirmationResult = await confirmThrough(config, targetBlock);
  const observedCount = await prisma.chainEvent.count({
    where: {
      chainId: config.chainId,
      contractAddress: config.contractAddress.toLowerCase(),
      status: "OBSERVED",
    },
  });
  return {
    chainId: config.chainId,
    scannedFromBlock: scanFrom === null ? null : toBlockJson(scanFrom),
    scannedToBlock: scanTo === null ? null : toBlockJson(scanTo),
    confirmedThroughBlock: toBlockJson(confirmationResult.lastConfirmedBlock),
    observedEvents: observedCount,
    newlyConfirmedEvents: confirmationResult.confirmed,
    reorgAncestor: reorgAncestor === null ? null : toBlockJson(reorgAncestor),
  };
}

export async function runIndexerLoop(config: IndexerConfig, signal?: AbortSignal): Promise<void> {
  while (!signal?.aborted) {
    try {
      const result = await runIndexerOnce(config);
      console.info(JSON.stringify({ service: "bisect-indexer", status: "ok", ...result }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown indexer error.";
      console.error(JSON.stringify({ service: "bisect-indexer", status: "error", message }));
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, config.pollIntervalMs);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }
}

export async function getCanonicalClient(config: IndexerConfig): Promise<PublicClient> {
  return clientFor(config);
}

export async function indexerLag(
  config: IndexerConfig,
): Promise<{ latestBlock: string; confirmedBlock: string; lagBlocks: string }> {
  const client = clientFor(config);
  const [latestBlock, checkpoint] = await Promise.all([
    client.getBlockNumber(),
    prisma.indexerCheckpoint.findUnique({
      where: {
        chainId_contractAddress: {
          chainId: config.chainId,
          contractAddress: config.contractAddress.toLowerCase(),
        },
      },
    }),
  ]);
  const confirmedBlock = checkpoint?.confirmedBlock ?? config.deploymentBlock - 1n;
  return {
    latestBlock: latestBlock.toString(),
    confirmedBlock: confirmedBlock.toString(),
    lagBlocks: (latestBlock > confirmedBlock ? latestBlock - confirmedBlock : 0n).toString(),
  };
}
