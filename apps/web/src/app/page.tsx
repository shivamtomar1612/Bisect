const components = [
  {
    name: "Deterministic VM",
    status: "Designing",
    detail: "Bounded instruction set and reproducible state",
  },
  {
    name: "Trace commitments",
    status: "Designing",
    detail: "Canonical encoding and Merkle proof format",
  },
  {
    name: "Dispute contract",
    status: "Not started",
    detail: "Bisection game and explicit bond accounting",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen px-6 py-10 sm:px-10 lg:px-16">
      <div className="mx-auto max-w-6xl">
        <header className="flex items-center justify-between border-b border-white/10 pb-6">
          <a className="text-sm font-semibold tracking-[0.22em] text-cyan-300" href="#top">
            BISECT
          </a>
          <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1 text-xs text-amber-100">
            Early development
          </span>
        </header>

        <section id="top" className="grid gap-12 py-20 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
          <div>
            <p className="mb-5 text-xs font-medium uppercase tracking-[0.24em] text-cyan-300/80">
              Optimistic computation verification
            </p>
            <h1 className="max-w-3xl text-5xl font-semibold leading-[1.05] tracking-tight sm:text-7xl">
              Make computation <span className="text-cyan-300">challengeable.</span>
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-8 text-slate-300">
              BISECT is being designed around bounded deterministic execution, committed traces, and
              an interactive game that can isolate a disputed instruction.
            </p>
            <p className="mt-5 max-w-xl text-sm leading-6 text-slate-400">
              This page reports the project stage only. No VM, proof, transaction, bond, or testnet
              integration is implemented yet.
            </p>
          </div>

          <aside className="rounded-2xl border border-white/10 bg-slate-900/70 p-6 shadow-2xl shadow-cyan-950/30">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-slate-200">Protocol foundation</h2>
              <span className="font-mono text-xs text-slate-400">BASE SEPOLIA</span>
            </div>
            <div className="mt-5 border-t border-white/10 pt-5">
              <p className="text-4xl font-semibold">84532</p>
              <p className="mt-1 text-xs text-slate-400">Target chain ID · not connected</p>
            </div>
            <ul className="mt-6 space-y-4">
              {components.map((component) => (
                <li key={component.name} className="flex gap-3">
                  <span className="mt-1.5 size-2 shrink-0 rounded-full bg-cyan-300" />
                  <div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <h3 className="text-sm font-medium">{component.name}</h3>
                      <span className="text-[11px] uppercase tracking-wide text-slate-500">
                        {component.status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-slate-400">{component.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </aside>
        </section>

        <footer className="flex flex-col gap-3 border-t border-white/10 py-6 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <p>Unaudited research software · no real funds</p>
          <a
            className="text-slate-300 underline decoration-white/20 underline-offset-4 hover:text-cyan-200"
            href="https://github.com/shivamtomar1612/Bisect"
          >
            Source repository
          </a>
        </footer>
      </div>
    </main>
  );
}
