import Link from "next/link";
import { notFound } from "next/navigation";
import { DisputeVisualizer } from "../../../../components/dispute-visualizer";
import { ReadDataNotice } from "../../../../components/explorers";
import { getDisputeTimeline } from "../../../../lib/read-api";

export const dynamic = "force-dynamic";

export default async function DisputeTimelinePage({
  params,
}: {
  params: Promise<{ claimId: string; gameNumber: string }>;
}) {
  const { claimId, gameNumber } = await params;
  if (
    !/^[1-9][0-9]{0,77}$/.test(claimId) ||
    !/^[1-9][0-9]{0,77}$/.test(gameNumber) ||
    BigInt(claimId) > (1n << 256n) - 1n ||
    BigInt(gameNumber) > (1n << 256n) - 1n
  )
    notFound();
  const result = await getDisputeTimeline(claimId, gameNumber);
  if (result.kind === "not-found") notFound();
  return (
    <main className="page">
      <p className="eyebrow">
        <Link href="/disputes">Disputes</Link> / Claim {claimId} / Game {gameNumber}
      </p>
      <h1>Interactive bisection replay</h1>
      <p className="lead">
        Watch authenticated ordered subtree commitments isolate the first differing state.
      </p>
      {result.kind === "ready" ? (
        <DisputeVisualizer data={result.value} claimId={claimId} gameNumber={gameNumber} />
      ) : (
        <ReadDataNotice result={result} subject="dispute timeline" />
      )}
    </main>
  );
}
