"use client";

import { bisectDisputeRegistryV1Abi } from "@bisect/sdk";
import { useCallback, useEffect, useState } from "react";
import type { Address, Hex } from "viem";
import {
  getWalletProvider,
  publicClient,
  readWalletFunds,
  registryAddress,
  requireTransactionWallet,
  sendRegistryTransaction,
  walletAccount,
  walletChain,
  walletChainId,
  walletChainName,
  withdrawCalldata,
} from "../lib/wallet-chain";
import { formatWei } from "./format";
import { FinancialAmount, StatePanel } from "./ui";

type LedgerRow = {
  id: string;
  kind: string;
  amountWei: bigint;
  block: string;
  txHash: Hex;
  claimId: string;
  bondStatus: string;
};
type LedgerTotals = {
  proverLockedWei: bigint;
  challengerLockedWei: bigint;
  depositedWei: bigint;
  withdrawnWei: bigint;
  rewardWei: bigint;
  penaltyWei: bigint;
  netRealizedWei: bigint;
  indexedCreditWei: bigint | null;
};
type LedgerPage = {
  rows: LedgerRow[];
  nextCursor: string | null;
  totals: LedgerTotals;
  lag: string;
  checkpoint: string | null;
};

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Ledger returned malformed data.");
  return value as Record<string, unknown>;
}
function wei(value: unknown, signed = false): bigint {
  if (
    typeof value !== "string" ||
    !(signed ? /^-?(0|[1-9][0-9]{0,77})$/ : /^(0|[1-9][0-9]{0,77})$/).test(value)
  )
    throw new Error("Ledger returned an invalid wei amount.");
  return BigInt(value);
}
function parsePage(value: unknown, address: Address): LedgerPage {
  const page = object(value);
  if (
    page["chainId"] !== walletChainId ||
    typeof page["address"] !== "string" ||
    page["address"].toLowerCase() !== address.toLowerCase()
  )
    throw new Error("Ledger network or wallet does not match.");
  const configured = registryAddress();
  if (
    configured &&
    (typeof page["contractAddress"] !== "string" ||
      page["contractAddress"].toLowerCase() !== configured.toLowerCase())
  )
    throw new Error("Ledger registry does not match.");
  const totals = object(page["totals"]);
  const activity = page["activity"];
  if (!Array.isArray(activity)) throw new Error("Ledger activity is malformed.");
  const rows = activity.map((value): LedgerRow => {
    const entry = object(value);
    const item = object(entry["item"]);
    const claim =
      item["claim"] === null || item["claim"] === undefined ? null : object(item["claim"]);
    if (
      typeof entry["kind"] !== "string" ||
      !["BOND_DEPOSIT", "SETTLEMENT", "WITHDRAWAL"].includes(entry["kind"]) ||
      typeof item["transactionHash"] !== "string" ||
      !/^0x[0-9a-fA-F]{64}$/.test(item["transactionHash"]) ||
      typeof entry["eventId"] !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(entry["eventId"]) ||
      typeof entry["blockNumber"] !== "string" ||
      !/^(0|[1-9][0-9]{0,19})$/.test(entry["blockNumber"]) ||
      (claim !== null &&
        (typeof claim["claimId"] !== "string" ||
          !/^(0|[1-9][0-9]{0,77})$/.test(claim["claimId"]))) ||
      (item["status"] !== undefined &&
        (typeof item["status"] !== "string" || !/^[A-Z_]{1,32}$/.test(item["status"])))
    )
      throw new Error("Ledger event is malformed.");
    return {
      id: String(entry["eventId"]),
      kind: entry["kind"],
      amountWei: wei(item["amountWei"]),
      block: String(entry["blockNumber"]),
      txHash: item["transactionHash"] as Hex,
      claimId: claim ? String(claim["claimId"]) : "—",
      bondStatus: typeof item["status"] === "string" ? item["status"] : "CONFIRMED",
    };
  });
  if (
    !(
      page["nextCursor"] === null ||
      (typeof page["nextCursor"] === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(page["nextCursor"]))
    )
  )
    throw new Error("Ledger cursor is malformed.");
  const freshness = object(page["freshness"]);
  return {
    rows,
    nextCursor: page["nextCursor"] as string | null,
    totals: {
      proverLockedWei: wei(totals["proverLockedWei"]),
      challengerLockedWei: wei(totals["challengerLockedWei"]),
      depositedWei: wei(totals["depositedWei"]),
      withdrawnWei: wei(totals["withdrawnWei"]),
      rewardWei: wei(totals["rewardWei"]),
      penaltyWei: wei(totals["penaltyWei"]),
      netRealizedWei: wei(totals["netRealizedWei"], true),
      indexedCreditWei:
        totals["indexedCreditWei"] === null ? null : wei(totals["indexedCreditWei"]),
    },
    lag: String(freshness["lag"]),
    checkpoint: freshness["checkpoint"] === null ? null : String(freshness["checkpoint"]),
  };
}
async function fetchPage(address: Address, cursor: string | null): Promise<LedgerPage> {
  const query = new URLSearchParams({ address });
  if (cursor) query.set("cursor", cursor);
  const response = await fetch(`/api/account-ledger?${query}`, { cache: "no-store" });
  const body: unknown = await response.json();
  if (!response.ok)
    throw new Error(
      typeof object(body)["error"] === "string"
        ? String(object(body)["error"])
        : "Confirmed ledger is unavailable.",
    );
  return parsePage(body, address);
}
function signedEth(amount: bigint): string {
  return amount < 0n ? `-${formatWei(-amount)}` : formatWei(amount);
}

