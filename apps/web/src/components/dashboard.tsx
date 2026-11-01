import Link from "next/link";
import type { OverviewData, ReadFailure, ReadResult } from "../lib/read-api";
import { ReadDataNotice } from "./explorers";
import { Phase16Analytics } from "./phase16-analytics";
import {
  AddressExplorerLink,
  Badge,
  ExplorerLink,
  FinancialAmount,
  networkName,
  StatePanel,
} from "./ui";

function Metric({ title, value, note }: { title: string; value: React.ReactNode; note: string }) {
  return (
    <section className="card pad dashboard-metric">
      <p className="small muted">{title}</p>
      <p className="metric">{value}</p>
      <p className="small muted">{note}</p>
    </section>
  );
}

function Checkpoint({ overview }: { overview: OverviewData }) {
  const checkpoint = overview.indexer.checkpoint;
  const isSepolia = overview.chainId === 84532;
  return (
    <section className="card pad sync-card">
      <div className="section-head">
        <h2>Indexer synchronization</h2>
        <Badge tone={checkpoint ? "good" : "warn"}>
          <span className="dot" />
          {checkpoint ? "Checkpoint available" : "Waiting for first checkpoint"}
        </Badge>
      </div>
      <dl className="settings-list compact-list">
        <div>
          <dt>Indexed network</dt>
          <dd>
            {networkName(overview.chainId)} · {overview.chainId}
          </dd>
        </div>
        <div>
          <dt>Registry</dt>
          <dd>
            <AddressExplorerLink address={overview.contractAddress} chainId={overview.chainId} />
          </dd>
        </div>
        <div>
          <dt>Confirmed through</dt>
          <dd>{checkpoint ? `Block ${checkpoint.confirmedBlock}` : "Not indexed"}</dd>
        </div>
        <div>
          <dt>Indexer lag</dt>
          <dd>{overview.indexer.lag.lagBlocks} blocks</dd>
        </div>
        <div>
          <dt>Confirmation policy</dt>
          <dd>{overview.confirmationDepth} descendant blocks</dd>
        </div>
        <div>
          <dt>Last checkpoint update</dt>
          <dd>{checkpoint ? new Date(checkpoint.updatedAt).toLocaleString() : "Not available"}</dd>
        </div>
        <div>
          <dt>Deployment block</dt>
          <dd>{overview.indexer.deploymentBlock}</dd>
        </div>
      </dl>
      {isSepolia ? (
        <p className="small muted sync-footnote">
          Base Sepolia testnet data · only confirmed canonical events are included.
        </p>
      ) : (
        <p className="small muted sync-footnote">
          This data source is not Base Sepolia. Explorer links are disabled unless the indexed chain
          is Base Sepolia.
        </p>
      )}
    </section>
  );
}

export function Dashboard({ result }: { result: ReadResult<OverviewData> }) {
  const overview = result.kind === "ready" ? result.value : null;
  return (
    <div className="page">
      <div className="heading dashboard-heading">
        <div>
          <p className="eyebrow">Protocol workspace / Overview</p>
          <h1>Network overview</h1>
          <p className="lead">
            Confirmed claims, disputes, exposure, and indexer freshness from the configured read
            service.
          </p>
        </div>
        <Badge tone="warn">
          <span className="dot" />
          Base Sepolia testnet prototype
        </Badge>
      </div>
      {result.kind !== "ready" && result.kind !== "not-found" ? (
        <ReadDataNotice result={result as ReadFailure} subject="dashboard data" />
      ) : null}
      <div className="grid dashboard-metrics">
        <Metric
          title="Total claims"
          value={overview?.metrics.totalClaims ?? "—"}
          note="Confirmed claim submissions"
        />
        <Metric
          title="Active disputes"
          value={overview?.metrics.activeDisputes ?? "—"}
          note="Dispute games still open"
        />
        <Metric
          title="Completed disputes"
          value={overview?.metrics.completedDisputes ?? "—"}
          note="Games with a recorded outcome"
        />
        <Metric
          title="Verified results"
          value={overview?.metrics.verifiedResults ?? "—"}
          note="Claims in the finalized contract state"
        />
        <Metric
          title="Protocol exposure (test ETH)"
          value={
            overview ? (
              <FinancialAmount wei={overview.metrics.lockedExposureWei} />
            ) : (
              <span className="muted">—</span>
            )
          }
          note="Confirmed test-ETH bonds currently marked locked"
        />
      </div>
      <Phase16Analytics />
      {overview ? (
        <div className="dashboard-columns">
          <Checkpoint overview={overview} />
          <section className="card pad activity-card">
            <div className="section-head">
              <div>
                <h2>Recent contract activity</h2>
                <p className="small muted">Confirmed registry events only</p>
              </div>
              <Link className="text-link" href="/claims">
                Explore claims
              </Link>
            </div>
            {overview.recentActivity.length ? (
              <ol className="activity-list">
                {overview.recentActivity.map((event, index) => (
                  <li key={`${event.transactionHash}-${event.logIndex}`}>
                    <span className="activity-mark" aria-hidden="true" />
                    <div className="activity-copy">
                      <strong>{event.eventName.replace(/([a-z])([A-Z])/g, "$1 $2")}</strong>
                      <span className="small muted">
                        Block {event.blockNumber}
                        {event.timestamp ? ` · ${new Date(event.timestamp).toLocaleString()}` : ""}
                      </span>
                    </div>
                    <ExplorerLink hash={event.transactionHash} chainId={overview.chainId} />
                    {index < overview.recentActivity.length - 1 ? (
                      <span className="activity-rule" aria-hidden="true" />
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : (
              <StatePanel
                kind="empty"
                title="No confirmed contract activity"
                detail="The configured registry has no canonical, confirmed events to show yet."
              />
            )}
          </section>
        </div>
      ) : (
        <section className="card pad dashboard-network-fallback">
          <div className="section-head">
            <h2>Network and data freshness</h2>
            <Badge tone="warn">Indexer status unavailable</Badge>
          </div>
          <p className="lead">
            Target network: Base Sepolia · chain ID 84532. The app does not infer deployment,
            balances, indexer height, or recent activity without a successful read API response.
          </p>
        </section>
      )}
    </div>
  );
}
