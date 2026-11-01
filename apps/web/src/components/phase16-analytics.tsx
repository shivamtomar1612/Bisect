"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { formatWei } from "./format";
import { Badge, StatePanel } from "./ui";

type BudgetSample = {
  readonly budget: number;
  readonly directExecution: { readonly gasUsed: string };
  readonly honestClaimLifecycle: { readonly gasUsed: string };
  readonly successfulDisputeLifecycle: { readonly gasUsed: string };
  readonly measuredRounds: number;
};

type BenchmarkSnapshot = {
  readonly sampleDateUtc: string;
  readonly environment: { readonly chain: string; readonly chainId: number };
  readonly budgets: readonly BudgetSample[];
  readonly economics: {
    readonly totalBondDepositsWei: string;
    readonly peakLockedExposureWei: string;
    readonly confirmedWithdrawalsWei: string;
    readonly slashedCollateralWei: string;
    readonly solventAtEveryCheckedOperation: boolean;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decimal(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value);
}

function parseSnapshot(value: unknown): BenchmarkSnapshot | null {
  if (!isRecord(value)) return null;
  const environment = value["environment"];
  const economics = value["economics"];
  const budgets = value["budgets"];
  if (
    typeof value["sampleDateUtc"] !== "string" ||
    !isRecord(environment) ||
    typeof environment["chain"] !== "string" ||
    typeof environment["chainId"] !== "number" ||
    !isRecord(economics) ||
    !decimal(economics["totalBondDepositsWei"]) ||
    !decimal(economics["peakLockedExposureWei"]) ||
    !decimal(economics["confirmedWithdrawalsWei"]) ||
    !decimal(economics["slashedCollateralWei"]) ||
    typeof economics["solventAtEveryCheckedOperation"] !== "boolean" ||
    !Array.isArray(budgets)
  ) {
    return null;
  }
  const rows: BudgetSample[] = [];
  for (const candidate of budgets) {
    if (!isRecord(candidate)) return null;
    const direct = candidate["directExecution"];
    const honest = candidate["honestClaimLifecycle"];
    const disputed = candidate["successfulDisputeLifecycle"];
    if (
      typeof candidate["budget"] !== "number" ||
      typeof candidate["measuredRounds"] !== "number" ||
      !isRecord(direct) ||
      !decimal(direct["gasUsed"]) ||
      !isRecord(honest) ||
      !decimal(honest["gasUsed"]) ||
      !isRecord(disputed) ||
      !decimal(disputed["gasUsed"])
    ) {
      return null;
    }
    rows.push({
      budget: candidate["budget"],
      measuredRounds: candidate["measuredRounds"],
      directExecution: { gasUsed: direct["gasUsed"] },
      honestClaimLifecycle: { gasUsed: honest["gasUsed"] },
      successfulDisputeLifecycle: { gasUsed: disputed["gasUsed"] },
    });
  }
  return {
    sampleDateUtc: value["sampleDateUtc"],
    environment: { chain: environment["chain"], chainId: environment["chainId"] },
    budgets: rows,
    economics: {
      totalBondDepositsWei: economics["totalBondDepositsWei"],
      peakLockedExposureWei: economics["peakLockedExposureWei"],
      confirmedWithdrawalsWei: economics["confirmedWithdrawalsWei"],
      slashedCollateralWei: economics["slashedCollateralWei"],
      solventAtEveryCheckedOperation: economics["solventAtEveryCheckedOperation"],
    },
  };
}

export function Phase16Analytics() {
  const [snapshot, setSnapshot] = useState<BenchmarkSnapshot | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch("/benchmarks/phase-16-results.json", { cache: "force-cache" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Benchmark file is unavailable.");
        return (await response.json()) as unknown;
      })
      .then((value) => {
        const parsed = parseSnapshot(value);
        if (!parsed) throw new Error("Benchmark file failed validation.");
        if (active) setSnapshot(parsed);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="card pad phase16-analytics" aria-labelledby="phase16-heading">
      <div className="section-head">
        <div>
          <p className="eyebrow">Measured protocol economics</p>
          <h2 id="phase16-heading">Gas and computation scaling</h2>
          <p className="small muted">
            Local Anvil receipts. Bonds are collateral, shown separately from gas expense.
          </p>
        </div>
        <Badge tone="warn">Local benchmark · not Base Sepolia</Badge>
      </div>
      {snapshot ? (
        <>
          <p className="small muted phase16-sample">
            {snapshot.environment.chain} · chain {snapshot.environment.chainId} · sampled{" "}
            {new Date(snapshot.sampleDateUtc).toLocaleString()}
          </p>
          <div className="phase16-charts">
            <figure>
              <Image
                src="/benchmarks/phase-16-gas.svg"
                alt="Measured gas used for direct execution, optimistic claims without disputes, and successful disputed claims at four trace budgets."
                width={900}
                height={420}
                unoptimized
              />
              <figcaption>Receipt gas includes each listed lifecycle transaction.</figcaption>
            </figure>
            <figure>
              <Image
                src="/benchmarks/phase-16-rounds.svg"
                alt="Measured bisection rounds rise from six to twelve as supported trace budgets grow from 63 to 4,095 transitions."
                width={900}
                height={300}
                unoptimized
              />
              <figcaption>Rounds follow the authenticated binary trace depth.</figcaption>
            </figure>
          </div>
          <div className="table-scroll phase16-table-wrap">
            <table className="data-table phase16-table">
              <caption>Measured gas units by approved transition budget</caption>
              <thead>
                <tr>
                  <th scope="col">Transitions</th>
                  <th scope="col">Direct VM</th>
                  <th scope="col">Optimistic, no dispute</th>
                  <th scope="col">Successful dispute</th>
                  <th scope="col">Rounds</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.budgets.map((row) => (
                  <tr key={row.budget}>
                    <th scope="row">{row.budget.toLocaleString()}</th>
                    <td>{BigInt(row.directExecution.gasUsed).toLocaleString()}</td>
                    <td>{BigInt(row.honestClaimLifecycle.gasUsed).toLocaleString()}</td>
                    <td>{BigInt(row.successfulDisputeLifecycle.gasUsed).toLocaleString()}</td>
                    <td>{row.measuredRounds}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid phase16-ledger-metrics">
            <div>
              <span className="small muted">Bond deposits in benchmark run</span>
              <strong>{formatWei(snapshot.economics.totalBondDepositsWei)} ETH</strong>
            </div>
            <div>
              <span className="small muted">Peak locked exposure</span>
              <strong>{formatWei(snapshot.economics.peakLockedExposureWei)} ETH</strong>
            </div>
            <div>
              <span className="small muted">Withdrawals confirmed</span>
              <strong>{formatWei(snapshot.economics.confirmedWithdrawalsWei)} ETH</strong>
            </div>
            <div>
              <span className="small muted">Collateral redistributed</span>
              <strong>{formatWei(snapshot.economics.slashedCollateralWei)} ETH</strong>
            </div>
          </div>
          <p className="small muted phase16-solvency">
            {snapshot.economics.solventAtEveryCheckedOperation
              ? "Contract liabilities reconciled against its ETH balance after each measured financial operation."
              : "The benchmark reported a contract accounting discrepancy."}
          </p>
        </>
      ) : failed ? (
        <StatePanel
          kind="error"
          title="Benchmark data could not be loaded"
          detail="No measurements are shown until the generated result artifact is available and validates."
        />
      ) : (
        <StatePanel
          kind="loading"
          title="Loading measured results"
          detail="The dashboard is loading the latest checked-in Anvil receipt artifact."
        />
      )}
    </section>
  );
}
