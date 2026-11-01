import {
  ArrowRight,
  BookOpenCheck,
  Boxes,
  FileClock,
  Fingerprint,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { AccountLedger } from "./account-ledger";
import { ActivityTable } from "./activity-table";
import { ProgramStudio } from "./program-studio";
import { SecurityDialog } from "./security-dialog";
import { Badge, ProofStatus, StatePanel, WalletSecurityNotice } from "./ui";

export const sections = {
  overview: {
    title: "Overview",
    intro: "A clear view of computation claims, trace disputes, and escrow accounting.",
  },
  "program-studio": {
    title: "Program Studio",
    intro: "Prepare bounded deterministic programs for reproducible execution.",
  },
  claims: {
    title: "Claims",
    intro: "Review submitted execution commitments and their challenge windows.",
  },
  disputes: {
    title: "Disputes",
    intro: "Follow authenticated trace comparisons and on-chain dispute deadlines.",
  },
  "account-ledger": {
    title: "Account Ledger",
    intro: "Separate wallet funds, locked protocol bonds, and withdrawable credits.",
  },
  documentation: {
    title: "Documentation",
    intro: "Understand the protocol rules, security boundaries, and developer workflow.",
  },
  settings: {
    title: "Settings",
    intro: "Manage display preferences and inspect the current network context.",
  },
} as const;
export type SectionKey = keyof typeof sections;

export function PageHeader({ section, action }: { section: SectionKey; action?: ReactNode }) {
  const meta = sections[section];
  return (
    <div className="heading">
      <div>
        <p className="eyebrow">Protocol workspace / {meta.title}</p>
        <h1>
          {section === "overview" ? (
            <>
              Computation deserves
              <br className="desktop-break" /> a dispute path.
            </>
          ) : (
            meta.title
          )}
        </h1>
        <p className="lead">{meta.intro}</p>
      </div>
      {action ? <div className="heading-action">{action}</div> : null}
    </div>
  );
}

function Overview() {
  return (
    <>
      <PageHeader
        section="overview"
        action={
          <Badge tone="warn">
            <span className="dot" />
            Base Sepolia · preview
          </Badge>
        }
      />
      <div className="callout">
        <strong>Testnet workspace.</strong> No registry deployment is configured. Wallet balances
        and protocol activity will remain unavailable until a supported data source is configured.
      </div>
      <div className="grid" style={{ marginTop: 18 }}>
        {[
          {
            title: "Wallet balance",
            state: "Not connected",
            note: "External wallet · Base Sepolia",
          },
          {
            title: "Locked bonds",
            state: "Registry unavailable",
            note: "Escrowed by active claims and disputes",
          },
          {
            title: "Withdrawable",
            state: "Registry unavailable",
            note: "Pull credits recorded by the contract",
          },
        ].map((item) => (
          <section className="card pad" key={item.title}>
            <div className="card-top">
              <h3>{item.title}</h3>
              <span className="chip">ETH</span>
            </div>
            <p className="metric missing">{item.state}</p>
            <p className="small muted">{item.note}</p>
          </section>
        ))}
      </div>
      <div className="grid two" style={{ marginTop: 18 }}>
        <section className="card pad">
          <div className="section-head">
            <h2>Protocol lifecycle</h2>
            <span className="chip accent">How BISECT works</span>
          </div>
          <div className="steps">
            <div className="step">
              <strong>Execute</strong>
              <span className="muted">Run a bounded deterministic program.</span>
            </div>
            <div className="step">
              <strong>Commit</strong>
              <span className="muted">Publish a trace root with a bond.</span>
            </div>
            <div className="step">
              <strong>Challenge</strong>
              <span className="muted">Narrow disagreement to one verified step.</span>
            </div>
          </div>
        </section>
        <section className="card pad">
          <div className="section-head">
            <h2>Verification context</h2>
            <Fingerprint size={18} aria-hidden="true" />
          </div>
          <p className="metric">VM v1</p>
          <p className="small muted">
            8 uint64 registers · 128 instruction limit · fixed execution budgets
          </p>
          <div className="verification-row">
            <ProofStatus verified={null} />
            <span className="small muted">No trace is loaded or verified</span>
          </div>
        </section>
      </div>
      <div style={{ marginTop: 18 }}>
        <div className="section-head">
          <h2>Recent activity</h2>
          <Link className="text-link" href="/account-ledger">
            Open account ledger <ArrowRight size={14} />
          </Link>
        </div>
        <ActivityTable rows={[]} />
      </div>
    </>
  );
}

function Listing({ section }: { section: "claims" | "disputes" }) {
  const isClaims = section === "claims";
  return (
    <>
      <PageHeader section={section} />
      <div className="grid" style={{ marginBottom: 18 }}>
        {(isClaims
          ? ["Open claims", "In challenge window", "Finalized"]
          : ["Active disputes", "Your turn", "Resolved"]
        ).map((label) => (
          <div className="card pad" key={label}>
            <p className="small muted">{label}</p>
            <p className="metric missing">Unavailable</p>
            <p className="small muted">Awaiting indexed Base Sepolia data</p>
          </div>
        ))}
      </div>
      <div className="section-head">
        <h2>
          {isClaims ? "Execution claims" : "Dispute activity"}
          <span className="small muted"> · public chain records</span>
        </h2>
        <Badge>Read only</Badge>
      </div>
      <ActivityTable
        rows={[]}
        emptyTitle={isClaims ? "No claims indexed" : "No disputes indexed"}
        emptyDetail="Connect to a configured registry and indexer to load confirmed public records."
      />
    </>
  );
}

export function SectionPage({ section }: { section: SectionKey }) {
  if (section === "overview")
    return (
      <div className="page">
        <Overview />
      </div>
    );
  if (section === "claims" || section === "disputes")
    return (
      <div className="page">
        <Listing section={section} />
      </div>
    );
  if (section === "program-studio")
    return (
      <div className="page">
        <PageHeader
          section={section}
          action={
            <Link className="button" href="/documentation">
              Read VM specification <ArrowRight size={15} />
            </Link>
          }
        />
        <ProgramStudio />
      </div>
    );
  if (section === "account-ledger")
    return (
      <div className="page">
        <PageHeader section={section} />
        <AccountLedger />
      </div>
    );
  if (section === "documentation")
    return (
      <div className="page">
        <PageHeader section={section} />
        <div className="grid two">
          {[
            {
              icon: BookOpenCheck,
              title: "Protocol v1",
              detail: "VM semantics, canonical encodings, Merkle commitments, and dispute rules.",
            },
            {
              icon: ShieldCheck,
              title: "Security model",
              detail: "Threat assumptions, data availability, timeouts, and known limitations.",
            },
            {
              icon: FileClock,
              title: "Developer setup",
              detail: "Run the deterministic VM and local development tools.",
            },
            {
              icon: Boxes,
              title: "Indexer & ledger",
              detail: "Read models, journal conventions, confirmation policy, and reconciliation.",
            },
          ].map(({ icon: Icon, title, detail }) => (
            <section className="card pad doc-card" key={title}>
              <Icon size={20} className="feature-icon" />
              <h2 style={{ marginTop: 16 }}>{title}</h2>
              <p className="small muted" style={{ marginTop: 8 }}>
                {detail}
              </p>
              <Badge tone="accent">Repository documentation</Badge>
            </section>
          ))}
        </div>
        <p className="small muted docs-note">
          Documentation pages are being connected to the repository sources.
        </p>
      </div>
    );
  return (
    <div className="page">
      <PageHeader section="settings" />
      <div className="grid two">
        <section className="card pad">
          <div className="section-head">
            <h2>Network</h2>
            <Badge tone="warn">Testnet</Badge>
          </div>
          <dl className="settings-list">
            <div>
              <dt>Target network</dt>
              <dd>Base Sepolia</dd>
            </div>
            <div>
              <dt>Chain ID</dt>
              <dd>84532</dd>
            </div>
            <div>
              <dt>Registry contract</dt>
              <dd>Not configured</dd>
            </div>
            <div>
              <dt>RPC endpoint</dt>
              <dd>Not exposed in browser</dd>
            </div>
          </dl>
        </section>
        <section className="card pad">
          <h2>Wallet security</h2>
          <p className="small muted" style={{ margin: "10px 0 18px" }}>
            Never share recovery phrases or private keys. Signing stays in your wallet.
          </p>
          <WalletSecurityNotice />
          <div style={{ marginTop: 18 }}>
            <SecurityDialog />
          </div>
        </section>
      </div>
      <StatePanel
        kind="empty"
        title="No saved preferences"
        detail="Theme preference is stored in this browser. Other settings are not connected yet."
      />
    </div>
  );
}
