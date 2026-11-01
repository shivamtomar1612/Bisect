import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { getAddress, isAddress } from "viem";
import type { IndexerConfig } from "./config.js";
import { prisma } from "./database.js";
import { Prisma } from "./generated/prisma/client.js";
import { indexerLag } from "./indexer.js";

const maximumLimit = 100;
const cursorPattern = /^[A-Za-z0-9_-]{1,64}$/;
const decimalSearchPattern = /^[0-9]{1,78}$/;

function toJsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Prisma.Decimal) return value.toFixed(0);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toJsonSafe(item)]));
  }
  return value;
}

function respond(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(toJsonSafe(value));
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

function parseLimit(url: URL): number {
  const raw = url.searchParams.get("limit");
  if (raw === null) return 50;
  if (!/^(0|[1-9][0-9]*)$/.test(raw)) throw new Error("limit must be a positive integer.");
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximumLimit) {
    throw new Error(`limit must be between 1 and ${maximumLimit}.`);
  }
  return value;
}

function parseCursor(url: URL): string | undefined {
  const cursor = url.searchParams.get("cursor") ?? undefined;
  if (cursor !== undefined && !cursorPattern.test(cursor)) throw new Error("cursor is malformed.");
  return cursor;
}

function parseSearch(url: URL): string | undefined {
  const search = url.searchParams.get("q")?.trim();
  if (search === undefined || search === "") return undefined;
  const containsControlCharacter = [...search].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
  if (search.length > 100 || containsControlCharacter) {
    throw new Error("q must be at most 100 printable characters.");
  }
  return search;
}

const claimStatuses = ["OPEN", "GAME_ACTIVE", "FINALIZED", "REFUTED", "UNKNOWN"] as const;
const disputeStatuses = ["ACTIVE", "PROVER_WON", "CHALLENGER_WON", "UNKNOWN"] as const;

function parseClaimStatus(url: URL) {
  const status = url.searchParams.get("status");
  if (status === null) return undefined;
  if (!claimStatuses.includes(status as (typeof claimStatuses)[number])) {
    throw new Error("status is not a recognized claim state.");
  }
  return status as (typeof claimStatuses)[number];
}

function pathIsWalletActivity(path: string): boolean {
  return /^\/v1\/wallets\/[^/]+\/activity$/.test(path);
}

function parseAddress(raw: string): `0x${string}` {
  if (!isAddress(raw)) throw new Error("address must be a valid EVM address.");
  return getAddress(raw).toLowerCase() as `0x${string}`;
}

function assertKnownQuery(url: URL, allowed: readonly string[]): void {
  for (const key of url.searchParams.keys()) {
    if (!allowed.includes(key)) throw new Error(`Unsupported query parameter: ${key}.`);
  }
}

function nextPage<T extends { readonly id: string | bigint }>(rows: readonly T[], limit: number) {
  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit);
  return { data, nextCursor: hasMore ? String(data.at(-1)?.id) : null };
}

