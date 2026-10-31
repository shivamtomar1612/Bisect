import { CircleAlert, ExternalLink, Inbox, LoaderCircle, ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";
import { formatWei } from "./format";

export { formatWei } from "./format";

export function networkName(chainId: number): string {
  if (chainId === 84532) return "Base Sepolia";
  if (chainId === 31337 || chainId === 1337) return "Local Anvil";
  return "Other EVM chain";
}

export function Badge({
  children,
  tone = "",
}: {
  children: ReactNode;
  tone?: "accent" | "good" | "warn" | "";
}) {
  return <span className={"chip " + tone}>{children}</span>;
}

export function FinancialAmount({ wei, label }: { wei?: bigint | string; label?: string }) {
  return (
    <span
      title={
        wei === undefined ? "Wallet or ledger source is not connected" : wei.toString() + " wei"
      }
    >
      {wei === undefined ? <span className="muted">—</span> : <>{formatWei(wei)} ETH</>}
      {label ? <span className="small muted"> {label}</span> : null}
    </span>
  );
}

export function StatePanel({
  kind,
  title,
  detail,
  action,
}: {
  kind: "empty" | "loading" | "error";
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  const Icon = kind === "error" ? CircleAlert : kind === "loading" ? LoaderCircle : Inbox;
  return (
    <section className="card empty" aria-live="polite" aria-busy={kind === "loading"}>
      <span className="empty-icon" aria-hidden="true">
        <Icon size={20} />
      </span>
      <h2>{title}</h2>
      <p>{detail}</p>
      {action}
    </section>
  );
}

export function WalletSecurityNotice() {
  return (
    <div className="callout" role="note">
      <ShieldAlert size={17} aria-hidden="true" /> <strong>Protect your wallet.</strong> BISECT
      never asks for a seed phrase or private key. Review every wallet prompt before signing.
    </div>
  );
}

export function TransactionStatus({ status }: { status: "pending" | "confirmed" | "reverted" }) {
  const tone = status === "confirmed" ? "good" : status === "reverted" ? "warn" : "accent";
  return (
    <Badge tone={tone}>
      <span className="dot" />
      {status[0]?.toUpperCase() + status.slice(1)}
    </Badge>
  );
}

export function ExplorerLink({ hash, chainId }: { hash?: string; chainId: number }) {
  if (!hash || !/^0x[a-fA-F0-9]{64}$/.test(hash))
    return <span className="muted">Not available</span>;
  if (chainId !== 84532) return <span className="muted">No public explorer for this network</span>;
  return (
    <a
      className="button"
      href={"https://sepolia.basescan.org/tx/" + hash}
      target="_blank"
      rel="noreferrer"
    >
      View on BaseScan <ExternalLink size={14} />
    </a>
  );
}

export function AddressExplorerLink({ address, chainId }: { address: string; chainId: number }) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return <span className="muted">Not available</span>;
  if (chainId !== 84532) return <code title={address}>{address}</code>;
  return (
    <a href={`https://sepolia.basescan.org/address/${address}`} target="_blank" rel="noreferrer">
      {address.slice(0, 8)}…{address.slice(-6)} <ExternalLink size={12} aria-hidden="true" />
    </a>
  );
}

export function ProofStatus({ verified }: { verified: boolean | null }) {
  if (verified === null) return <Badge>Not checked</Badge>;
  return <Badge tone={verified ? "good" : "warn"}>{verified ? "Verified" : "Invalid proof"}</Badge>;
}

export function FinancialTable({
  rows,
  emptyTitle = "No ledger activity",
  emptyDetail = "Confirmed deposits, settlements, and withdrawals will appear here when a registry is connected and indexed.",
}: {
  rows: readonly {
    id: string;
    type: string;
    amount: string;
    status: "pending" | "confirmed" | "reverted";
  }[];
  emptyTitle?: string;
  emptyDetail?: string;
}) {
  if (!rows.length) return <StatePanel kind="empty" title={emptyTitle} detail={emptyDetail} />;
  return (
    <div className="table-wrap">
      <table>
        <caption className="sr-only">Financial activity</caption>
        <thead>
          <tr>
            <th scope="col">Reference</th>
            <th scope="col">Type</th>
            <th scope="col">Amount</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <th scope="row">{row.id}</th>
              <td>{row.type}</td>
              <td>
                <FinancialAmount wei={row.amount} />
              </td>
              <td>
                <TransactionStatus status={row.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
