"use client";
import { useMemo, useState } from "react";
import { FinancialTable, StatePanel } from "./ui";

type Row = {
  readonly id: string;
  readonly type: string;
  readonly amount: string;
  readonly status: "pending" | "confirmed" | "reverted";
};
export function ActivityTable({
  rows,
  emptyTitle = "No ledger activity",
  emptyDetail,
}: {
  rows: readonly Row[];
  emptyTitle?: string;
  emptyDetail?: string;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const filtered = useMemo(
    () =>
      rows.filter(
        (row) =>
          `${row.id} ${row.type}`.toLowerCase().includes(query.toLowerCase()) &&
          (status === "all" || row.status === status),
      ),
    [rows, query, status],
  );
  return (
    <section className="card">
      <div className="table-toolbar">
        <label className="sr-only" htmlFor="activity-query">
          Filter activity
        </label>
        <input
          className="input"
          id="activity-query"
          type="search"
          placeholder="Filter activity"
          value={query}
          disabled={!rows.length}
          onChange={(event) => setQuery(event.target.value)}
        />
        <label className="sr-only" htmlFor="activity-status">
          Filter by status
        </label>
        <select
          className="input"
          id="activity-status"
          value={status}
          disabled={!rows.length}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="confirmed">Confirmed</option>
          <option value="reverted">Reverted</option>
        </select>
        {query || status !== "all" ? (
          <button
            type="button"
            className="button"
            onClick={() => {
              setQuery("");
              setStatus("all");
            }}
          >
            Clear filters
          </button>
        ) : !rows.length ? (
          <span className="small muted">Filters unlock when records are indexed.</span>
        ) : null}
      </div>
      {!filtered.length && rows.length ? (
        <StatePanel
          kind="empty"
          title="No matching activity"
          detail="Change or clear the filters to see other records."
        />
      ) : (
        <FinancialTable
          rows={filtered}
          emptyTitle={emptyTitle}
          {...(emptyDetail === undefined ? {} : { emptyDetail })}
        />
      )}
    </section>
  );
}
