export type ReadError = {
  readonly kind: "not-configured" | "unreachable" | "service" | "invalid-data";
  readonly status?: number;
};

export type ReadResult<T> =
  | { readonly kind: "ready"; readonly value: T }
  | ReadError
  | { readonly kind: "not-found" };

export type ReadFailure = Exclude<
  ReadResult<unknown>,
  { readonly kind: "ready" } | { readonly kind: "not-found" }
>;

export type ReadPage<T> = {
  readonly data: readonly T[];
  readonly nextCursor: string | null;
};

export type TransactionReference = {
  readonly eventName: string;
  readonly blockNumber: string;
  readonly transactionHash: string;
};

export type OverviewData = {
  readonly chainId: number;
  readonly contractAddress: string;
  readonly confirmationDepth: string;
  readonly metrics: {
    readonly totalClaims: number;
    readonly activeDisputes: number;
    readonly completedDisputes: number;
    readonly verifiedResults: number;
    readonly lockedExposureWei: string;
  };
  readonly indexer: {
    readonly deploymentBlock: string;
    readonly checkpoint: {
      readonly lastBlockNumber: string;
      readonly confirmedBlock: string;
      readonly updatedAt: string;
    } | null;
    readonly lag: {
      readonly latestBlock: string;
      readonly confirmedBlock: string;
      readonly lagBlocks: string;
    };
  };
  readonly recentActivity: readonly (TransactionReference & {
    readonly logIndex: number;
    readonly timestamp: string | null;
  })[];
};

export type ClaimRecord = {
  readonly id: string;
  readonly chainId: number;
  readonly contractAddress: string;
  readonly claimId: string;
  readonly proverAddress: string;
  readonly contextHash: string;
  readonly traceRoot: string;
  readonly transitionCount: number;
  readonly claimedOutput: string;
  readonly challengeDeadline: string;
  readonly submittedBlock: string;
  readonly status: "OPEN" | "GAME_ACTIVE" | "FINALIZED" | "REFUTED" | "UNKNOWN";
  readonly proverBonds: readonly { readonly amountWei: string; readonly status: string }[];
  readonly disputes: readonly {
    readonly gameNumber: string;
    readonly status: string;
    readonly bisectionRounds: number;
  }[];
  readonly sourceEvent: TransactionReference | null;
};

export type SettlementRecord = {
  readonly kind: string;
  readonly outcome: number | null;
  readonly amountWei: string;
  readonly blockNumber: string;
  readonly transactionHash: string;
  readonly beneficiaryAddress: string;
};

export type DisputeRecord = {
  readonly id: string;
  readonly chainId: number;
  readonly claimId: string;
  readonly gameNumber: string;
  readonly challengerAddress: string;
  readonly challengerRoot: string;
  readonly initialHeight: number;
  readonly bisectionRounds: number;
  readonly expectedResponder: string;
  readonly deadlineBlock: string;
  readonly phase: string;
  readonly status: "ACTIVE" | "PROVER_WON" | "CHALLENGER_WON" | "UNKNOWN";
  readonly outcome: number | null;
  readonly differentIndex: number | null;
  readonly proverAddress: string;
  readonly traceRoot: string;
  readonly claimStatus: string;
  readonly challengerBonds: readonly { readonly amountWei: string; readonly status: string }[];
  readonly settlements: readonly SettlementRecord[];
  readonly sourceEvent: TransactionReference | null;
};

type ApiResponse = { readonly kind: "response"; readonly body: unknown } | ReadError;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string.`);
  return value;
}

function decimal(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${label} must be an exact unsigned decimal string.`);
  }
  return value;
}

function integer(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

function readStatus<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`${label} is not recognized.`);
  }
  return value as T;
}

function apiBase(): URL | null {
  const configured = process.env["BISECT_INDEXER_API_URL"]?.trim();
  if (!configured) return null;
  const url = new URL(configured);
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(
      "The read API URL must be an HTTP(S) base URL without credentials or query data.",
    );
  }
  if (url.protocol === "http:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new Error("The read API must use HTTPS unless it is hosted locally.");
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  return url;
}

