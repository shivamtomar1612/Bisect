import type { PostingSide } from "./generated/prisma/client.js";

export interface LedgerLine {
  readonly accountCode: string;
  readonly accountName: string;
  readonly side: PostingSide;
  readonly amountWei: bigint;
}

export interface LedgerEntryPlan {
  readonly kind: "BOND_LOCK" | "BOND_TO_CREDIT" | "WITHDRAWAL";
  readonly lines: readonly LedgerLine[];
}

export function parseWei(value: unknown, field: string): bigint {
  if (typeof value !== "string" && typeof value !== "bigint") {
    throw new Error(`${field} must be an integer string.`);
  }
  const normalized = String(value);
  if (!/^(0|[1-9][0-9]*)$/.test(normalized)) throw new Error(`${field} is not canonical wei.`);
  return BigInt(normalized);
}

export function ensureBalanced(lines: readonly LedgerLine[]): void {
  if (lines.length < 2 || lines.some((line) => line.amountWei <= 0n)) {
    throw new Error("Journal entries require at least two positive postings.");
  }
  const debits = lines
    .filter((line) => line.side === "DEBIT")
    .reduce((sum, line) => sum + line.amountWei, 0n);
  const credits = lines
    .filter((line) => line.side === "CREDIT")
    .reduce((sum, line) => sum + line.amountWei, 0n);
  if (debits !== credits)
    throw new Error(`Unbalanced journal: debit ${debits}, credit ${credits}.`);
}

export function contractCustodyCode(chainId: number, contractAddress: string): string {
  return `evm:${chainId}:${contractAddress.toLowerCase()}:custody`;
}

export function proverLockedCode(
  chainId: number,
  contractAddress: string,
  claimId: string,
): string {
  return `evm:${chainId}:${contractAddress.toLowerCase()}:claim:${claimId}:prover-locked`;
}

export function challengerLockedCode(
  chainId: number,
  contractAddress: string,
  claimId: string,
  gameNumber: string,
): string {
  return `evm:${chainId}:${contractAddress.toLowerCase()}:claim:${claimId}:game:${gameNumber}:challenger-locked`;
}

export function walletCreditCode(
  chainId: number,
  contractAddress: string,
  address: string,
): string {
  return `evm:${chainId}:${contractAddress.toLowerCase()}:wallet:${address.toLowerCase()}:withdrawable`;
}

export function planBondLock(
  custody: string,
  liability: string,
  liabilityName: string,
  amountWei: bigint,
): LedgerEntryPlan {
  const plan: LedgerEntryPlan = {
    kind: "BOND_LOCK",
    lines: [
      { accountCode: custody, accountName: "Registry ETH custody", side: "DEBIT", amountWei },
      { accountCode: liability, accountName: liabilityName, side: "CREDIT", amountWei },
    ],
  };
  ensureBalanced(plan.lines);
  return plan;
}

export function planLiabilityTransfer(
  debits: readonly {
    readonly accountCode: string;
    readonly accountName: string;
    readonly amountWei: bigint;
  }[],
  creditAccount: string,
  creditName: string,
  amountWei: bigint,
): LedgerEntryPlan {
  const lines: LedgerLine[] = [
    ...debits.map((debit) => ({ ...debit, side: "DEBIT" as const })),
    { accountCode: creditAccount, accountName: creditName, side: "CREDIT", amountWei },
  ];
  const plan: LedgerEntryPlan = { kind: "BOND_TO_CREDIT", lines };
  ensureBalanced(plan.lines);
  return plan;
}

export function planWithdrawal(
  walletCredit: string,
  address: string,
  custody: string,
  amountWei: bigint,
): LedgerEntryPlan {
  const plan: LedgerEntryPlan = {
    kind: "WITHDRAWAL",
    lines: [
      {
        accountCode: walletCredit,
        accountName: `${address} withdrawable ETH liability`,
        side: "DEBIT",
        amountWei,
      },
      { accountCode: custody, accountName: "Registry ETH custody", side: "CREDIT", amountWei },
    ],
  };
  ensureBalanced(plan.lines);
  return plan;
}

export function reverseLines(lines: readonly LedgerLine[]): LedgerLine[] {
  return lines.map((line) => ({
    ...line,
    side: line.side === "DEBIT" ? "CREDIT" : "DEBIT",
  }));
}
