import { getAddress, isAddress } from "viem";

export const dynamic = "force-dynamic";

type DataRow = Record<string, unknown>;

function record(value: unknown): DataRow {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Indexer returned malformed data.");
  return value as DataRow;
}

function amount(value: unknown): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,77})$/.test(value))
    throw new Error("Indexer returned an invalid wei amount.");
  return BigInt(value);
}

function indexerBase(): URL {
  const value = process.env["BISECT_INDEXER_API_URL"];
  if (!value) throw new Error("The confirmed event indexer is not configured.");
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Invalid indexer URL.");
  if (url.protocol === "http:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname))
    throw new Error("Remote indexer URL must use HTTPS.");
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  return url;
}

async function readIndexer(base: URL, path: string): Promise<unknown | null> {
  const response = await fetch(new URL(path.replace(/^\//, ""), base), {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
    headers: { accept: "application/json" },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Indexer request failed (${response.status}).`);
  return (await response.json()) as unknown;
}

async function allRows(base: URL, path: string, address: string): Promise<DataRow[]> {
  const rows: DataRow[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 100; page++) {
    const query = new URLSearchParams({ address, limit: "100" });
    if (cursor) query.set("cursor", cursor);
    const body = record(await readIndexer(base, `${path}?${query}`));
    if (!Array.isArray(body["data"])) throw new Error("Indexer page is malformed.");
    rows.push(...body["data"].map(record));
    if (body["nextCursor"] === null) return rows;
    if (typeof body["nextCursor"] !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(body["nextCursor"]))
      throw new Error("Indexer cursor is malformed.");
    cursor = body["nextCursor"];
  }
  throw new Error(
    "Account history exceeds the bounded ledger view; use the indexer API for an export.",
  );
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const suppliedAddress = url.searchParams.get("address");
  if (!suppliedAddress || !isAddress(suppliedAddress))
    return Response.json({ error: "A valid wallet address is required." }, { status: 400 });
  const cursor = url.searchParams.get("cursor");
  if (cursor !== null && !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(cursor))
    return Response.json({ error: "Invalid activity cursor." }, { status: 400 });
  if ([...url.searchParams.keys()].some((key) => !["address", "cursor"].includes(key)))
    return Response.json({ error: "Unsupported query parameter." }, { status: 400 });
  try {
    const address = getAddress(suppliedAddress);
    const base = indexerBase();
    const activityQuery = new URLSearchParams({ limit: "20" });
    if (cursor) activityQuery.set("cursor", cursor);
    const [statusValue, accountValue, activityValue, deposits, settlements, withdrawals] =
      await Promise.all([
        readIndexer(base, "v1/overview"),
        readIndexer(base, `v1/accounts/${address}/overview`),
        readIndexer(base, `v1/wallets/${address}/activity?${activityQuery}`),
        allRows(base, "v1/deposits", address),
        allRows(base, "v1/settlements", address),
        allRows(base, "v1/withdrawals", address),
      ]);
    const status = record(statusValue);
    const expectedChain = process.env["NEXT_PUBLIC_BISECT_CHAIN_ID"] === "31337" ? 31337 : 84532;
    if (status["chainId"] !== expectedChain)
      throw new Error("Indexer chain does not match the wallet network.");
    const expectedRegistry = process.env["NEXT_PUBLIC_BISECT_REGISTRY_ADDRESS"];
    if (
      expectedRegistry &&
      (!isAddress(expectedRegistry) ||
        String(status["contractAddress"]).toLowerCase() !== expectedRegistry.toLowerCase())
    )
      throw new Error("Indexer contract does not match the configured registry.");
    const account = accountValue === null ? null : record(accountValue);
    const activity = record(activityValue);
    if (
      !Array.isArray(activity["data"]) ||
      !(activity["nextCursor"] === null || typeof activity["nextCursor"] === "string")
    )
      throw new Error("Indexer activity page is malformed.");
    let proverLocked = 0n;
    let challengerLocked = 0n;
    let deposited = 0n;
    let penalties = 0n;
    for (const deposit of deposits) {
      const wei = amount(deposit["amountWei"]);
      deposited += wei;
      if (deposit["status"] === "SLASHED") penalties += wei;
      if (deposit["status"] === "LOCKED") {
        if (deposit["kind"] === "PROVER") proverLocked += wei;
        else if (deposit["kind"] === "CHALLENGER") challengerLocked += wei;
        else throw new Error("Indexer bond kind is invalid.");
      }
    }
    if (account && amount(account["lockedWei"]) !== proverLocked + challengerLocked)
      throw new Error("Indexer locked bond totals do not reconcile.");
    let rewards = 0n;
    for (const settlement of settlements) {
      if (settlement["kind"] !== "GAME_CREDIT") continue;
      const wei = amount(settlement["amountWei"]);
      const matchingOwnChallengerBond = deposits.find(
        (deposit) =>
          deposit["kind"] === "CHALLENGER" &&
          record(deposit["claim"])["claimId"] === record(settlement["claim"])["claimId"] &&
          String(record(deposit["dispute"])["gameNumber"]) ===
            String(record(settlement["dispute"])["gameNumber"]),
      );
      const principal = matchingOwnChallengerBond
        ? amount(matchingOwnChallengerBond["amountWei"])
        : 0n;
      if (wei < principal)
        throw new Error("Indexer settlement is smaller than returned bond principal.");
      rewards += wei - principal;
    }
    const withdrawn = withdrawals.reduce((sum, row) => sum + amount(row["amountWei"]), 0n);
    const indexer = record(status["indexer"]);
    return Response.json(
      {
        chainId: expectedChain,
        contractAddress: status["contractAddress"],
        address,
        totals: {
          proverLockedWei: proverLocked.toString(),
          challengerLockedWei: challengerLocked.toString(),
          depositedWei: deposited.toString(),
          withdrawnWei: withdrawn.toString(),
          rewardWei: rewards.toString(),
          penaltyWei: penalties.toString(),
          netRealizedWei: (rewards - penalties).toString(),
          indexedCreditWei: account?.["withdrawableWei"] ?? null,
        },
        activity: activity["data"],
        nextCursor: activity["nextCursor"],
        freshness: {
          lag: record(indexer["lag"])["lagBlocks"],
          checkpoint:
            indexer["checkpoint"] === null ? null : record(indexer["checkpoint"])["updatedAt"],
        },
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Indexer unavailable." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
