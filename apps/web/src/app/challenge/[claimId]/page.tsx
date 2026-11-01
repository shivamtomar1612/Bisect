import { notFound } from "next/navigation";
import { ChallengeWorkbench } from "../../../components/challenge-workbench";
import { getClaim, getOverview } from "../../../lib/read-api";

export const dynamic = "force-dynamic";

export default async function ChallengePage({ params }: { params: Promise<{ claimId: string }> }) {
  const { claimId } = await params;
  if (!/^[1-9][0-9]{0,77}$/.test(claimId) || BigInt(claimId) > (1n << 256n) - 1n) notFound();
  const [indexed, overview] = await Promise.all([getClaim(claimId), getOverview()]);
  const registry = process.env["NEXT_PUBLIC_BISECT_REGISTRY_ADDRESS"];
  const expectedChain = process.env["NEXT_PUBLIC_BISECT_CHAIN_ID"] === "31337" ? 31337 : 84532;
  const sameDeployment =
    indexed.kind === "ready" &&
    overview.kind === "ready" &&
    registry !== undefined &&
    indexed.value.contractAddress.toLowerCase() === registry.toLowerCase() &&
    overview.value.contractAddress.toLowerCase() === registry.toLowerCase() &&
    overview.value.chainId === expectedChain;
  const indexerStatus =
    sameDeployment && overview.kind === "ready"
      ? `claim confirmed; ${overview.value.indexer.lag.lagBlocks} blocks behind; checkpoint ${overview.value.indexer.checkpoint?.lastBlockNumber ?? "unavailable"}`
      : indexed.kind === "not-found"
        ? "claim not yet indexed"
        : "indexer unavailable or behind";
  return (
    <main className="page">
      <p className="eyebrow">Claims / #{claimId}</p>
      <h1>Challenge claim #{claimId}</h1>
      <ChallengeWorkbench claimIdText={claimId} indexerStatus={indexerStatus} />
    </main>
  );
}
