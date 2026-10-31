/*
  Warnings:

  - Added the required column `rawData` to the `ChainEvent` table without a default value. This is not possible if the table is not empty.
  - Added the required column `rawTopics` to the `ChainEvent` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ChainEvent" ADD COLUMN     "rawData" TEXT NOT NULL,
ADD COLUMN     "rawTopics" JSONB NOT NULL;
