import { bisectDisputeRegistryV1Abi } from "@bisect/sdk";
import { getAddress } from "viem";
import type { IndexerConfig } from "./config.js";
import { prisma } from "./database.js";
import type { Prisma } from "./generated/prisma/client.js";
import { getCanonicalClient } from "./indexer.js";

interface Mismatch {
  readonly key: string;
  readonly indexed: string;
  readonly chain: string;
}

async function sumAccountClass(
  chainId: number,
  contractAddress: string,
  blockNumber: bigint,
  accountType: "LOCKED_LIABILITY" | "WITHDRAWABLE_LIABILITY",
): Promise<bigint> {
  const rows = await prisma.$queryRaw<Array<{ balance: Prisma.Decimal }>>`
    SELECT COALESCE(SUM(
      CASE WHEN posting."side" = account."normalSide" THEN posting."amountWei" ELSE -posting."amountWei" END
    ), 0)::numeric AS balance
    FROM "JournalPosting" AS posting
    INNER JOIN "LedgerAccount" AS account ON account."id" = posting."accountId"
    INNER JOIN "JournalTransaction" AS journal ON journal."id" = posting."journalId"
    INNER JOIN "ChainEvent" AS event ON event."id" = journal."eventId" AND event."status" = 'CONFIRMED'::"ChainEventStatus"
    WHERE journal."chainId" = ${chainId}
      AND journal."contractAddress" = ${contractAddress.toLowerCase()}
      AND journal."blockNumber" <= ${blockNumber}
      AND account."type" = ${accountType}::"LedgerAccountType"
  `;
  return BigInt(rows[0]?.balance.toFixed(0) ?? "0");
}

async function walletCreditAt(
  walletId: string,
  chainId: number,
  contractAddress: string,
  blockNumber: bigint,
): Promise<bigint> {
  const rows = await prisma.$queryRaw<Array<{ balance: Prisma.Decimal }>>`
    SELECT COALESCE(SUM(
      CASE WHEN posting."side" = account."normalSide" THEN posting."amountWei" ELSE -posting."amountWei" END
    ), 0)::numeric AS balance
    FROM "JournalPosting" AS posting
    INNER JOIN "LedgerAccount" AS account ON account."id" = posting."accountId"
    INNER JOIN "JournalTransaction" AS journal ON journal."id" = posting."journalId"
    INNER JOIN "ChainEvent" AS event ON event."id" = journal."eventId" AND event."status" = 'CONFIRMED'::"ChainEventStatus"
    WHERE journal."chainId" = ${chainId}
      AND journal."contractAddress" = ${contractAddress.toLowerCase()}
      AND journal."blockNumber" <= ${blockNumber}
      AND account."walletId" = ${walletId}
      AND account."type" = 'WITHDRAWABLE_LIABILITY'::"LedgerAccountType"
  `;
  return BigInt(rows[0]?.balance.toFixed(0) ?? "0");
}

export interface ReconciliationResult {
  readonly id: string;
  readonly chainId: number;
  readonly blockNumber: string;
  readonly blockHash: string;
  readonly status: "MATCH" | "MISMATCH" | "FAILED";
  readonly discrepancies: readonly Mismatch[];
  readonly contractBalanceWei: string;
  readonly unallocatedSurplusWei: string;
  readonly indexedLockedWei: string;
  readonly indexedCreditsWei: string;
}

async function storeFailedReconciliation(
  config: IndexerConfig,
  blockNumber: bigint,
  blockHash: string,
  key: string,
  description: string,
): Promise<ReconciliationResult> {
  const discrepancies: Mismatch[] = [
    { key, indexed: "unavailable", chain: description.slice(0, 500) },
  ];
  const discrepancyPayload: Prisma.InputJsonArray = discrepancies.map(
    (item): Prisma.InputJsonValue => ({
      key: item.key,
      indexed: item.indexed,
      chain: item.chain,
    }),
  );
  const stored = await prisma.reconciliationRun.create({
    data: {
      chainId: config.chainId,
      contractAddress: config.contractAddress.toLowerCase(),
      blockNumber,
      blockHash,
      contractBalanceWei: "0",
      contractLockedWei: "0",
      contractCreditsWei: "0",
      contractLiabilitiesWei: "0",
      indexedLockedWei: "0",
      indexedCreditsWei: "0",
      status: "FAILED",
      discrepancies: discrepancyPayload,
    },
  });
  return {
    id: stored.id.toString(),
    chainId: config.chainId,
    blockNumber: stored.blockNumber.toString(),
    blockHash: stored.blockHash,
    status: "FAILED",
    discrepancies,
    contractBalanceWei: "0",
    unallocatedSurplusWei: "0",
    indexedLockedWei: "0",
    indexedCreditsWei: "0",
  };
}

