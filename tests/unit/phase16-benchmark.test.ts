import { describe, expect, it } from "vitest";
import results from "../../docs/benchmarks/phase-16-results.json";

function sum(rows: readonly { readonly gasUsed: string }[]): bigint {
  return rows.reduce((total, row) => total + BigInt(row.gasUsed), 0n);
}

function sumValues(rows: readonly { readonly valueWei: string }[]): bigint {
  return rows.reduce((total, row) => total + BigInt(row.valueWei), 0n);
}

describe("Phase 16 measured benchmark artifact", () => {
  it("contains actual Anvil receipts for every approved budget and bisection depth", () => {
    expect(results.schema).toBe("bisect.phase16.benchmarks.v1");
    expect(results.environment.chainId).toBe(31337);
    expect(results.environment.chain).toContain("Local Anvil");
    expect(results.environment.deploymentIncludedInLifecycleTotals).toBe(false);
    expect(results.budgets.map((row) => row.budget)).toEqual([63, 255, 1023, 4095]);

    for (const row of results.budgets) {
      const depth = Math.log2(row.budget + 1);
      expect(row.measuredRounds).toBe(depth);
      expect(row.successfulDisputeLifecycle.transactionCount).toBe(5 + 2 * depth);
      expect(sum(row.successfulDisputeLifecycle.transactions)).toBe(
        BigInt(row.successfulDisputeLifecycle.gasUsed),
      );
      expect(
        row.successfulDisputeLifecycle.transactions.reduce(
          (total, tx) => total + BigInt(tx.gasCostWei),
          0n,
        ),
      ).toBe(BigInt(row.successfulDisputeLifecycle.gasCostWei));
      for (const tx of row.successfulDisputeLifecycle.transactions) {
        expect(BigInt(tx.gasCostWei)).toBe(BigInt(tx.gasUsed) * BigInt(tx.effectiveGasPriceWei));
      }
    }
  });

  it("keeps bond collateral separate and reconciles the measured escrow lifecycle", () => {
    expect(results.economics.bondIsCollateral).toBe(true);
    expect(results.economics.totalBondDepositsWei).toBe("18000000000000000");
    expect(results.economics.totalSettlementAndFinalizationCreditsWei).toBe(
      results.economics.totalBondDepositsWei,
    );
    expect(results.economics.confirmedWithdrawalsWei).toBe(results.economics.totalBondDepositsWei);
    expect(results.economics.finalLockedWei).toBe("0");
    expect(results.economics.finalCreditsWei).toBe("0");
    expect(results.economics.finalLiabilitiesWei).toBe("0");
    expect(BigInt(results.economics.finalContractBalanceWei)).toBeGreaterThanOrEqual(
      BigInt(results.economics.finalLiabilitiesWei),
    );
    expect(results.economics.solventAtEveryCheckedOperation).toBe(true);
    expect(sumValues(results.rawTransactions)).toBe(BigInt(results.economics.totalBondDepositsWei));
    expect(results.transactionCount).toBe(139);
    expect(results.totalMeasuredGasUnitsExcludingDeployments).toBe(
      sum(results.rawTransactions.filter((tx) => tx.group !== "setup")).toString(),
    );
  });
});
