-- CreateEnum
CREATE TYPE "DisputePhase" AS ENUM ('BISECTION', 'TERMINAL', 'CLOSED', 'UNKNOWN');

-- AlterTable
ALTER TABLE "Dispute" ADD COLUMN     "differentIndex" INTEGER,
ADD COLUMN     "phase" "DisputePhase" NOT NULL DEFAULT 'BISECTION';
