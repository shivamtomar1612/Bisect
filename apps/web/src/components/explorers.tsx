import Link from "next/link";
import type { ClaimRecord, DisputeRecord, ReadFailure, ReadPage } from "../lib/read-api";
import { Badge, ExplorerLink, FinancialAmount, StatePanel } from "./ui";

export function ReadDataNotice({ result, subject }: { result: ReadFailure; subject: string }) {
  if (result.kind === "not-configured") {
    return (
      <StatePanel
        kind="empty"
        title="Read API not configured"
        detail={`No ${subject} are shown as current. Set the server-only BISECT_INDEXER_API_URL to a configured Phase 8 read API. A Base Sepolia contract deployment and indexer checkpoint are not currently published by this workspace.`}
        action={
          <Link className="button" href="/documentation">
            Read the setup guide
          </Link>
        }
      />
    );
  }
  if (result.kind === "unreachable") {
    return (
      <StatePanel
        kind="error"
        title="Read API unreachable"
        detail={`The configured indexer could not be reached. ${subject} and financial values are unavailable until the API and its RPC/database checks respond.`}
      />
    );
  }
  if (result.kind === "service") {
    return (
      <StatePanel
        kind="error"
        title="Indexer or RPC check failed"
        detail={`The read API returned HTTP ${result.status ?? "error"}. Its RPC, PostgreSQL, or indexer check may have failed. No stale data is presented as current.`}
      />
    );
  }
  return (
    <StatePanel
      kind="error"
      title="Read API response invalid"
      detail="The configured service returned data that does not match the Phase 8 read API contract. Values are hidden until the response is corrected."
    />
  );
}

