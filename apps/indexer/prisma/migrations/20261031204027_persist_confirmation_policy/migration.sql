-- AlterTable
ALTER TABLE "IndexerCheckpoint" ADD COLUMN     "confirmationDepth" BIGINT NOT NULL DEFAULT 6;
