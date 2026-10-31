import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const dockerScript = fileURLToPath(new URL("./run-docker.mjs", import.meta.url));
const token = `restart-check-${randomUUID()}`;
let rowId;

function runDocker(args) {
  const result = spawnSync(process.execPath, [dockerScript, "compose", ...args], {
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(
      result.stderr?.trim() ||
        result.error?.message ||
        `Docker Compose command failed: ${args.slice(0, 2).join(" ")}`,
    );
  }
  return result.stdout.trim();
}

function query(sql) {
  return runDocker([
    "exec",
    "-T",
    "postgres",
    "psql",
    "-X",
    "-qAt",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    "bisect",
    "-d",
    "bisect",
    "-c",
    sql,
  ]);
}

try {
  const insertedId = query(
    `INSERT INTO "HealthCheck" ("status") VALUES ('${token}') RETURNING "id";`,
  );
  if (!/^\d+$/.test(insertedId)) {
    throw new Error("PostgreSQL did not return a valid persistence-check row ID");
  }
  rowId = Number(insertedId);

  runDocker(["restart", "postgres"]);

  let healthy = false;
  let lastHealthError;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      runDocker(["exec", "-T", "postgres", "pg_isready", "-U", "bisect", "-d", "bisect"]);
      healthy = true;
      break;
    } catch (error) {
      lastHealthError = error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
    }
  }
  if (!healthy) {
    throw new Error(`PostgreSQL did not recover within 30 attempts: ${lastHealthError?.message}`);
  }

  const persisted = query(`SELECT "status" FROM "HealthCheck" WHERE "id" = ${rowId};`);
  if (persisted !== token) {
    throw new Error("The pre-restart PostgreSQL row was not preserved");
  }
  console.log("PostgreSQL health and pre-restart row persistence verified.");
} finally {
  if (rowId !== undefined) {
    query(`DELETE FROM "HealthCheck" WHERE "id" = ${rowId};`);
    console.log("Temporary persistence-check row removed.");
  }
}
