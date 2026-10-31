ALTER TABLE "LedgerAccount"
ADD COLUMN "normalSide" "PostingSide" NOT NULL DEFAULT 'CREDIT';

UPDATE "LedgerAccount"
SET "normalSide" = 'DEBIT'
WHERE "type" = 'ASSET';
