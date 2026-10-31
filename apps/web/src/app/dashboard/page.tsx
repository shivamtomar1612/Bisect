import type { Metadata } from "next";
import { Dashboard } from "../../components/dashboard";
import { getOverview } from "../../lib/read-api";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Overview | BISECT",
  description: "Read confirmed BISECT claims, disputes, exposure, and indexer synchronization.",
};

export default async function DashboardPage() {
  return <Dashboard result={await getOverview()} />;
}
