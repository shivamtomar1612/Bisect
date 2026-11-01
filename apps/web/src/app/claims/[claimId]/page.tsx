import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ReadDataNotice } from "../../../components/explorers";
import {
  AddressExplorerLink,
  Badge,
  ExplorerLink,
  FinancialAmount,
  networkName,
  StatePanel,
} from "../../../components/ui";
import { getClaim } from "../../../lib/read-api";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Claim details | BISECT",
  description: "Inspect an indexed BISECT claim and its canonical contract evidence.",
};

export default async function ClaimDetailPage({
  params,
}: {
  params: Promise<{ claimId: string }>;
}) {
  const { claimId } = await params;
  if (!/^(0|[1-9][0-9]{0,77})$/.test(claimId) || BigInt(claimId) > (1n << 256n) - 1n) notFound();
  const result = await getClaim(claimId);
  if (result.kind === "not-found") notFound();
  if (result.kind !== "ready") {
    return (
      <div className="page">
        <p className="eyebrow">Claims / #{claimId}</p>
        <h1>Claim details</h1>
        <ReadDataNotice result={result} subject="claim details" />
      </div>
    );
  }
  const claim = result.value;
  const proverBond = claim.proverBonds[0];
  return (
    <div className="page">
      <div className="heading">
        <div>
          <p className="eyebrow">
            <Link href="/claims">Claims</Link> / #{claim.claimId}
          </p>
          <h1>Claim #{claim.claimId}</h1>
          <p className="lead">
            Confirmed execution commitment and challenge window from the configured registry.
          </p>
        </div>
        <Badge
          tone={
            claim.status === "FINALIZED"
              ? "good"
              : claim.status === "UNKNOWN" || claim.status === "REFUTED"
                ? "warn"
                : "accent"
          }
        >
          {claim.status.replaceAll("_", " ").toLowerCase()}
        </Badge>
      </div>
      <div className="callout">
        The contract stores a context commitment and trace root. The application does not claim to
        hold or publish the original program or trace data.
      </div>
      <div className="grid two detail-grid">
        <section className="card pad">
          <h2>Execution context</h2>
          <dl className="settings-list">
            <div>
              <dt>Prover</dt>
              <dd>
                <code title={claim.proverAddress}>{claim.proverAddress}</code>
              </dd>
            </div>
            <div>
              <dt>Program and input context</dt>
              <dd>
                <code title={claim.contextHash}>{claim.contextHash}</code>
              </dd>
            </div>
            <div>
              <dt>Execution trace root</dt>
              <dd>
                <code title={claim.traceRoot}>{claim.traceRoot}</code>
              </dd>
            </div>
            <div>
              <dt>Transitions</dt>
              <dd>{claim.transitionCount}</dd>
            </div>
            <div>
              <dt>Claimed output (register 0)</dt>
              <dd>{claim.claimedOutput}</dd>
            </div>
            <div>
              <dt>Submitted at</dt>
              <dd>Block {claim.submittedBlock}</dd>
            </div>
            <div>
              <dt>Challenge deadline</dt>
              <dd>Block {claim.challengeDeadline}</dd>
            </div>
          </dl>
        </section>
        <section className="card pad">
          <h2>Contract and bond</h2>
          <dl className="settings-list">
            <div>
              <dt>Indexed network</dt>
              <dd>
                {networkName(claim.chainId)} · {claim.chainId}
              </dd>
            </div>
            <div>
              <dt>Registry contract</dt>
              <dd>
                <AddressExplorerLink address={claim.contractAddress} chainId={claim.chainId} />
              </dd>
            </div>
            <div>
              <dt>Prover bond</dt>
              <dd>{proverBond ? <FinancialAmount wei={proverBond.amountWei} /> : "Not indexed"}</dd>
            </div>
            <div>
              <dt>Bond status</dt>
              <dd>{proverBond?.status ?? "Not indexed"}</dd>
            </div>
          </dl>
          <div className="detail-transaction">
            <h3>Submission transaction</h3>
            {claim.sourceEvent ? (
              <ExplorerLink hash={claim.sourceEvent.transactionHash} chainId={claim.chainId} />
            ) : (
              <span className="muted">No canonical transaction reference available</span>
            )}
          </div>
        </section>
      </div>
      <section className="card pad associated-disputes">
        <div className="section-head">
          <div>
            <h2>Associated disputes</h2>
            <p className="small muted">
              Game numbers and rounds come from confirmed dispute events.
            </p>
          </div>
          <Link className="text-link" href={`/disputes?q=${claim.claimId}`}>
            Explore disputes
          </Link>
          <Link className="text-link" href={`/challenge/${claim.claimId}`}>
            Independently verify or challenge
          </Link>
        </div>
        {claim.disputes.length ? (
          <ul className="associated-list">
            {claim.disputes.map((dispute) => (
              <li key={dispute.gameNumber}>
                <span>
                  Game {dispute.gameNumber} · round {dispute.bisectionRounds}
                </span>
                <Badge tone={dispute.status === "ACTIVE" ? "accent" : "good"}>
                  {dispute.status.replaceAll("_", " ").toLowerCase()}
                </Badge>
              </li>
            ))}
          </ul>
        ) : (
          <StatePanel
            kind="empty"
            title="No disputes indexed"
            detail="There are no confirmed dispute openings associated with this claim."
          />
        )}
      </section>
    </div>
  );
}
