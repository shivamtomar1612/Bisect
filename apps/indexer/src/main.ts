import { loadIndexerConfig } from "./config.js";
import { prisma } from "./database.js";
import { runIndexerLoop } from "./indexer.js";

const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());

try {
  await runIndexerLoop(loadIndexerConfig(), controller.signal);
} finally {
  await prisma.$disconnect();
}
