import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getOverview } from "../../apps/web/src/lib/read-api";

const exactExposure = "900719925474099312345678901234567890";

async function serve(
  handler: (requestUrl: string) => { status: number; body: unknown },
): Promise<{ server: Server; url: string }> {
  const server = createServer((request, response) => {
    const result = handler(request.url ?? "/");
    response.writeHead(result.status, { "content-type": "application/json" });
    response.end(JSON.stringify(result.body));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Test API did not bind an ephemeral port.");
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

function validOverview() {
  return {
    chainId: 84532,
    contractAddress: "0x0000000000000000000000000000000000000001",
    confirmationDepth: "6",
    metrics: {
      totalClaims: 0,
      activeDisputes: 0,
      completedDisputes: 0,
      verifiedResults: 0,
      lockedExposureWei: exactExposure,
    },
    indexer: {
      deploymentBlock: "1",
      checkpoint: null,
      lag: { latestBlock: "100", confirmedBlock: "94", lagBlocks: "6" },
    },
    recentActivity: [],
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("server-side Phase 8 read API boundary", () => {
  it("keeps unconfigured data unavailable instead of inventing zeroes", async () => {
    vi.stubEnv("BISECT_INDEXER_API_URL", "");
    await expect(getOverview()).resolves.toEqual({ kind: "not-configured" });
  });

  it("preserves arbitrarily large integer wei values as decimal strings", async () => {
    const api = await serve(() => ({ status: 200, body: validOverview() }));
    vi.stubEnv("BISECT_INDEXER_API_URL", api.url);
    try {
      const result = await getOverview();
      expect(result.kind).toBe("ready");
      if (result.kind === "ready") {
        expect(result.value.metrics.lockedExposureWei).toBe(exactExposure);
        expect(result.value.indexer.lag.latestBlock).toBe("100");
      }
    } finally {
      await close(api.server);
    }
  });

  it("surfaces an API/RPC service failure without showing stale metrics", async () => {
    const api = await serve(() => ({ status: 500, body: { error: "internal_error" } }));
    vi.stubEnv("BISECT_INDEXER_API_URL", api.url);
    try {
      await expect(getOverview()).resolves.toEqual({ kind: "service", status: 500 });
    } finally {
      await close(api.server);
    }
  });

  it("rejects malformed successful API data instead of silently defaulting fields", async () => {
    const api = await serve(() => ({ status: 200, body: { metrics: { totalClaims: 0 } } }));
    vi.stubEnv("BISECT_INDEXER_API_URL", api.url);
    try {
      await expect(getOverview()).resolves.toEqual({ kind: "invalid-data" });
    } finally {
      await close(api.server);
    }
  });

  it("distinguishes a disconnected configured API from an empty index", async () => {
    const api = await serve(() => ({ status: 200, body: validOverview() }));
    const deadUrl = api.url;
    await close(api.server);
    vi.stubEnv("BISECT_INDEXER_API_URL", deadUrl);
    await expect(getOverview()).resolves.toEqual({ kind: "unreachable" });
  });
});
