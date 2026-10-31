import { spawnSync } from "node:child_process";
import { isAbsolute } from "node:path";

const commands = [
  ["Frozen workspace installation", "pnpm", ["install", "--frozen-lockfile"]],
  ["Environment tools", "pnpm", ["check:environment"]],
  ["Docker daemon", "node", ["scripts/run-docker.mjs", "info", "--format", "{{.ServerVersion}}"]],
  ["Start PostgreSQL", "pnpm", ["db:up"]],
  ["Prisma schema", "pnpm", ["--filter", "@bisect/indexer", "db:validate"]],
  ["Prisma Client", "pnpm", ["db:generate"]],
  ["Database migration", "pnpm", ["db:migrate"]],
  ["Database read/write", "pnpm", ["db:smoke"]],
  ["Database restart and persistence", "pnpm", ["db:restart-check"]],
  ["Lint", "pnpm", ["lint"]],
  ["Formatting", "pnpm", ["format:check"]],
  ["Typecheck", "pnpm", ["typecheck"]],
  ["Unit tests", "pnpm", ["test"]],
  ["Web build", "pnpm", ["build"]],
  ["Base Sepolia RPC", "pnpm", ["check:base-sepolia"]],
  ["Local Anvil RPC", "pnpm", ["check:anvil"]],
  ["Contract build", "pnpm", ["contracts:build"]],
  ["Contract tests", "pnpm", ["contracts:test"]],
  ["Browser tests", "pnpm", ["e2e"]],
];

for (const [label, command, args] of commands) {
  console.log(`\n== ${label} ==`);
  const executable = command === "node" ? process.execPath : command;
  const result = spawnSync(executable, args, {
    stdio: "inherit",
    shell: process.platform === "win32" && !isAbsolute(executable),
  });
  if (result.status !== 0) {
    console.error(`FAILED ${label} (exit ${result.status ?? "unknown"})`);
    process.exit(result.status || 1);
  }
}
