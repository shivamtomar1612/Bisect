CREATE UNIQUE INDEX "JournalPosting_journalId_accountId_side_amountWei_key"
ON "JournalPosting"("journalId", "accountId", "side", "amountWei");
