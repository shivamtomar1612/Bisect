import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { getAddress, isAddress } from "viem";
import type { IndexerConfig } from "./config.js";
import { prisma } from "./database.js";
import { Prisma } from "./generated/prisma/client.js";
import { indexerLag } from "./indexer.js";

const maximumLimit = 100;
const cursorPattern = /^[A-Za-z0-9_-]{1,64}$/;

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
  assertKnownQuery(url, ["limit", "cursor", "address"]);
  const address = url.searchParams.get("address");
  const normalized = address === null ? undefined : parseAddress(address);
  const where = {
    chainId: config.chainId,
    contractAddress: config.contractAddress.toLowerCase(),
    ...(normalized === undefined ? {} : { prover: { address: normalized } }),
  };
  const rows = await prisma.claim.findMany({
    where,
    orderBy: [{ submittedBlock: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
    include: { prover: { select: { address: true } } },
  });
  return nextPage(rows, limit);
}

async function listDisputes(config: IndexerConfig, url: URL, limit: number, cursor?: string) {
  assertKnownQuery(url, ["limit", "cursor", "address", "status"]);
  const address = url.searchParams.get("address");
  const normalized = address === null ? undefined : parseAddress(address);
  const status = url.searchParams.get("status");
  if (status !== null && !["ACTIVE", "PROVER_WON", "CHALLENGER_WON", "UNKNOWN"].includes(status)) {
    throw new Error("status is not a recognized dispute state.");
  }
  const rows = await prisma.dispute.findMany({
    where: {
      chainId: config.chainId,
      contractAddress: config.contractAddress.toLowerCase(),
      ...(normalized === undefined ? {} : { challenger: { address: normalized } }),
      ...(status === null
        ? {}
        : { status: status as "ACTIVE" | "PROVER_WON" | "CHALLENGER_WON" | "UNKNOWN" }),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
    include: {
      challenger: { select: { address: true } },
      claim: { select: { claimId: true, traceRoot: true, status: true } },
    },
  });
  return nextPage(rows, limit);
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
  if (path === "/v1/claims") {
    respond(response, 200, await listClaims(config, url, limit, cursor));
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
      const status = /address|cursor|limit|query parameter|status is|malformed/i.test(message)
        ? 400
        : 500;
      respond(response, status, {
        error: status === 400 ? "invalid_request" : "internal_error",
        message: status === 400 ? message : undefined,
      });
    });
  });
}