export function AccountLedger() {
  const [account, setAccount] = useState<Address | null>(null);
  const [network, setNetwork] = useState<number | null>(null);
  const [funds, setFunds] = useState<{ walletWei: bigint; creditWei: bigint | null } | null>(null);
  const [page, setPage] = useState<LedgerPage | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<(string | null)[]>([]);
  const [fundsError, setFundsError] = useState("");
  const [ledgerError, setLedgerError] = useState("");
  const [txError, setTxError] = useState("");
  const [txStage, setTxStage] = useState("");
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("all");

  const refresh = useCallback(async (selected: Address | null, selectedCursor: string | null) => {
    if (!selected) {
      setFunds(null);
      setPage(null);
      return;
    }
    const results = await Promise.allSettled([
      readWalletFunds(selected),
      fetchPage(selected, selectedCursor),
    ]);
    if (results[0].status === "fulfilled") {
      setFunds(results[0].value);
      setFundsError("");
    } else {
      setFunds(null);
      setFundsError(
        results[0].reason instanceof Error ? results[0].reason.message : "RPC unavailable.",
      );
    }
    if (results[1].status === "fulfilled") {
      setPage(results[1].value);
      setLedgerError("");
    } else {
      setPage(null);
      setLedgerError(
        results[1].reason instanceof Error ? results[1].reason.message : "Indexer unavailable.",
      );
    }
  }, []);

  useEffect(() => {
    const provider = getWalletProvider();
    const sync = () => {
      void Promise.all([walletAccount(false), walletChain()])
        .then(([nextAccount, nextNetwork]) => {
          setAccount(nextAccount);
          setNetwork(nextNetwork);
          setCursor(null);
          setHistory([]);
          void refresh(nextAccount, null);
        })
        .catch(() => {
          setAccount(null);
          setNetwork(null);
        });
    };
    sync();
    provider?.on?.("accountsChanged", sync);
    provider?.on?.("chainChanged", sync);
    window.addEventListener("bisect:transaction-confirmed", sync);
    window.addEventListener("bisect:wallet-changed", sync);
    return () => {
      provider?.removeListener?.("accountsChanged", sync);
      provider?.removeListener?.("chainChanged", sync);
      window.removeEventListener("bisect:transaction-confirmed", sync);
      window.removeEventListener("bisect:wallet-changed", sync);
    };
  }, [refresh]);

  async function withdraw() {
    if (busy) return;
    setBusy(true);
    setTxError("");
    setTxHash(null);
    try {
      const wallet = await requireTransactionWallet();
      const credit = await publicClient.readContract({
        address: wallet.registry,
        abi: bisectDisputeRegistryV1Abi,
        functionName: "withdrawableCredit",
        args: [wallet.account],
      });
      if (credit <= 0n) throw new Error("No contract credit is available to withdraw.");
      setTxStage(`Approve withdrawal of ${formatWei(credit)} test ETH in your wallet.`);
      const receipt = await sendRegistryTransaction({
        ...wallet,
        data: withdrawCalldata(),
        onHash: (hash) => {
          setTxHash(hash);
          setTxStage("Transaction submitted. Waiting for a successful chain receipt.");
        },
      });
      setTxHash(receipt.hash);
      setTxStage(
        `Confirmed in block ${receipt.blockNumber.toString()}. Waiting for indexer confirmation separately.`,
      );
      await refresh(wallet.account, null);
    } catch (error) {
      setTxStage("");
      setTxError(error instanceof Error ? error.message : "Withdrawal did not complete.");
    } finally {
      setBusy(false);
    }
  }

  async function move(next: string | null) {
    if (!account) return;
    const previous = cursor;
    setCursor(next);
    if (next !== previous)
      setHistory((items) =>
        next === null || history.at(-1) === next ? items.slice(0, -1) : [...items, previous],
      );
    await refresh(account, next);
  }

  async function exportCsv() {
    if (!account) return;
    try {
      const rows: LedgerRow[] = [];
      let next: string | null = null;
      for (let index = 0; index < 100; index++) {
        const result = await fetchPage(account, next);
        rows.push(...result.rows);
        next = result.nextCursor;
        if (!next) break;
        if (index === 99) throw new Error("Export exceeds 2,000 entries; use the indexer API.");
      }
      const csv = [
        "event_id,type,amount_wei,block,transaction_hash,claim_id,bond_status",
        ...rows.map((row) =>
          [
            row.id,
            row.kind,
            row.amountWei.toString(),
            row.block,
            row.txHash,
            row.claimId,
            row.bondStatus,
          ]
            .map((value) => `"${String(value).replaceAll('"', '""')}"`)
            .join(","),
        ),
      ].join("\r\n");
      const href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = href;
      link.download = `bisect-confirmed-${account}.csv`;
      link.click();
      URL.revokeObjectURL(href);
    } catch (error) {
      setLedgerError(error instanceof Error ? error.message : "CSV export failed.");
    }
  }

  if (!account)
    return (
      <StatePanel
        kind="empty"
        title="Connect an external wallet"
        detail="Connect your wallet above to view contract funds and confirmed ledger activity. No signing key is stored here."
      />
    );
  const totals = page?.totals;
  const rows = page?.rows.filter((row) => filter === "all" || row.kind === filter) ?? [];
  return (
    <div>
      <div className="callout">
        {walletChainName} · test ETH · {account}. Wallet funds are external; locked bonds and
        contract credits are separate.
      </div>
      {network !== walletChainId ? (
        <p role="alert">
          Wallet is on the wrong network. Switch to {walletChainName} before any transaction.
        </p>
      ) : null}
      <div className="grid" style={{ margin: "18px 0" }}>
        {[
          ["External wallet balance", funds?.walletWei],
          ["Locked prover bonds · indexed", totals?.proverLockedWei],
          ["Locked challenger bonds · indexed", totals?.challengerLockedWei],
          ["Contract withdrawable credit · live", funds?.creditWei],
          ["Historical confirmed deposits", totals?.depositedWei],
          ["Historical confirmed withdrawals", totals?.withdrawnWei],
          ["Rewards · excluding returned principal", totals?.rewardWei],
          ["Slashed bonds", totals?.penaltyWei],
        ].map(([label, value]) => (
          <section className="card pad" key={String(label)}>
            <h3>{String(label)}</h3>
            <p className="metric">
              <FinancialAmount {...(typeof value === "bigint" ? { wei: value } : {})} />
            </p>
          </section>
        ))}
        <section className="card pad">
          <h3>Net realized reward less slashing</h3>
          <p className="metric">{totals ? `${signedEth(totals["netRealizedWei"])} ETH` : "—"}</p>
        </section>
      </div>
      {fundsError ? <p role="alert">Contract/RPC: {fundsError}</p> : null}
      <section className="card pad">
        <h2>Withdraw contract credit</h2>
        <p>Locked bonds cannot be withdrawn. Your wallet must approve a pull withdrawal.</p>
        <button
          type="button"
          className="button primary"
          onClick={withdraw}
          disabled={
            busy ||
            network !== walletChainId ||
            !registryAddress() ||
            !funds?.creditWei ||
            funds.creditWei <= 0n
          }
        >
          {busy ? "Waiting for confirmation…" : "Withdraw available credit"}
        </button>
        {!registryAddress() ? (
          <p className="small muted">
            A verified registry address is required to enable withdrawals.
          </p>
        ) : null}
        {txStage ? <p role="status">{txStage}</p> : null}
        {txError ? <p role="alert">{txError}</p> : null}
        {txHash ? (
          <p>
            Transaction:{" "}
            {walletChainId === 84532 ? (
              <a
                href={`https://sepolia.basescan.org/tx/${txHash}`}
                target="_blank"
                rel="noreferrer"
              >
                {txHash}
              </a>
            ) : (
              <code>{txHash}</code>
            )}
          </p>
        ) : null}
      </section>
      <section className="card pad" style={{ marginTop: 18 }}>
        <h2>Confirmed activity</h2>
        <p className="small muted">
          Indexer lag: {page?.lag ?? "unavailable"} blocks · Last checkpoint:{" "}
          {page?.checkpoint ?? "unavailable"}. Contract credit above is read directly from chain.
          Indexed credit:{" "}
          {totals?.indexedCreditWei === null || !totals
            ? "—"
            : `${formatWei(totals["indexedCreditWei"])} ETH`}
          .
        </p>
        {ledgerError ? <p role="alert">{ledgerError}</p> : null}
        <div className="table-toolbar">
          <label htmlFor="ledger-filter">Type</label>
          <select
            className="input"
            id="ledger-filter"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="all">All</option>
            <option value="BOND_DEPOSIT">Deposits and locks</option>
            <option value="SETTLEMENT">Settlements</option>
            <option value="WITHDRAWAL">Withdrawals</option>
          </select>
          <button
            className="button"
            type="button"
            onClick={() => void exportCsv()}
            disabled={!page}
          >
            Export confirmed CSV
          </button>
        </div>
        {rows.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Block</th>
                  <th>Activity</th>
                  <th>Claim</th>
                  <th>Amount</th>
                  <th>Transaction</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.block}</td>
                    <td>
                      {row.kind === "BOND_DEPOSIT"
                        ? `Bond deposit / lock · ${row.bondStatus}`
                        : row.kind === "SETTLEMENT"
                          ? "Settlement credit"
                          : "Withdrawal"}
                    </td>
                    <td>{row.claimId}</td>
                    <td>{formatWei(row.amountWei)} ETH</td>
                    <td>
                      {walletChainId === 84532 ? (
                        <a
                          href={`https://sepolia.basescan.org/tx/${row.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {row.txHash.slice(0, 10)}…
                        </a>
                      ) : (
                        <code>{row.txHash.slice(0, 10)}…</code>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="small muted">No confirmed activity on this page.</p>
        )}
        <div className="table-toolbar">
          <button
            className="button"
            type="button"
            disabled={!history.length}
            onClick={() => void move(history.at(-1) ?? null)}
          >
            Previous
          </button>
          <button
            className="button"
            type="button"
            disabled={!page?.nextCursor}
            onClick={() => void move(page?.nextCursor ?? null)}
          >
            Next
          </button>
          <button className="button" type="button" onClick={() => void refresh(account, cursor)}>
            Refresh
          </button>
        </div>
      </section>
    </div>
  );
}