function ExplorerFilters({
  kind,
  query,
  status,
}: {
  kind: "claims" | "disputes";
  query: string;
  status: string;
}) {
  const options =
    kind === "claims"
      ? [
          ["", "All statuses"],
          ["OPEN", "Open"],
          ["GAME_ACTIVE", "Dispute active"],
          ["FINALIZED", "Finalized"],
          ["REFUTED", "Refuted"],
        ]
      : [
          ["", "All statuses"],
          ["ACTIVE", "Active"],
          ["PROVER_WON", "Prover won"],
          ["CHALLENGER_WON", "Challenger won"],
        ];
  return (
    <search className="explorer-search" aria-label={`Filter ${kind}`}>
      <form className="explorer-filters" method="get">
        <label className="sr-only" htmlFor={`${kind}-search`}>
          Search by ID, wallet, or commitment
        </label>
        <input
          id={`${kind}-search`}
          className="input"
          type="search"
          name="q"
          maxLength={100}
          placeholder="ID, wallet, or commitment"
          defaultValue={query}
        />
        <label className="sr-only" htmlFor={`${kind}-status`}>
          Filter {kind} by status
        </label>
        <select id={`${kind}-status`} className="input" name="status" defaultValue={status}>
          {options.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button className="button primary" type="submit">
          Apply filters
        </button>
        {query || status ? (
          <Link className="button" href={`/${kind}`}>
            Clear
          </Link>
        ) : null}
      </form>
    </search>
  );
}

function PageNavigation<T>({
  page,
  kind,
  query,
  status,
  cursor,
}: {
  page: ReadPage<T>;
  kind: "claims" | "disputes";
  query: string;
  status: string;
  cursor: string;
}) {
  if (!page.nextCursor && !cursor) return null;
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (status) params.set("status", status);
  const nextParams = new URLSearchParams(params);
  if (page.nextCursor) nextParams.set("cursor", page.nextCursor);
  return (
    <nav className="pagination" aria-label={`${kind} pages`}>
      {cursor ? (
        <Link className="button" href={`/${kind}${params.size ? `?${params}` : ""}`}>
          First page
        </Link>
      ) : null}
      <span className="small muted">Showing up to 20 confirmed indexed records</span>
      {page.nextCursor ? (
        <Link className="button primary" href={`/${kind}?${nextParams}`}>
          Next page
        </Link>
      ) : null}
    </nav>
  );
}

function StatusBadge({ status }: { status: string }) {
  const label = status.replaceAll("_", " ").toLowerCase();
  const tone =
    status === "FINALIZED" || status === "PROVER_WON" || status === "CHALLENGER_WON"
      ? "good"
      : status === "UNKNOWN" || status === "REFUTED"
        ? "warn"
        : "accent";
  return <Badge tone={tone}>{label}</Badge>;
}

function short(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

export function ClaimsExplorer({
  page,
  query,
  status,
  cursor,
}: {
  page: ReadPage<ClaimRecord>;
  query: string;
  status: string;
  cursor: string;
}) {
  return (
    <>
      <div className="section-head">
        <div>
          <h2>Execution claims</h2>
          <p className="small muted">Canonical, confirmed records from the configured registry.</p>
        </div>
        <Badge>Read only</Badge>
      </div>
      <ExplorerFilters kind="claims" query={query} status={status} />
      {page.data.length === 0 ? (
        <StatePanel
          kind="empty"
          title={query || status ? "No claims match these filters" : "No claims indexed"}
          detail={
            query || status
              ? "Clear or change the search and status filters."
              : "Claims appear here only after the configured indexer has confirmed their on-chain events."
          }
        />
      ) : (
        <div className="card table-wrap explorer-table-wrap">
          <table className="explorer-table">
            <caption className="sr-only">Confirmed BISECT execution claims</caption>
            <thead>
              <tr>
                <th scope="col">Claim</th>
                <th scope="col">Prover</th>
                <th scope="col">Program context</th>
                <th scope="col">Trace commitment</th>
                <th scope="col">Status</th>
                <th scope="col">Challenge deadline</th>
                <th scope="col">Prover bond</th>
                <th scope="col">Contract event</th>
              </tr>
            </thead>
            <tbody>
              {page.data.map((claim) => (
                <tr key={claim.id}>
                  <th scope="row">
                    <Link href={`/claims/${claim.claimId}`}>#{claim.claimId}</Link>
                  </th>
                  <td>
                    <code title={claim.proverAddress}>{short(claim.proverAddress)}</code>
                  </td>
                  <td>
                    <code title={claim.contextHash}>{short(claim.contextHash)}</code>
                  </td>
                  <td>
                    <code title={claim.traceRoot}>{short(claim.traceRoot)}</code>
                  </td>
                  <td>
                    <StatusBadge status={claim.status} />
                  </td>
                  <td>Block {claim.challengeDeadline}</td>
                  <td>
                    {claim.proverBonds[0] ? (
                      <FinancialAmount wei={claim.proverBonds[0].amountWei} />
                    ) : (
                      <span className="muted">Not indexed</span>
                    )}
                  </td>
                  <td>
                    {claim.sourceEvent ? (
                      <ExplorerLink
                        hash={claim.sourceEvent.transactionHash}
                        chainId={claim.chainId}
                      />
                    ) : (
                      <span className="muted">Unavailable</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <PageNavigation page={page} kind="claims" query={query} status={status} cursor={cursor} />
    </>
  );
}

export function DisputesExplorer({
  page,
  query,
  status,
  cursor,
}: {
  page: ReadPage<DisputeRecord>;
  query: string;
  status: string;
  cursor: string;
}) {
  return (
    <>
      <div className="section-head">
        <div>
          <h2>Interactive disputes</h2>
          <p className="small muted">
            Participants, bisection progress, and confirmed settlement events.
          </p>
        </div>
        <Badge>Read only</Badge>
      </div>
      <ExplorerFilters kind="disputes" query={query} status={status} />
      {page.data.length === 0 ? (
        <StatePanel
          kind="empty"
          title={query || status ? "No disputes match these filters" : "No disputes indexed"}
          detail={
            query || status
              ? "Clear or change the search and status filters."
              : "Confirmed dispute openings and outcomes appear here when a registry is configured and indexed."
          }
        />
      ) : (
        <div className="card table-wrap explorer-table-wrap">
          <table className="explorer-table disputes-table">
            <caption className="sr-only">Confirmed BISECT disputes and financial outcomes</caption>
            <thead>
              <tr>
                <th scope="col">Dispute</th>
                <th scope="col">Prover / challenger</th>
                <th scope="col">Claim</th>
                <th scope="col">Bisection</th>
                <th scope="col">Status / result</th>
                <th scope="col">Settlement</th>
                <th scope="col">Deadline</th>
                <th scope="col">Opening transaction</th>
              </tr>
            </thead>
            <tbody>
              {page.data.map((dispute) => {
                const settledWei = dispute.settlements.reduce(
                  (sum, item) => sum + BigInt(item.amountWei),
                  0n,
                );
                return (
                  <tr key={dispute.id}>
                    <th scope="row">
                      <Link href={`/disputes/${dispute.claimId}/${dispute.gameNumber}`}>
                        Game {dispute.gameNumber} · replay
                      </Link>
                    </th>
                    <td>
                      <div className="participant-list">
                        <code title={dispute.proverAddress}>
                          P · {short(dispute.proverAddress)}
                        </code>
                        <code title={dispute.challengerAddress}>
                          C · {short(dispute.challengerAddress)}
                        </code>
                      </div>
                    </td>
                    <td>
                      <Link href={`/claims/${dispute.claimId}`}>#{dispute.claimId}</Link>
                    </td>
                    <td>
                      <strong>Round {dispute.bisectionRounds}</strong>
                      <span className="small muted block">
                        {dispute.phase.replaceAll("_", " ")}
                      </span>
                      {dispute.differentIndex === null ? null : (
                        <span className="small muted block">Step {dispute.differentIndex}</span>
                      )}
                    </td>
                    <td>
                      <StatusBadge status={dispute.status} />
                    </td>
                    <td>
                      {dispute.settlements.length ? (
                        <>
                          <FinancialAmount wei={settledWei} />
                          <span className="small muted block">
                            {dispute.settlements.length} confirmed credit event(s)
                          </span>
                          {dispute.settlements.map((item) => (
                            <span className="small block" key={item.transactionHash}>
                              <ExplorerLink hash={item.transactionHash} chainId={dispute.chainId} />
                            </span>
                          ))}
                        </>
                      ) : (
                        <span className="muted">No settlement indexed</span>
                      )}
                    </td>
                    <td>
                      {dispute.status === "ACTIVE" ? (
                        `Block ${dispute.deadlineBlock}`
                      ) : (
                        <span className="muted">Closed</span>
                      )}
                    </td>
                    <td>
                      {dispute.sourceEvent ? (
                        <ExplorerLink
                          hash={dispute.sourceEvent.transactionHash}
                          chainId={dispute.chainId}
                        />
                      ) : (
                        <span className="muted">Unavailable</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <PageNavigation page={page} kind="disputes" query={query} status={status} cursor={cursor} />
    </>
  );
}
