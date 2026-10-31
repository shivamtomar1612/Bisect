import { loadIndexerConfig } from "./config.js";
import { prisma } from "./database.js";
import { reconcileLedger } from "./reconciliation.js";

try {
  const result = await reconcileLedger(loadIndexerConfig());
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "MATCH") process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
