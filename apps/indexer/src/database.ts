import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "./generated/prisma/client.js";

loadEnv({ path: resolve(import.meta.dirname, "../../../.env"), quiet: true });

const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined || connectionString.length === 0) {
  throw new Error("DATABASE_URL must be configured for the indexer.");
}

const adapter = new PrismaPg({ connectionString, max: 10, connectionTimeoutMillis: 5_000 });
export const prisma = new PrismaClient({ adapter });