async function fetchApi(path: string): Promise<ApiResponse> {
  let base: URL | null;
  try {
    base = apiBase();
  } catch {
    return { kind: "invalid-data" };
  }
  if (base === null) return { kind: "not-configured" };
  try {
    const response = await fetch(new URL(path.replace(/^\/+/, ""), base), {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      return { kind: "service", status: response.status };
    }
    return { kind: "response", body: (await response.json()) as unknown };
  } catch {
    return { kind: "unreachable" };
  }
}

function parseTransactionReference(value: unknown, label: string): TransactionReference | null {
  if (value === null) return null;
  const source = record(value, label);
  return {
    eventName: text(source["eventName"], `${label}.eventName`),
    blockNumber: decimal(source["blockNumber"], `${label}.blockNumber`),
    transactionHash: text(source["transactionHash"], `${label}.transactionHash`),
  };
}

function parsePage<T>(body: unknown, parseRow: (value: unknown, label: string) => T): ReadPage<T> {
  const page = record(body, "page");
  if (!Array.isArray(page["data"]) || page["data"].length > 100) {
    throw new Error("page.data must be an array of at most 100 records.");
  }
  const nextCursor = page["nextCursor"];
  if (nextCursor !== null && typeof nextCursor !== "string") {
    throw new Error("page.nextCursor must be a string or null.");
  }
  return {
    data: page["data"].map((row, index) => parseRow(row, `page.data[${index}]`)),
    nextCursor,
  };
}

function parseBondList(value: unknown, label: string) {
  if (!Array.isArray(value) || value.length > 100) throw new Error(`${label} must be an array.`);
  return value.map((item, index) => {
    const bond = record(item, `${label}[${index}]`);
    return {
      amountWei: decimal(bond["amountWei"], `${label}[${index}].amountWei`),
      status: text(bond["status"], `${label}[${index}].status`),
    };
  });
}

function parseClaim(value: unknown, label: string): ClaimRecord {
  const claim = record(value, label);
  const prover = record(claim["prover"], `${label}.prover`);
  return {
    id: text(claim["id"], `${label}.id`),
    chainId: integer(claim["chainId"], `${label}.chainId`),
    contractAddress: text(claim["contractAddress"], `${label}.contractAddress`),
    claimId: decimal(claim["claimId"], `${label}.claimId`),
    proverAddress: text(prover["address"], `${label}.prover.address`),
    contextHash: text(claim["contextHash"], `${label}.contextHash`),
    traceRoot: text(claim["traceRoot"], `${label}.traceRoot`),
    transitionCount: integer(claim["transitionCount"], `${label}.transitionCount`),
    claimedOutput: decimal(claim["claimedOutput"], `${label}.claimedOutput`),
    challengeDeadline: decimal(claim["challengeDeadline"], `${label}.challengeDeadline`),
    submittedBlock: decimal(claim["submittedBlock"], `${label}.submittedBlock`),
    status: readStatus(
      claim["status"],
      ["OPEN", "GAME_ACTIVE", "FINALIZED", "REFUTED", "UNKNOWN"],
      `${label}.status`,
    ),
    proverBonds: parseBondList(claim["deposits"], `${label}.deposits`),
    disputes: Array.isArray(claim["disputes"])
      ? claim["disputes"].map((entry, index) => {
          const dispute = record(entry, `${label}.disputes[${index}]`);
          return {
            gameNumber: decimal(dispute["gameNumber"], `${label}.disputes[${index}].gameNumber`),
            status: text(dispute["status"], `${label}.disputes[${index}].status`),
            bisectionRounds: integer(
              dispute["bisectionRounds"],
              `${label}.disputes[${index}].bisectionRounds`,
            ),
          };
        })
      : [],
    sourceEvent: parseTransactionReference(claim["sourceEvent"], `${label}.sourceEvent`),
  };
}

function parseSettlement(value: unknown, label: string): SettlementRecord {
  const settlement = record(value, label);
  const beneficiary = record(settlement["beneficiary"], `${label}.beneficiary`);
  return {
    kind: text(settlement["kind"], `${label}.kind`),
    outcome:
      settlement["outcome"] === null ? null : integer(settlement["outcome"], `${label}.outcome`),
    amountWei: decimal(settlement["amountWei"], `${label}.amountWei`),
    blockNumber: decimal(settlement["blockNumber"], `${label}.blockNumber`),
    transactionHash: text(settlement["transactionHash"], `${label}.transactionHash`),
    beneficiaryAddress: text(beneficiary["address"], `${label}.beneficiary.address`),
  };
}

function parseDispute(value: unknown, label: string): DisputeRecord {
  const dispute = record(value, label);
  const challenger = record(dispute["challenger"], `${label}.challenger`);
  const claim = record(dispute["claim"], `${label}.claim`);
  const prover = record(claim["prover"], `${label}.claim.prover`);
  if (!Array.isArray(dispute["settlements"]) || dispute["settlements"].length > 100) {
    throw new Error(`${label}.settlements must be an array.`);
  }
  return {
    id: text(dispute["id"], `${label}.id`),
    chainId: integer(dispute["chainId"], `${label}.chainId`),
    claimId: decimal(dispute["claimId"], `${label}.claimId`),
    gameNumber: decimal(dispute["gameNumber"], `${label}.gameNumber`),
    challengerAddress: text(challenger["address"], `${label}.challenger.address`),
    challengerRoot: text(dispute["challengerRoot"], `${label}.challengerRoot`),
    initialHeight: integer(dispute["initialHeight"], `${label}.initialHeight`),
    bisectionRounds: integer(dispute["bisectionRounds"], `${label}.bisectionRounds`),
    expectedResponder: text(dispute["expectedResponder"], `${label}.expectedResponder`),
    deadlineBlock: decimal(dispute["deadlineBlock"], `${label}.deadlineBlock`),
    phase: text(dispute["phase"], `${label}.phase`),
    status: readStatus(
      dispute["status"],
      ["ACTIVE", "PROVER_WON", "CHALLENGER_WON", "UNKNOWN"],
      `${label}.status`,
    ),
    outcome: dispute["outcome"] === null ? null : integer(dispute["outcome"], `${label}.outcome`),
    differentIndex:
      dispute["differentIndex"] === null
        ? null
        : integer(dispute["differentIndex"], `${label}.differentIndex`),
    proverAddress: text(prover["address"], `${label}.claim.prover.address`),
    traceRoot: text(claim["traceRoot"], `${label}.claim.traceRoot`),
    claimStatus: text(claim["status"], `${label}.claim.status`),
    challengerBonds: parseBondList(dispute["deposits"], `${label}.deposits`),
    settlements: dispute["settlements"].map((item, index) =>
      parseSettlement(item, `${label}.settlements[${index}]`),
    ),
    sourceEvent: parseTransactionReference(dispute["sourceEvent"], `${label}.sourceEvent`),
  };
}

function withParsed<T>(response: ApiResponse, parser: (body: unknown) => T): ReadResult<T> {
  if (response.kind !== "response") return response;
  try {
    return { kind: "ready", value: parser(response.body) };
  } catch {
    return { kind: "invalid-data" };
  }
}

export async function getOverview(): Promise<ReadResult<OverviewData>> {
  const response = await fetchApi("v1/overview");
  return withParsed(response, (body) => {
    const overview = record(body, "overview");
    const metrics = record(overview["metrics"], "overview.metrics");
    const indexer = record(overview["indexer"], "overview.indexer");
    const lag = record(indexer["lag"], "overview.indexer.lag");
    const checkpointValue = indexer["checkpoint"];
    const checkpoint =
      checkpointValue === null ? null : record(checkpointValue, "overview.indexer.checkpoint");
    if (!Array.isArray(overview["recentActivity"]) || overview["recentActivity"].length > 8) {
      throw new Error("overview.recentActivity must be an array of at most eight records.");
    }
    return {
      chainId: integer(overview["chainId"], "overview.chainId"),
      contractAddress: text(overview["contractAddress"], "overview.contractAddress"),
      confirmationDepth: decimal(overview["confirmationDepth"], "overview.confirmationDepth"),
      metrics: {
        totalClaims: integer(metrics["totalClaims"], "metrics.totalClaims"),
        activeDisputes: integer(metrics["activeDisputes"], "metrics.activeDisputes"),
        completedDisputes: integer(metrics["completedDisputes"], "metrics.completedDisputes"),
        verifiedResults: integer(metrics["verifiedResults"], "metrics.verifiedResults"),
        lockedExposureWei: decimal(metrics["lockedExposureWei"], "metrics.lockedExposureWei"),
      },
      indexer: {
        deploymentBlock: decimal(indexer["deploymentBlock"], "indexer.deploymentBlock"),
        checkpoint:
          checkpoint === null
            ? null
            : {
                lastBlockNumber: decimal(
                  checkpoint["lastBlockNumber"],
                  "checkpoint.lastBlockNumber",
                ),
                confirmedBlock: decimal(checkpoint["confirmedBlock"], "checkpoint.confirmedBlock"),
                updatedAt: text(checkpoint["updatedAt"], "checkpoint.updatedAt"),
              },
        lag: {
          latestBlock: decimal(lag["latestBlock"], "lag.latestBlock"),
          confirmedBlock: decimal(lag["confirmedBlock"], "lag.confirmedBlock"),
          lagBlocks: decimal(lag["lagBlocks"], "lag.lagBlocks"),
        },
      },
      recentActivity: overview["recentActivity"].map((event, index) => {
        const row = record(event, `recentActivity[${index}]`);
        const block = record(row["block"], `recentActivity[${index}].block`);
        return {
          eventName: text(row["eventName"], `recentActivity[${index}].eventName`),
          blockNumber: decimal(row["blockNumber"], `recentActivity[${index}].blockNumber`),
          transactionHash: text(row["transactionHash"], `recentActivity[${index}].transactionHash`),
          logIndex: integer(row["logIndex"], `recentActivity[${index}].logIndex`),
          timestamp:
            block["timestamp"] === null
              ? null
              : text(block["timestamp"], `recentActivity[${index}].timestamp`),
        };
      }),
    };
  });
}

export async function getClaims(query: string): Promise<ReadResult<ReadPage<ClaimRecord>>> {
  return withParsed(await fetchApi(`v1/claims?limit=20${query}`), (body) =>
    parsePage(body, parseClaim),
  );
}

export async function getClaim(claimId: string): Promise<ReadResult<ClaimRecord>> {
  const response = await fetchApi(`v1/claims/${encodeURIComponent(claimId)}`);
  if (response.kind === "service" && response.status === 404) return { kind: "not-found" };
  return withParsed(response, (body) => parseClaim(body, "claim"));
}

export async function getDisputes(query: string): Promise<ReadResult<ReadPage<DisputeRecord>>> {
  return withParsed(await fetchApi(`v1/disputes?limit=20${query}`), (body) =>
    parsePage(body, parseDispute),
  );
}
