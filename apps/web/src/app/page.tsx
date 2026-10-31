import {
  ArrowDownRight,
  ArrowRight,
  Braces,
  Database,
  Fingerprint,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";

const stages = [
  {
    number: "01",
    title: "Execute off-chain",
    detail: "A bounded deterministic program runs outside the chain.",
  },
  {
    number: "02",
    title: "Commit to the trace",
    detail: "The prover publishes an ordered Merkle root and locks a bond.",
  },
  {
    number: "03",
    title: "Challenge a mismatch",
    detail: "A live challenger independently executes the same program and input.",
  },
  {
    number: "04",
    title: "Verify one step",
    detail: "Child-subtree hashes narrow the disagreement to one instruction.",
  },
];

function TraceDiagram() {
  const proverStates = [
    { key: "prover-s0", value: "S₀", disputed: false },
    { key: "prover-s1", value: "S₁", disputed: false },
    { key: "prover-s2", value: "S₂", disputed: true },
    { key: "prover-gap", value: "…", disputed: false },
    { key: "prover-sn", value: "Sₙ", disputed: false },
  ];
  const challengerStates = [
    { key: "challenger-s0", value: "S₀", disputed: false },
    { key: "challenger-s1", value: "S₁", disputed: false },
    { key: "challenger-s2", value: "S′₂", disputed: true },
    { key: "challenger-gap", value: "…", disputed: false },
    { key: "challenger-sn", value: "Sₙ", disputed: false },
  ];
  return (
    <figure className="trace-illustration">
      <div className="trace-card-head">
        <span>
          <span className="dot" /> Protocol model
        </span>
        <span>Off-chain trace</span>
      </div>
      <div className="trace-lanes">
        <div className="trace-lane-label">Prover</div>
        <ol className="trace-nodes" aria-label="Prover execution states">
          {proverStates.map((state) => (
            <li className={state.disputed ? "trace-node disputed" : "trace-node"} key={state.key}>
              {state.value}
            </li>
          ))}
        </ol>
        <div className="trace-root">
          <Fingerprint size={14} aria-hidden="true" /> Merkle root
        </div>
        <div className="trace-divider">
          <span>Authenticated child hashes narrow the interval</span>
        </div>
        <div className="trace-lane-label">Challenger</div>
        <ol className="trace-nodes" aria-label="Challenger execution states">
          {challengerStates.map((state) => (
            <li className={state.disputed ? "trace-node challenged" : "trace-node"} key={state.key}>
              {state.value}
            </li>
          ))}
        </ol>
        <div className="trace-root">
          <Fingerprint size={14} aria-hidden="true" /> Challenger root
        </div>
      </div>
      <div className="trace-result">
        <ArrowDownRight size={18} aria-hidden="true" />
        <div>
          <strong>One disputed transition</strong>
          <span>Only this step is recomputed and checked on-chain</span>
        </div>
        <ShieldCheck size={18} aria-hidden="true" />
      </div>
      <figcaption className="trace-caption">
        Illustrative protocol flow. No live claim or proof is shown.
      </figcaption>
    </figure>
  );
}

export default function LandingPage() {
  return (
    <div className="landing-page">
      <section className="landing-hero">
        <div className="landing-copy">
          <div className="landing-kicker">
            <span className="pulse-dot" /> BASE SEPOLIA · TESTNET PROTOTYPE
          </div>
          <h1>
            Make outsourced computation <span>publicly challengeable.</span>
          </h1>
          <p className="landing-lead">
            BISECT lets a prover run a bounded program off-chain, commit to its execution trace, and
            post a bond. A challenger can independently replay the same context and dispute an
            incorrect trace.
          </p>
          <div className="landing-actions">
            <Link className="button primary landing-primary" href="/dashboard">
              Open dashboard <ArrowRight size={16} />
            </Link>
            <Link className="button landing-secondary" href="/program-studio">
              Explore Program Studio <Braces size={16} />
            </Link>
          </div>
          <p className="landing-truth">
            Prototype for Base Sepolia · no configured public registry in this workspace · unaudited
            research software
          </p>
        </div>
        <TraceDiagram />
      </section>

      <section className="landing-process" aria-labelledby="process-title">
        <div className="landing-section-heading">
          <p className="eyebrow">Optimistic verification</p>
          <h2 id="process-title">Assume the result is correct. Keep a path to prove it wrong.</h2>
          <p className="lead">
            The chain does not replay the whole computation. It verifies a disputed transition after
            participants authenticate their traces.
          </p>
        </div>
        <ol className="process-grid">
          {stages.map((stage) => (
            <li className="process-card" key={stage.number}>
              <span className="process-number">{stage.number}</span>
              <h3>{stage.title}</h3>
              <p>{stage.detail}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="landing-boundaries" aria-label="Protocol assumptions">
        <article className="boundary-card">
          <Database size={19} aria-hidden="true" />
          <h3>Trace data must be available</h3>
          <p>
            A Merkle root authenticates data; it does not publish the data. Prover and challenger
            traces and proof nodes must remain retrievable during the challenge window.
          </p>
        </article>
        <article className="boundary-card">
          <ShieldCheck size={19} aria-hidden="true" />
          <h3>An active challenger matters</h3>
          <p>
            Optimistic verification relies on someone independently checking claims and responding
            before deadlines. Without an eligible challenger, an invalid claim may pass its window.
          </p>
        </article>
        <article className="boundary-card">
          <Fingerprint size={19} aria-hidden="true" />
          <h3>The context must match</h3>
          <p>
            Both traces are bound to the same program identity, public input, VM version, and
            execution budget. A different context is not evidence of a bad transition.
          </p>
        </article>
      </section>

      <section className="landing-cta">
        <div>
          <p className="eyebrow">Explore the protocol</p>
          <h2>Inspect the rules before the result.</h2>
          <p className="lead">
            Read the locked VM and dispute specifications, or inspect the read-only dashboard for
            confirmed indexed activity.
          </p>
        </div>
        <div className="landing-cta-actions">
          <Link className="text-link" href="/documentation">
            Read protocol documentation <ArrowRight size={15} />
          </Link>
          <Link className="text-link" href="/dashboard">
            View overview <ArrowRight size={15} />
          </Link>
        </div>
      </section>
    </div>
  );
}