async function listClaims(config: IndexerConfig, url: URL, limit: number, cursor?: string) {
  assertKnownQuery(url, ["limit", "cursor", "address", "status", "q"]);
  const address = url.searchParams.get("address");
  const normalized = address === null ? undefined : parseAddress(address);
  const search = parseSearch(url);
  const status = parseClaimStatus(url);
  const where = {
    chainId: config.chainId,
    contractAddress: config.contractAddress.toLowerCase(),
    ...(status === undefined ? {} : { status }),
    ...(normalized === undefined ? {} : { prover: { address: normalized } }),
    ...(search === undefined
      ? {}
      : {
          OR: [
            { contextHash: { contains: search, mode: "insensitive" as const } },
            { traceRoot: { contains: search, mode: "insensitive" as const } },
            { prover: { address: { contains: search, mode: "insensitive" as const } } },
            ...(decimalSearchPattern.test(search) ? [{ claimId: new Prisma.Decimal(search) }] : []),
          ],
        }),
  };
  const rows = await prisma.claim.findMany({
    where,
    orderBy: [{ submittedBlock: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
    include: {
      prover: { select: { address: true } },
      deposits: {
        where: { kind: "PROVER" },
        select: { amountWei: true, status: true },
      },
      disputes: { select: { gameNumber: true, status: true, bisectionRounds: true } },
    },
  });
  const events = await prisma.chainEvent.findMany({
    where: { id: { in: rows.map((row) => row.sourceEventId) }, status: "CONFIRMED" },
    select: { id: true, eventName: true, blockNumber: true, transactionHash: true, logIndex: true },
  });
  const eventById = new Map(events.map((event) => [event.id.toString(), event]));
  return nextPage(
    rows.map((row) => ({
      ...row,
      sourceEvent: eventById.get(row.sourceEventId.toString()) ?? null,
    })),
    limit,
  );
}

async function listDisputes(config: IndexerConfig, url: URL, limit: number, cursor?: string) {
  assertKnownQuery(url, ["limit", "cursor", "address", "status", "q"]);
  const address = url.searchParams.get("address");
  const normalized = address === null ? undefined : parseAddress(address);
  const status = url.searchParams.get("status");
  if (status !== null && !disputeStatuses.includes(status as (typeof disputeStatuses)[number])) {
    throw new Error("status is not a recognized dispute state.");
  }
  const search = parseSearch(url);
  const rows = await prisma.dispute.findMany({
    where: {
      chainId: config.chainId,
      contractAddress: config.contractAddress.toLowerCase(),
      ...(normalized === undefined ? {} : { challenger: { address: normalized } }),
      ...(status === null ? {} : { status: status as (typeof disputeStatuses)[number] }),
      ...(search === undefined
        ? {}
        : {
            OR: [
              { challengerRoot: { contains: search, mode: "insensitive" as const } },
              { challenger: { address: { contains: search, mode: "insensitive" as const } } },
              ...(decimalSearchPattern.test(search)
                ? [
                    { claimId: new Prisma.Decimal(search) },
                    { gameNumber: new Prisma.Decimal(search) },
                  ]
                : []),
            ],
          }),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
    include: {
      challenger: { select: { address: true } },
      claim: {
        select: {
          claimId: true,
          traceRoot: true,
          status: true,
          prover: { select: { address: true } },
        },
      },
      deposits: { where: { kind: "CHALLENGER" }, select: { amountWei: true, status: true } },
      settlements: {
        select: {
          kind: true,
          outcome: true,
          amountWei: true,
          blockNumber: true,
          transactionHash: true,
          beneficiary: { select: { address: true } },
        },
      },
    },
  });
  const events = await prisma.chainEvent.findMany({
    where: { id: { in: rows.map((row) => row.sourceEventId) }, status: "CONFIRMED" },
    select: { id: true, eventName: true, blockNumber: true, transactionHash: true, logIndex: true },
  });
  const eventById = new Map(events.map((event) => [event.id.toString(), event]));
  return nextPage(
    rows.map((row) => ({
      ...row,
      sourceEvent: eventById.get(row.sourceEventId.toString()) ?? null,
    })),
    limit,
  );
}

async function disputeTimeline(config: IndexerConfig, rawClaimId: string, rawGameNumber: string) {
  if (!/^[1-9][0-9]{0,77}$/.test(rawClaimId) || BigInt(rawClaimId) > (1n << 256n) - 1n)
    throw new Error("claim ID must be a positive uint256 decimal.");
  if (!/^[1-9][0-9]{0,77}$/.test(rawGameNumber) || BigInt(rawGameNumber) > (1n << 256n) - 1n)
    throw new Error("game number must be a positive uint256 decimal.");
  const dispute = await prisma.dispute.findUnique({
    where: {
      chainId_contractAddress_claimId_gameNumber: {
        chainId: config.chainId,
        contractAddress: config.contractAddress.toLowerCase(),
        claimId: new Prisma.Decimal(rawClaimId),
        gameNumber: new Prisma.Decimal(rawGameNumber),
      },
    },
    include: {
      claim: {
        select: {
          traceRoot: true,
          transitionCount: true,
          prover: { select: { address: true } },
          deposits: { where: { kind: "PROVER" }, select: { amountWei: true, status: true } },
        },
      },
      challenger: { select: { address: true } },
      deposits: { where: { kind: "CHALLENGER" }, select: { amountWei: true, status: true } },
      settlements: {
        select: {
          amountWei: true,
          beneficiary: { select: { address: true } },
          transactionHash: true,
          blockNumber: true,
        },
      },
    },
  });
  if (dispute === null) return null;
  const events = await prisma.chainEvent.findMany({
    where: {
      chainId: config.chainId,
      contractAddress: config.contractAddress.toLowerCase(),
      status: "CONFIRMED",
      payload: { path: ["claimId"], equals: rawClaimId },
      AND: [{ payload: { path: ["gameNumber"], equals: rawGameNumber } }],
    },
    orderBy: [{ blockNumber: "asc" }, { transactionIndex: "asc" }, { logIndex: "asc" }],
    take: 65,
    select: {
      eventName: true,
      payload: true,
      blockNumber: true,
      blockHash: true,
      transactionHash: true,
      transactionIndex: true,
      logIndex: true,
    },
  });
  const lag = await indexerLag(config);
  return {
    chainId: config.chainId,
    contractAddress: config.contractAddress.toLowerCase(),
    claimId: rawClaimId,
    gameNumber: rawGameNumber,
    proverRoot: dispute.claim.traceRoot,
    challengerRoot: dispute.challengerRoot,
    transitionCount: dispute.claim.transitionCount,
    expectedRounds: dispute.bisectionRounds,
    status: dispute.status,
    outcome: dispute.outcome,
    prover: dispute.claim.prover.address,
    challenger: dispute.challenger.address,
    proverBond: dispute.claim.deposits[0] ?? null,
    challengerBond: dispute.deposits[0] ?? null,
    settlements: dispute.settlements,
    lag,
    truncated: events.length > 64,
    events: events.slice(0, 64),
  };
}

async function claimDetail(config: IndexerConfig, rawClaimId: string) {
  if (!/^(0|[1-9][0-9]{0,77})$/.test(rawClaimId))
    throw new Error("claim ID must be a uint256 decimal.");
  if (BigInt(rawClaimId) > (1n << 256n) - 1n) throw new Error("claim ID exceeds uint256.");
  const row = await prisma.claim.findUnique({
    where: {
      chainId_contractAddress_claimId: {
        chainId: config.chainId,
        contractAddress: config.contractAddress.toLowerCase(),
        claimId: new Prisma.Decimal(rawClaimId),
      },
    },
    include: {
      prover: { select: { address: true } },
      deposits: { where: { kind: "PROVER" }, select: { amountWei: true, status: true } },
      disputes: { select: { gameNumber: true, status: true, bisectionRounds: true } },
    },
  });
  if (row === null) return null;
  const sourceEvent = await prisma.chainEvent.findFirst({
    where: { id: row.sourceEventId, status: "CONFIRMED" },
    select: {
      eventName: true,
      blockNumber: true,
      transactionHash: true,
      logIndex: true,
      block: { select: { hash: true, timestamp: true } },
    },
  });
  return { ...row, sourceEvent };
}

async function overview(config: IndexerConfig) {
  const where = { chainId: config.chainId, contractAddress: config.contractAddress.toLowerCase() };
  const [
    totalClaims,
    activeDisputes,
    completedDisputes,
    verifiedResults,
    exposure,
    checkpoint,
    lag,
    recentActivity,
  ] = await Promise.all([
    prisma.claim.count({ where }),
    prisma.dispute.count({ where: { ...where, status: "ACTIVE" } }),
    prisma.dispute.count({ where: { ...where, status: { in: ["PROVER_WON", "CHALLENGER_WON"] } } }),
    prisma.claim.count({ where: { ...where, status: "FINALIZED" } }),
    prisma.bondDeposit.aggregate({
      where: { ...where, status: "LOCKED" },
      _sum: { amountWei: true },
    }),
    prisma.indexerCheckpoint.findUnique({
      where: {
        chainId_contractAddress: {
          chainId: config.chainId,
          contractAddress: config.contractAddress.toLowerCase(),
        },
      },
    }),
    indexerLag(config),
    prisma.chainEvent.findMany({
      where: { ...where, status: "CONFIRMED" },
      orderBy: [{ blockNumber: "desc" }, { transactionIndex: "desc" }, { logIndex: "desc" }],
      take: 8,
      select: {
        eventName: true,
        blockNumber: true,
        transactionHash: true,
        logIndex: true,
        block: { select: { timestamp: true } },
      },
    }),
  ]);
  return {
    chainId: config.chainId,
    contractAddress: config.contractAddress.toLowerCase(),
    confirmationDepth: config.confirmations,
    metrics: {
      totalClaims,
      activeDisputes,
      completedDisputes,
      verifiedResults,
      lockedExposureWei: exposure._sum.amountWei?.toFixed(0) ?? "0",
    },
    indexer: {
      deploymentBlock: config.deploymentBlock,
      checkpoint:
        checkpoint === null
          ? null
          : {
              lastBlockNumber: checkpoint.lastBlockNumber,
              confirmedBlock: checkpoint.confirmedBlock,
              updatedAt: checkpoint.updatedAt,
            },
      lag,
    },
    recentActivity,
  };
}

async function listDeposits(
  config: IndexerConfig,
  url: URL,
  limit: number,
  cursor?: string,
  status?: "LOCKED" | "SLASHED",
) {
  assertKnownQuery(url, ["limit", "cursor", "address"]);
  const address = url.searchParams.get("address");
  const normalized = address === null ? undefined : parseAddress(address);
  const rows = await prisma.bondDeposit.findMany({
    where: {
      chainId: config.chainId,
      contractAddress: config.contractAddress.toLowerCase(),
      ...(normalized === undefined ? {} : { wallet: { address: normalized } }),
      ...(status === undefined ? {} : { status }),
    },
    orderBy: [{ blockNumber: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
    include: {
      wallet: { select: { address: true } },
      claim: { select: { claimId: true, status: true } },
      dispute: { select: { gameNumber: true, status: true } },
    },
  });
  return nextPage(rows, limit);
}

async function listSettlements(config: IndexerConfig, url: URL, limit: number, cursor?: string) {
  assertKnownQuery(url, ["limit", "cursor", "address"]);
  const address = url.searchParams.get("address");
  const normalized = address === null ? undefined : parseAddress(address);
  const rows = await prisma.settlement.findMany({
    where: {
      chainId: config.chainId,
      contractAddress: config.contractAddress.toLowerCase(),
      ...(normalized === undefined ? {} : { beneficiary: { address: normalized } }),
    },
    orderBy: [{ blockNumber: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
    include: {
      beneficiary: { select: { address: true } },
      claim: { select: { claimId: true } },
      dispute: { select: { gameNumber: true } },
    },
  });
  return nextPage(rows, limit);
}

async function listWithdrawals(config: IndexerConfig, url: URL, limit: number, cursor?: string) {
  assertKnownQuery(url, ["limit", "cursor", "address"]);
  const address = url.searchParams.get("address");
  const normalized = address === null ? undefined : parseAddress(address);
  const rows = await prisma.withdrawal.findMany({
    where: {
      chainId: config.chainId,
      contractAddress: config.contractAddress.toLowerCase(),
      ...(normalized === undefined ? {} : { wallet: { address: normalized } }),
    },
    orderBy: [{ blockNumber: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
    include: { wallet: { select: { address: true } } },
  });
  return nextPage(rows, limit);
}

function activityCursor(
  raw: string | undefined,
): { blockNumber: bigint; eventId: bigint } | undefined {
  if (raw === undefined) return undefined;
  if (raw.length > 160) throw new Error("activity cursor is too long.");
  const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.exec(raw);
  if (match === null) throw new Error("activity cursor is malformed.");
  return { blockNumber: BigInt(match[1] ?? "0"), eventId: BigInt(match[2] ?? "0") };
}

async function walletActivity(config: IndexerConfig, address: string, url: URL, limit: number) {
  assertKnownQuery(url, ["limit", "cursor"]);
  const normalized = parseAddress(address);
  const cursor = activityCursor(url.searchParams.get("cursor") ?? undefined);
  const wallet = await prisma.walletAccount.findUnique({
    where: { chainId_address: { chainId: config.chainId, address: normalized } },
  });
  if (wallet === null) return { data: [], nextCursor: null };
  const beforeCursor =
    cursor === undefined
      ? {}
      : {
          OR: [
            { blockNumber: { lt: cursor.blockNumber } },
            { blockNumber: cursor.blockNumber, eventId: { lt: cursor.eventId } },
          ],
        };
  const [deposits, settlements, withdrawals] = await Promise.all([
    prisma.bondDeposit.findMany({
      where: { walletId: wallet.id, ...beforeCursor },
      orderBy: [{ blockNumber: "desc" }, { eventId: "desc" }],
      take: limit + 1,
      include: { claim: { select: { claimId: true } }, dispute: { select: { gameNumber: true } } },
    }),
    prisma.settlement.findMany({
      where: { beneficiaryWalletId: wallet.id, ...beforeCursor },
      orderBy: [{ blockNumber: "desc" }, { eventId: "desc" }],
      take: limit + 1,
      include: { claim: { select: { claimId: true } }, dispute: { select: { gameNumber: true } } },
    }),
    prisma.withdrawal.findMany({
      where: { walletId: wallet.id, ...beforeCursor },
      orderBy: [{ blockNumber: "desc" }, { eventId: "desc" }],
      take: limit + 1,
    }),
  ]);
  const entries = [
    ...deposits.map((item) => ({
      kind: "BOND_DEPOSIT",
      blockNumber: item.blockNumber,
      eventId: item.eventId,
      item,
    })),
    ...settlements.map((item) => ({
      kind: "SETTLEMENT",
      blockNumber: item.blockNumber,
      eventId: item.eventId,
      item,
    })),
    ...withdrawals.map((item) => ({
      kind: "WITHDRAWAL",
      blockNumber: item.blockNumber,
      eventId: item.eventId,
      item,
    })),
  ].sort((a, b) =>
    a.blockNumber === b.blockNumber
      ? a.eventId > b.eventId
        ? -1
        : 1
      : a.blockNumber > b.blockNumber
        ? -1
        : 1,
  );
  const data = entries.slice(0, limit);
  const last = data.at(-1);
  return {
    data,
    nextCursor:
      entries.length > limit && last !== undefined ? `${last.blockNumber}.${last.eventId}` : null,
  };
}

async function accountOverview(config: IndexerConfig, address: string) {
  const normalized = parseAddress(address);
  const wallet = await prisma.walletAccount.findUnique({
    where: { chainId_address: { chainId: config.chainId, address: normalized } },
  });
  if (wallet === null) return null;
  const [locked, creditAccount, latestReconciliation, checkpoint] = await Promise.all([
    prisma.bondDeposit.aggregate({
      where: {
        walletId: wallet.id,
        status: "LOCKED",
        chainId: config.chainId,
        contractAddress: config.contractAddress.toLowerCase(),
      },
      _sum: { amountWei: true },
    }),
    prisma.ledgerAccount.findUnique({
      where: {
        code: `evm:${config.chainId}:${config.contractAddress.toLowerCase()}:wallet:${normalized}:withdrawable`,
      },
      select: { id: true },
    }),
    prisma.reconciliationRun.findFirst({
      where: { chainId: config.chainId, contractAddress: config.contractAddress.toLowerCase() },
      orderBy: { id: "desc" },
    }),
    prisma.indexerCheckpoint.findUnique({
      where: {
        chainId_contractAddress: {
          chainId: config.chainId,
          contractAddress: config.contractAddress.toLowerCase(),
        },
      },
    }),
  ]);
  let withdrawableWei = 0n;
  if (creditAccount !== null && checkpoint !== null) {
    const rows = await prisma.$queryRaw<Array<{ balance: Prisma.Decimal }>>`
      SELECT COALESCE(SUM(
        CASE WHEN posting."side" = account."normalSide" THEN posting."amountWei" ELSE -posting."amountWei" END
      ), 0)::numeric AS balance
      FROM "JournalPosting" AS posting
      INNER JOIN "LedgerAccount" AS account ON account."id" = posting."accountId"
      INNER JOIN "JournalTransaction" AS journal ON journal."id" = posting."journalId"
      INNER JOIN "ChainEvent" AS event ON event."id" = journal."eventId" AND event."status" = 'CONFIRMED'::"ChainEventStatus"
      WHERE journal."chainId" = ${config.chainId}
        AND journal."contractAddress" = ${config.contractAddress.toLowerCase()}
        AND journal."blockNumber" <= ${checkpoint.confirmedBlock}
        AND posting."accountId" = ${creditAccount.id}
    `;
    withdrawableWei = BigInt(rows[0]?.balance.toFixed(0) ?? "0");
  }
  if (withdrawableWei < 0n)
    throw new Error("Indexed wallet credit is negative; reconciliation is required.");
  return {
    chainId: config.chainId,
    address: normalized,
    lockedWei: locked._sum.amountWei?.toFixed(0) ?? "0",
    withdrawableWei: withdrawableWei.toString(),
    latestReconciliation:
      latestReconciliation === null
        ? null
        : {
            status: latestReconciliation.status,
            blockNumber: latestReconciliation.blockNumber.toString(),
            blockHash: latestReconciliation.blockHash,
          },
  };
}

async function route(
  config: IndexerConfig,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method !== "GET") {
    response.setHeader("allow", "GET");
    respond(response, 405, { error: "method_not_allowed" });
    return;
  }
  const url = new URL(request.url ?? "/", "http://localhost");
  const path = url.pathname;
  const limit = parseLimit(url);
  const cursor = pathIsWalletActivity(url.pathname) ? undefined : parseCursor(url);
  if (path === "/healthz") {
    const [lag, database] = await Promise.all([indexerLag(config), prisma.$queryRaw`SELECT 1`]);
    respond(response, 200, {
      status: "ok",
      chainId: config.chainId,
      lag,
      database: Array.isArray(database),
    });
    return;
  }
  if (path === "/v1/indexer/status") {
    assertKnownQuery(url, []);
    const [checkpoint, observedEvents, confirmedEvents, orphanedEvents, lag] = await Promise.all([
      prisma.indexerCheckpoint.findUnique({
        where: {
          chainId_contractAddress: {
            chainId: config.chainId,
            contractAddress: config.contractAddress.toLowerCase(),
          },
        },
      }),
      prisma.chainEvent.count({
        where: {
          chainId: config.chainId,
          contractAddress: config.contractAddress.toLowerCase(),
          status: "OBSERVED",
        },
      }),
      prisma.chainEvent.count({
        where: {
          chainId: config.chainId,
          contractAddress: config.contractAddress.toLowerCase(),
          status: "CONFIRMED",
        },
      }),
      prisma.chainEvent.count({
        where: {
          chainId: config.chainId,
          contractAddress: config.contractAddress.toLowerCase(),
          status: "ORPHANED",
        },
      }),
      indexerLag(config),
    ]);
    respond(response, 200, {
      chainId: config.chainId,
      contractAddress: config.contractAddress.toLowerCase(),
      deploymentBlock: config.deploymentBlock,
      confirmationDepth: config.confirmations,
      observedEvents,
      confirmedEvents,
      orphanedEvents,
      checkpoint,
      lag,
    });
    return;
  }
  if (path === "/v1/overview") {
    assertKnownQuery(url, []);
    respond(response, 200, await overview(config));
    return;
  }
  const claimDetailMatch = /^\/v1\/claims\/([^/]+)$/.exec(path);
  if (claimDetailMatch !== null) {
    assertKnownQuery(url, []);
    const claim = await claimDetail(config, decodeURIComponent(claimDetailMatch[1] ?? ""));
    if (claim === null) {
      respond(response, 404, { error: "claim_not_found" });
      return;
    }
    respond(response, 200, claim);
    return;
  }
  if (path === "/v1/claims") {
    respond(response, 200, await listClaims(config, url, limit, cursor));
    return;
  }
  const timelineMatch = /^\/v1\/disputes\/([^/]+)\/([^/]+)\/timeline$/.exec(path);
  if (timelineMatch !== null) {
    assertKnownQuery(url, []);
    const timeline = await disputeTimeline(
      config,
      decodeURIComponent(timelineMatch[1] ?? ""),
      decodeURIComponent(timelineMatch[2] ?? ""),
    );
    if (timeline === null) respond(response, 404, { error: "dispute_not_found" });
    else respond(response, 200, timeline);
    return;
  }
  if (path === "/v1/disputes") {
    respond(response, 200, await listDisputes(config, url, limit, cursor));
    return;
  }
  if (path === "/v1/deposits") {
    respond(response, 200, await listDeposits(config, url, limit, cursor));
    return;
  }
  if (path === "/v1/locked-bonds") {
    respond(response, 200, await listDeposits(config, url, limit, cursor, "LOCKED"));
    return;
  }
  if (path === "/v1/penalties") {
    respond(response, 200, await listDeposits(config, url, limit, cursor, "SLASHED"));
    return;
  }
  if (path === "/v1/settlements" || path === "/v1/rewards") {
    respond(response, 200, await listSettlements(config, url, limit, cursor));
    return;
  }
  if (path === "/v1/withdrawals") {
    respond(response, 200, await listWithdrawals(config, url, limit, cursor));
    return;
  }
  if (path === "/v1/reconciliation") {
    assertKnownQuery(url, ["limit"]);
    const rows = await prisma.reconciliationRun.findMany({
      where: { chainId: config.chainId, contractAddress: config.contractAddress.toLowerCase() },
      orderBy: { id: "desc" },
      take: limit,
    });
    respond(response, 200, { data: rows, latest: rows[0] ?? null });
    return;
  }
  const accountMatch = /^\/v1\/accounts\/([^/]+)\/overview$/.exec(path);
  if (accountMatch !== null) {
    assertKnownQuery(url, []);
    const account = await accountOverview(config, decodeURIComponent(accountMatch[1] ?? ""));
    if (account === null) {
      respond(response, 404, { error: "wallet_not_indexed" });
      return;
    }
    respond(response, 200, account);
    return;
  }
  const activityMatch = /^\/v1\/wallets\/([^/]+)\/activity$/.exec(path);
  if (activityMatch !== null) {
    respond(
      response,
      200,
      await walletActivity(config, decodeURIComponent(activityMatch[1] ?? ""), url, limit),
    );
    return;
  }
  respond(response, 404, { error: "not_found" });
}

export function createIndexerApi(config: IndexerConfig): Server {
  return createServer((request, response) => {
    void route(config, request, response).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Request failed.";
      const status =
        /address|claim ID|cursor|limit|query parameter|search query|\bq\b|status is|malformed|uint256/i.test(
          message,
        )
          ? 400
          : 500;
      respond(response, status, {
        error: status === 400 ? "invalid_request" : "internal_error",
        message: status === 400 ? message : undefined,
      });
    });
  });
}
