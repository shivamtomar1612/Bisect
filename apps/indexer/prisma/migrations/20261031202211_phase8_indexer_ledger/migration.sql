-- CreateEnum
CREATE TYPE "BlockStatus" AS ENUM ('OBSERVED', 'CONFIRMED', 'ORPHANED');

-- CreateEnum
CREATE TYPE "ChainEventStatus" AS ENUM ('OBSERVED', 'CONFIRMED', 'ORPHANED');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('OPEN', 'GAME_ACTIVE', 'FINALIZED', 'REFUTED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('ACTIVE', 'PROVER_WON', 'CHALLENGER_WON', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "BondKind" AS ENUM ('PROVER', 'CHALLENGER');

-- CreateEnum
CREATE TYPE "DepositStatus" AS ENUM ('LOCKED', 'RELEASED', 'SLASHED');

-- CreateEnum
CREATE TYPE "SettlementKind" AS ENUM ('CLAIM_FINALIZATION', 'GAME_CREDIT');

-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('ASSET', 'LOCKED_LIABILITY', 'WITHDRAWABLE_LIABILITY');

-- CreateEnum
CREATE TYPE "PostingSide" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "JournalKind" AS ENUM ('BOND_LOCK', 'BOND_TO_CREDIT', 'WITHDRAWAL', 'REORG_REVERSAL');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('MATCH', 'MISMATCH', 'FAILED');

-- CreateTable
CREATE TABLE "WalletAccount" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "address" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChainBlock" (
    "id" BIGSERIAL NOT NULL,
    "chainId" INTEGER NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "hash" TEXT NOT NULL,
    "parentHash" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3),
    "status" "BlockStatus" NOT NULL DEFAULT 'OBSERVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChainBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChainEvent" (
    "id" BIGSERIAL NOT NULL,
    "chainId" INTEGER NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockHash" TEXT NOT NULL,
    "transactionHash" TEXT NOT NULL,
    "transactionIndex" INTEGER NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "ChainEventStatus" NOT NULL DEFAULT 'OBSERVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChainEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndexerCheckpoint" (
    "chainId" INTEGER NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "deploymentBlock" BIGINT NOT NULL,
    "lastBlockNumber" BIGINT NOT NULL,
    "lastBlockHash" TEXT NOT NULL,
    "confirmedBlock" BIGINT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndexerCheckpoint_pkey" PRIMARY KEY ("chainId","contractAddress")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "claimId" DECIMAL(78,0) NOT NULL,
    "proverWalletId" TEXT NOT NULL,
    "contextHash" TEXT NOT NULL,
    "traceRoot" TEXT NOT NULL,
    "transitionCount" INTEGER NOT NULL,
    "claimedOutput" TEXT NOT NULL,
    "challengeDeadline" BIGINT NOT NULL,
    "submittedBlock" BIGINT NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'OPEN',
    "sourceEventId" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "claimRecordId" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "claimId" DECIMAL(78,0) NOT NULL,
    "gameNumber" DECIMAL(78,0) NOT NULL,
    "challengerWalletId" TEXT NOT NULL,
    "challengerRoot" TEXT NOT NULL,
    "initialHeight" INTEGER NOT NULL,
    "expectedResponder" TEXT NOT NULL,
    "deadlineBlock" BIGINT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'ACTIVE',
    "outcome" INTEGER,
    "sourceEventId" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BondDeposit" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "claimRecordId" TEXT NOT NULL,
    "disputeId" TEXT,
    "walletId" TEXT NOT NULL,
    "kind" "BondKind" NOT NULL,
    "amountWei" DECIMAL(78,0) NOT NULL,
    "status" "DepositStatus" NOT NULL DEFAULT 'LOCKED',
    "eventId" BIGINT NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "transactionHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BondDeposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BondAllocation" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "claimRecordId" TEXT NOT NULL,
    "disputeId" TEXT,
    "allocationType" TEXT NOT NULL,
    "amountWei" DECIMAL(78,0) NOT NULL,
    "eventId" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BondAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settlement" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "claimRecordId" TEXT NOT NULL,
    "disputeId" TEXT,
    "beneficiaryWalletId" TEXT NOT NULL,
    "kind" "SettlementKind" NOT NULL,
    "outcome" INTEGER,
    "amountWei" DECIMAL(78,0) NOT NULL,
    "eventId" BIGINT NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "transactionHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Withdrawal" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "amountWei" DECIMAL(78,0) NOT NULL,
    "eventId" BIGINT NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "transactionHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Withdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerAccount" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "chainId" INTEGER,
    "contractAddress" TEXT,
    "walletId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalTransaction" (
    "id" BIGSERIAL NOT NULL,
    "chainId" INTEGER NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "eventId" BIGINT,
    "transactionHash" TEXT NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockHash" TEXT NOT NULL,
    "kind" "JournalKind" NOT NULL,
    "reversalOfId" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalPosting" (
    "id" BIGSERIAL NOT NULL,
    "journalId" BIGINT NOT NULL,
    "accountId" TEXT NOT NULL,
    "side" "PostingSide" NOT NULL,
    "amountWei" DECIMAL(78,0) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalPosting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationRun" (
    "id" BIGSERIAL NOT NULL,
    "chainId" INTEGER NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockHash" TEXT NOT NULL,
    "contractBalanceWei" DECIMAL(78,0) NOT NULL,
    "contractLockedWei" DECIMAL(78,0) NOT NULL,
    "contractCreditsWei" DECIMAL(78,0) NOT NULL,
    "contractLiabilitiesWei" DECIMAL(78,0) NOT NULL,
    "indexedLockedWei" DECIMAL(78,0) NOT NULL,
    "indexedCreditsWei" DECIMAL(78,0) NOT NULL,
    "status" "ReconciliationStatus" NOT NULL,
    "discrepancies" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconciliationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WalletAccount_address_idx" ON "WalletAccount"("address");

-- CreateIndex
CREATE UNIQUE INDEX "WalletAccount_chainId_address_key" ON "WalletAccount"("chainId", "address");

-- CreateIndex
CREATE INDEX "ChainBlock_chainId_blockNumber_status_idx" ON "ChainBlock"("chainId", "blockNumber", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ChainBlock_chainId_hash_key" ON "ChainBlock"("chainId", "hash");

-- CreateIndex
CREATE UNIQUE INDEX "ChainBlock_chainId_blockNumber_hash_key" ON "ChainBlock"("chainId", "blockNumber", "hash");

-- CreateIndex
CREATE INDEX "ChainEvent_chainId_contractAddress_blockNumber_logIndex_idx" ON "ChainEvent"("chainId", "contractAddress", "blockNumber", "logIndex");

-- CreateIndex
CREATE INDEX "ChainEvent_status_blockNumber_idx" ON "ChainEvent"("status", "blockNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ChainEvent_chainId_blockHash_transactionHash_logIndex_key" ON "ChainEvent"("chainId", "blockHash", "transactionHash", "logIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Claim_sourceEventId_key" ON "Claim"("sourceEventId");

-- CreateIndex
CREATE INDEX "Claim_proverWalletId_submittedBlock_idx" ON "Claim"("proverWalletId", "submittedBlock");

-- CreateIndex
CREATE INDEX "Claim_chainId_contractAddress_status_idx" ON "Claim"("chainId", "contractAddress", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Claim_chainId_contractAddress_claimId_key" ON "Claim"("chainId", "contractAddress", "claimId");

-- CreateIndex
CREATE UNIQUE INDEX "Dispute_sourceEventId_key" ON "Dispute"("sourceEventId");

-- CreateIndex
CREATE INDEX "Dispute_challengerWalletId_createdAt_idx" ON "Dispute"("challengerWalletId", "createdAt");

-- CreateIndex
CREATE INDEX "Dispute_status_deadlineBlock_idx" ON "Dispute"("status", "deadlineBlock");

-- CreateIndex
CREATE UNIQUE INDEX "Dispute_chainId_contractAddress_claimId_gameNumber_key" ON "Dispute"("chainId", "contractAddress", "claimId", "gameNumber");

-- CreateIndex
CREATE UNIQUE INDEX "BondDeposit_eventId_key" ON "BondDeposit"("eventId");

-- CreateIndex
CREATE INDEX "BondDeposit_chainId_contractAddress_claimRecordId_status_idx" ON "BondDeposit"("chainId", "contractAddress", "claimRecordId", "status");

-- CreateIndex
CREATE INDEX "BondDeposit_walletId_blockNumber_idx" ON "BondDeposit"("walletId", "blockNumber");

-- CreateIndex
CREATE INDEX "BondAllocation_claimRecordId_createdAt_idx" ON "BondAllocation"("claimRecordId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BondAllocation_eventId_allocationType_key" ON "BondAllocation"("eventId", "allocationType");

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_eventId_key" ON "Settlement"("eventId");

-- CreateIndex
CREATE INDEX "Settlement_beneficiaryWalletId_blockNumber_idx" ON "Settlement"("beneficiaryWalletId", "blockNumber");

-- CreateIndex
CREATE INDEX "Settlement_claimRecordId_blockNumber_idx" ON "Settlement"("claimRecordId", "blockNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Withdrawal_eventId_key" ON "Withdrawal"("eventId");

-- CreateIndex
CREATE INDEX "Withdrawal_walletId_blockNumber_idx" ON "Withdrawal"("walletId", "blockNumber");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_code_key" ON "LedgerAccount"("code");

-- CreateIndex
CREATE INDEX "LedgerAccount_chainId_type_idx" ON "LedgerAccount"("chainId", "type");

-- CreateIndex
CREATE INDEX "LedgerAccount_walletId_type_idx" ON "LedgerAccount"("walletId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "JournalTransaction_eventId_key" ON "JournalTransaction"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "JournalTransaction_reversalOfId_key" ON "JournalTransaction"("reversalOfId");

-- CreateIndex
CREATE INDEX "JournalTransaction_chainId_contractAddress_blockNumber_idx" ON "JournalTransaction"("chainId", "contractAddress", "blockNumber");

-- CreateIndex
CREATE INDEX "JournalTransaction_transactionHash_idx" ON "JournalTransaction"("transactionHash");

-- CreateIndex
CREATE INDEX "JournalPosting_accountId_journalId_idx" ON "JournalPosting"("accountId", "journalId");

-- CreateIndex
CREATE INDEX "ReconciliationRun_chainId_contractAddress_blockNumber_idx" ON "ReconciliationRun"("chainId", "contractAddress", "blockNumber");

-- AddForeignKey
ALTER TABLE "ChainEvent" ADD CONSTRAINT "ChainEvent_chainId_blockHash_fkey" FOREIGN KEY ("chainId", "blockHash") REFERENCES "ChainBlock"("chainId", "hash") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_proverWalletId_fkey" FOREIGN KEY ("proverWalletId") REFERENCES "WalletAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_claimRecordId_fkey" FOREIGN KEY ("claimRecordId") REFERENCES "Claim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_challengerWalletId_fkey" FOREIGN KEY ("challengerWalletId") REFERENCES "WalletAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BondDeposit" ADD CONSTRAINT "BondDeposit_claimRecordId_fkey" FOREIGN KEY ("claimRecordId") REFERENCES "Claim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BondDeposit" ADD CONSTRAINT "BondDeposit_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BondDeposit" ADD CONSTRAINT "BondDeposit_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "WalletAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BondAllocation" ADD CONSTRAINT "BondAllocation_claimRecordId_fkey" FOREIGN KEY ("claimRecordId") REFERENCES "Claim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BondAllocation" ADD CONSTRAINT "BondAllocation_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_claimRecordId_fkey" FOREIGN KEY ("claimRecordId") REFERENCES "Claim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_beneficiaryWalletId_fkey" FOREIGN KEY ("beneficiaryWalletId") REFERENCES "WalletAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "WalletAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "WalletAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalTransaction" ADD CONSTRAINT "JournalTransaction_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "JournalTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalPosting" ADD CONSTRAINT "JournalPosting_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "JournalTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalPosting" ADD CONSTRAINT "JournalPosting_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Exact non-negative integer amounts; PostgreSQL NUMERIC is intentionally used rather than BIGINT
-- because EVM uint256 wei values can exceed PostgreSQL's signed 64-bit integer range.
ALTER TABLE "BondDeposit" ADD CONSTRAINT "BondDeposit_amountWei_positive" CHECK ("amountWei" > 0);
ALTER TABLE "BondAllocation" ADD CONSTRAINT "BondAllocation_amountWei_positive" CHECK ("amountWei" > 0);
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_amountWei_positive" CHECK ("amountWei" > 0);
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_amountWei_positive" CHECK ("amountWei" > 0);
ALTER TABLE "JournalPosting" ADD CONSTRAINT "JournalPosting_amountWei_positive" CHECK ("amountWei" > 0);
ALTER TABLE "ReconciliationRun" ADD CONSTRAINT "ReconciliationRun_amounts_nonnegative" CHECK (
  "contractBalanceWei" >= 0 AND "contractLockedWei" >= 0 AND "contractCreditsWei" >= 0
  AND "contractLiabilitiesWei" >= 0 AND "indexedLockedWei" >= 0 AND "indexedCreditsWei" >= 0
);

CREATE FUNCTION "bisect_assert_journal_balanced"() RETURNS trigger AS $$
DECLARE
  target_journal_id BIGINT;
  posting_count BIGINT;
  debit_total NUMERIC;
  credit_total NUMERIC;
BEGIN
  target_journal_id := NEW."journalId";
  SELECT COUNT(*),
         COALESCE(SUM(CASE WHEN "side" = 'DEBIT' THEN "amountWei" ELSE 0 END), 0),
         COALESCE(SUM(CASE WHEN "side" = 'CREDIT' THEN "amountWei" ELSE 0 END), 0)
    INTO posting_count, debit_total, credit_total
    FROM "JournalPosting"
   WHERE "journalId" = target_journal_id;
  IF posting_count < 2 OR debit_total <> credit_total THEN
    RAISE EXCEPTION 'journal % is not balanced (postings %, debit %, credit %)',
      target_journal_id, posting_count, debit_total, credit_total;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "JournalPosting_balanced_deferred"
AFTER INSERT ON "JournalPosting"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "bisect_assert_journal_balanced"();

CREATE FUNCTION "bisect_assert_journal_has_postings"() RETURNS trigger AS $$
DECLARE
  posting_count BIGINT;
  debit_total NUMERIC;
  credit_total NUMERIC;
BEGIN
  SELECT COUNT(*),
         COALESCE(SUM(CASE WHEN "side" = 'DEBIT' THEN "amountWei" ELSE 0 END), 0),
         COALESCE(SUM(CASE WHEN "side" = 'CREDIT' THEN "amountWei" ELSE 0 END), 0)
    INTO posting_count, debit_total, credit_total
    FROM "JournalPosting"
   WHERE "journalId" = NEW."id";
  IF posting_count < 2 OR debit_total <> credit_total THEN
    RAISE EXCEPTION 'journal % must contain at least two balanced postings', NEW."id";
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "JournalTransaction_balanced_deferred"
AFTER INSERT ON "JournalTransaction"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "bisect_assert_journal_has_postings"();

CREATE FUNCTION "bisect_reject_journal_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'journal history is append-only; add a reversal entry instead';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "JournalTransaction_append_only"
BEFORE UPDATE OR DELETE ON "JournalTransaction"
FOR EACH ROW EXECUTE FUNCTION "bisect_reject_journal_mutation"();

CREATE TRIGGER "JournalPosting_append_only"
BEFORE UPDATE OR DELETE ON "JournalPosting"
FOR EACH ROW EXECUTE FUNCTION "bisect_reject_journal_mutation"();
