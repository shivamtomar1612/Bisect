import { createIndexerApi } from "./api.js";
import { loadIndexerConfig } from "./config.js";
import { prisma } from "./database.js";

const config = loadIndexerConfig();
const server = createIndexerApi(config);
server.listen(config.apiPort, config.apiHost, () => {
  console.info(
    JSON.stringify({ service: "bisect-indexer-api", host: config.apiHost, port: config.apiPort }),
  );
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close(() => void prisma.$disconnect());
  });
}