export async function reconcileLedger(config: IndexerConfig): Promise<ReconciliationResult> {
  const checkpoint = await prisma.indexerCheckpoint.findUnique({
    where: {
      chainId_contractAddress: {
        chainId: config.chainId,
        contractAddress: config.contractAddress.toLowerCase(),
      },
    },
  });
  if (checkpoint === null || checkpoint.confirmedBlock < config.deploymentBlock) {
    throw new Error("Indexer has not confirmed the configured registry deployment block yet.");
  }
  const block = await prisma.chainBlock.findFirst({
    where: {
      chainId: config.chainId,
      blockNumber: checkpoint.confirmedBlock,
      status: "CONFIRMED",
    },
    orderBy: { id: "desc" },
  });
  if (block === null) {
    return storeFailedReconciliation(
      config,
      checkpoint.confirmedBlock,
      checkpoint.lastBlockHash,
      "checkpoint_block_missing",
      "Confirmed checkpoint block is missing from the canonical block table.",
    );
  }
  const client = await getCanonicalClient(config);
  let canonical: Awaited<ReturnType<typeof client.getBlock>>;
  try {
    canonical = await client.getBlock({ blockNumber: checkpoint.confirmedBlock });
  } catch (error) {
    const description =
      error instanceof Error ? error.message : "Canonical block RPC request failed.";
    return storeFailedReconciliation(
      config,
      checkpoint.confirmedBlock,
      block.hash,
      "canonical_block_unavailable",
      description,
    );
  }
  if (canonical.hash === null || canonical.hash.toLowerCase() !== block.hash.toLowerCase()) {
    return storeFailedReconciliation(
      config,
      checkpoint.confirmedBlock,
      block.hash,
      "checkpoint_hash_mismatch",
      "Checkpoint block hash differs from the chain; run the indexer before reconciliation.",
    );
  }

  const discrepancies: Mismatch[] = [];
  let contractBalance = 0n;
  let contractLocked = 0n;
  let contractCredits = 0n;
  let contractLiabilities = 0n;
  let indexedLocked = 0n;
  let indexedCredits = 0n;
  try {
    const [balance, locked, credits, liabilities, invariant] = await Promise.all([
      client.getBalance({
        address: config.contractAddress,
        blockNumber: checkpoint.confirmedBlock,
      }),
      client.readContract({
        address: config.contractAddress,
        abi: bisectDisputeRegistryV1Abi,
        functionName: "totalLockedBonds",
        blockNumber: checkpoint.confirmedBlock,
      }),
      client.readContract({
        address: config.contractAddress,
        abi: bisectDisputeRegistryV1Abi,
        functionName: "totalCredits",
        blockNumber: checkpoint.confirmedBlock,
      }),
      client.readContract({
        address: config.contractAddress,
        abi: bisectDisputeRegistryV1Abi,
        functionName: "totalLiabilities",
        blockNumber: checkpoint.confirmedBlock,
      }),
      client.readContract({
        address: config.contractAddress,
        abi: bisectDisputeRegistryV1Abi,
        functionName: "accountingInvariantHolds",
        blockNumber: checkpoint.confirmedBlock,
      }),
    ]);
    contractBalance = balance;
    contractLocked = locked;
    contractCredits = credits;
    contractLiabilities = liabilities;
    indexedLocked = await sumAccountClass(
      config.chainId,
      config.contractAddress,
      checkpoint.confirmedBlock,
      "LOCKED_LIABILITY",
    );
    indexedCredits = await sumAccountClass(
      config.chainId,
      config.contractAddress,
      checkpoint.confirmedBlock,
      "WITHDRAWABLE_LIABILITY",
    );
    if (indexedLocked !== contractLocked)
      discrepancies.push({
        key: "locked_liabilities",
        indexed: indexedLocked.toString(),
        chain: contractLocked.toString(),
      });
    if (indexedCredits !== contractCredits)
      discrepancies.push({
        key: "withdrawable_liabilities",
        indexed: indexedCredits.toString(),
        chain: contractCredits.toString(),
      });
    if (contractLiabilities !== contractLocked + contractCredits)
      discrepancies.push({
        key: "contract_liability_identity",
        indexed: (contractLocked + contractCredits).toString(),
        chain: contractLiabilities.toString(),
      });
    if (contractBalance < contractLiabilities || !invariant)
      discrepancies.push({
        key: "contract_solvency",
        indexed: contractBalance.toString(),
        chain: contractLiabilities.toString(),
      });

    const [duplicateRows, unbalancedRows] = await Promise.all([
      prisma.$queryRaw<Array<{ count: string }>>`
        SELECT COUNT(*)::text AS count FROM (
          SELECT posting."journalId", posting."accountId", posting."side", posting."amountWei"
          FROM "JournalPosting" AS posting
          INNER JOIN "JournalTransaction" AS journal ON journal."id" = posting."journalId"
          WHERE journal."chainId" = ${config.chainId}
            AND journal."contractAddress" = ${config.contractAddress.toLowerCase()}
          GROUP BY posting."journalId", posting."accountId", posting."side", posting."amountWei"
          HAVING COUNT(*) > 1
        ) AS duplicates
      `,
      prisma.$queryRaw<Array<{ count: string }>>`
        SELECT COUNT(*)::text AS count FROM (
          SELECT journal."id"
          FROM "JournalTransaction" AS journal
          INNER JOIN "JournalPosting" AS posting ON posting."journalId" = journal."id"
          WHERE journal."chainId" = ${config.chainId}
            AND journal."contractAddress" = ${config.contractAddress.toLowerCase()}
          GROUP BY journal."id"
          HAVING COUNT(*) < 2 OR
            SUM(CASE WHEN posting."side" = 'DEBIT' THEN posting."amountWei" ELSE 0 END) <>
            SUM(CASE WHEN posting."side" = 'CREDIT' THEN posting."amountWei" ELSE 0 END)
        ) AS unbalanced
      `,
    ]);
    const duplicateCount = BigInt(duplicateRows[0]?.count ?? "0");
    const unbalancedCount = BigInt(unbalancedRows[0]?.count ?? "0");
    if (duplicateCount > 0n)
      discrepancies.push({
        key: "duplicate_journal_postings",
        indexed: duplicateCount.toString(),
        chain: "0",
      });
    if (unbalancedCount > 0n)
      discrepancies.push({
        key: "unbalanced_journals",
        indexed: unbalancedCount.toString(),
        chain: "0",
      });

    const wallets = await prisma.walletAccount.findMany({
      where: { chainId: config.chainId },
      orderBy: { address: "asc" },
      take: 1_001,
    });
    if (wallets.length > 1_000) {
      discrepancies.push({
        key: "wallet_reconciliation_limit",
        indexed: wallets.length.toString(),
        chain: "maximum 1000 wallets per run",
      });
    } else {
      const walletResults = await Promise.all(
        wallets.map(async (wallet) => {
          const [chainCredit, indexedCredit] = await Promise.all([
            client.readContract({
              address: config.contractAddress,
              abi: bisectDisputeRegistryV1Abi,
              functionName: "withdrawableCredit",
              args: [getAddress(wallet.address)],
              blockNumber: checkpoint.confirmedBlock,
            }),
            walletCreditAt(
              wallet.id,
              config.chainId,
              config.contractAddress,
              checkpoint.confirmedBlock,
            ),
          ]);
          return { address: wallet.address, chainCredit, indexedCredit };
        }),
      );
      for (const row of walletResults) {
        if (row.chainCredit !== row.indexedCredit) {
          discrepancies.push({
            key: `wallet_credit:${row.address}`,
            indexed: row.indexedCredit.toString(),
            chain: row.chainCredit.toString(),
          });
        }
      }
    }
  } catch (error) {
    const description =
      error instanceof Error ? error.message : "Unclassified RPC/database reconciliation failure.";
    discrepancies.push({
      key: "reconciliation_execution",
      indexed: "unavailable",
      chain: description.slice(0, 500),
    });
  }
  const status =
    discrepancies.length === 0
      ? "MATCH"
      : discrepancies.some((item) => item.key === "reconciliation_execution")
        ? "FAILED"
        : "MISMATCH";
  const discrepancyPayload: Prisma.InputJsonArray = discrepancies.map(
    (item): Prisma.InputJsonValue => ({
      key: item.key,
      indexed: item.indexed,
      chain: item.chain,
    }),
  );
  const stored = await prisma.reconciliationRun.create({
    data: {
      chainId: config.chainId,
      contractAddress: config.contractAddress.toLowerCase(),
      blockNumber: checkpoint.confirmedBlock,
      blockHash: block.hash,
      contractBalanceWei: contractBalance.toString(),
      contractLockedWei: contractLocked.toString(),
      contractCreditsWei: contractCredits.toString(),
      contractLiabilitiesWei: contractLiabilities.toString(),
      indexedLockedWei: indexedLocked.toString(),
      indexedCreditsWei: indexedCredits.toString(),
      status,
      discrepancies: discrepancyPayload,
    },
  });
  return {
    id: stored.id.toString(),
    chainId: stored.chainId,
    blockNumber: stored.blockNumber.toString(),
    blockHash: stored.blockHash,
    status,
    discrepancies,
    contractBalanceWei: contractBalance.toString(),
    unallocatedSurplusWei:
      contractBalance >= contractLiabilities
        ? (contractBalance - contractLiabilities).toString()
        : "0",
    indexedLockedWei: indexedLocked.toString(),
    indexedCreditsWei: indexedCredits.toString(),
  };
}
