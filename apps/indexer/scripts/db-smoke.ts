import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "../src/generated/prisma/client";

loadEnv({ path: resolve(import.meta.dirname, "../../../.env") });
const databaseUrlKey: string = "DATABASE_URL";
const connectionString = process.env[databaseUrlKey];
if (!connectionString) throw new Error("DATABASE_URL must be configured");

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

try {
  const row = await prisma.healthCheck.create({ data: { status: "integration-ok" } });
  const found = await prisma.healthCheck.findUnique({ where: { id: row.id } });
  if (found?.status !== "integration-ok") {
    throw new Error("Prisma read-after-write check did not return the inserted row");
  }
  console.log(`Prisma PostgreSQL read/write verified (row ${row.id}).`);
  await prisma.healthCheck.delete({ where: { id: row.id } });
} finally {
  await prisma.$disconnect();
}
