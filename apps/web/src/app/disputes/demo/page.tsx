import Link from "next/link";
import { DisputeVisualizer } from "../../../components/dispute-visualizer";
import { createEducationalDemoReplay } from "../../../lib/dispute-demo";

export const dynamic = "force-dynamic";

export default function EducationalDisputeDemo() {
  const replay = createEducationalDemoReplay();
  return (
    <main className="page">
      <p className="eyebrow">
        <Link href="/disputes">Disputes</Link> / Educational simulation
      </p>
      <h1>Watch 1,023 transitions narrow to one state</h1>
      <p className="lead">
        The real BISECT VM and ordered Keccak tree generate these commitments. One intermediate
        state is deliberately altered for teaching. There are no blockchain transactions, bonds or
        settlement in this simulation.
      </p>
      <DisputeVisualizer data={replay} claimId="demo" gameNumber="demo" simulation />
    </main>
  );
}
