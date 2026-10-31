import { describe, expect, it } from "vitest";
import { loadIndexerConfig } from "../../apps/indexer/src/config.js";
import {
  challengerLockedCode,
  contractCustodyCode,
  ensureBalanced,
  parseWei,
  planBondLock,
  planLiabilityTransfer,
  planWithdrawal,
  proverLockedCode,
  reverseLines,
  walletCreditCode,
} from "../../apps/indexer/src/ledger.js";

describe("Phase 8 double-entry ledger primitives", () => {
  it("uses exact integer strings across the uint256 wei range", () => {
    const amount = (1n << 256n) - 1n;
    expect(parseWei(amount.toString(), "amount")).toBe(amount);
    expect(() => parseWei(9_007_199_254_740_992, "amount")).toThrow(/integer string/);
    expect(() => parseWei("01", "amount")).toThrow(/canonical wei/);
    expect(() => parseWei("1.0", "amount")).toThrow(/canonical wei/);
  });

  it("debits ETH custody once when a prover bond is received and locked", () => {
    const amount = 1_000_000_000_000_000_000n;
    const plan = planBondLock(
      contractCustodyCode(31337, "0x0000000000000000000000000000000000000001"),
      proverLockedCode(31337, "0x0000000000000000000000000000000000000001", "1"),
      "Claim 1 prover bond locked",
      amount,
    );
    expect(plan.lines.map((line) => [line.side, line.amountWei])).toEqual([
      ["DEBIT", amount],
      ["CREDIT", amount],
    ]);
    expect(plan.kind).toBe("BOND_LOCK");
  });

  it("moves one or both locked bonds into a credit without creating assets", () => {
    const bond = 5n;
    const plan = planLiabilityTransfer(
      [
        { accountCode: "prover", accountName: "prover bond", amountWei: bond },
        { accountCode: "challenger", accountName: "challenger bond", amountWei: bond },
      ],
      walletCreditCode(
        31337,
        "0x0000000000000000000000000000000000000001",
        "0x0000000000000000000000000000000000000002",
      ),
      "challenger credit",
      2n * bond,
    );
    expect(
      plan.lines.reduce((sum, line) => sum + (line.side === "DEBIT" ? line.amountWei : 0n), 0n),
    ).toBe(10n);
    expect(
      plan.lines.reduce((sum, line) => sum + (line.side === "CREDIT" ? line.amountWei : 0n), 0n),
    ).toBe(10n);
    expect(plan.kind).toBe("BOND_TO_CREDIT");
  });

  it("records withdrawal as a liability debit and custody asset credit", () => {
    const amount = 7_654_321_098_765_432_109n;
    const plan = planWithdrawal(
      "wallet-credit",
      "0x0000000000000000000000000000000000000003",
      "registry-custody",
      amount,
    );
    expect(plan.lines[0]?.side).toBe("DEBIT");
    expect(plan.lines[1]?.side).toBe("CREDIT");
    expect(plan.lines[0]?.amountWei).toBe(amount);
    expect(plan.lines[1]?.amountWei).toBe(amount);
  });

  it("reverses each posting side and rejects an unbalanced entry", () => {
    const original = [
      { accountCode: "asset", accountName: "asset", side: "DEBIT" as const, amountWei: 12n },
      {
        accountCode: "liability",
        accountName: "liability",
        side: "CREDIT" as const,
        amountWei: 12n,
      },
    ];
    expect(reverseLines(original).map((line) => line.side)).toEqual(["CREDIT", "DEBIT"]);
    const asset = original[0];
    const liability = original[1];
    if (asset === undefined || liability === undefined)
      throw new Error("Test journal is incomplete.");
    expect(() => ensureBalanced([{ ...asset, amountWei: 11n }, liability])).toThrow(/Unbalanced/);
  });

  it("isolates challenger locked-bond accounts by claim and game", () => {
    const first = challengerLockedCode(
      84532,
      "0x0000000000000000000000000000000000000001",
      "4",
      "1",
    );
    const second = challengerLockedCode(
      84532,
      "0x0000000000000000000000000000000000000001",
      "4",
      "2",
    );
    expect(first).not.toBe(second);
  });
});

describe("Phase 8 indexer configuration", () => {
  const valid: NodeJS.ProcessEnv = {
    INDEXER_RPC_URL: "http://127.0.0.1:8545",
    INDEXER_CHAIN_ID: "31337",
    INDEXER_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
    INDEXER_DEPLOYMENT_BLOCK: "12",
  };

  it("requires an explicit RPC, chain, registry and deployment block", () => {
    const config = loadIndexerConfig(valid);
    expect(config.chainId).toBe(31337);
    expect(config.deploymentBlock).toBe(12n);
    expect(config.confirmations).toBe(6n);
    expect(config.contractAddress.toLowerCase()).toBe("0x0000000000000000000000000000000000000001");
  });

  it("requires at least one confirmation before treating chain observations as confirmed", () => {
    expect(() => loadIndexerConfig({ ...valid, INDEXER_CONFIRMATIONS: "0" })).toThrow(
      /greater than zero/,
    );
    expect(loadIndexerConfig({ ...valid, INDEXER_CONFIRMATIONS: "1" }).confirmations).toBe(1n);
  });

  it("rejects incomplete and invalid network configuration", () => {
    expect(() => loadIndexerConfig({})).toThrow(/INDEXER_RPC_URL/);
    expect(() => loadIndexerConfig({ ...valid, INDEXER_RPC_URL: "file:///tmp/rpc" })).toThrow(
      /HTTP or HTTPS/,
    );
    expect(() => loadIndexerConfig({ ...valid, INDEXER_CHAIN_ID: "8453.2" })).toThrow(/integer/);
    expect(() => loadIndexerConfig({ ...valid, INDEXER_DEPLOYMENT_BLOCK: "1e3" })).toThrow(
      /decimal integer/,
    );
    expect(() => loadIndexerConfig({ ...valid, INDEXER_CONTRACT_ADDRESS: "0xdead" })).toThrow(
      /address/,
    );
  });
});
