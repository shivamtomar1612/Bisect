import { loadIndexerConfig } from "./config.js";
import { prisma } from "./database.js";
import { runIndexerOnce } from "./indexer.js";

try {
  console.log(JSON.stringify(await runIndexerOnce(loadIndexerConfig()), null, 2));
} finally {
  await prisma.$disconnect();
}
