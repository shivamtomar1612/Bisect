import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const dockerScript = fileURLToPath(new URL("./run-docker.mjs", import.meta.url));
const run = (args) =>
  spawnSync(process.execPath, [dockerScript, "compose", ...args], {
    encoding: "utf8",
    shell: false,
    stdio: "inherit",
  });

const restarted = run(["restart", "postgres"]);
if (restarted.status !== 0) process.exit(restarted.status || 1);

let healthy = false;
for (let attempt = 0; attempt < 30; attempt += 1) {
  const result = spawnSync(
    process.execPath,
    [
      dockerScript,
      "compose",
      "exec",
      "-T",
      "postgres",
      "pg_isready",
      "-U",
      "bisect",
      "-d",
      "bisect",
    ],
    {
      encoding: "utf8",
      shell: false,
      stdio: "ignore",
    },
  );
  if (result.status === 0) {
    healthy = true;
    break;
  }
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
}
if (!healthy) throw new Error("PostgreSQL did not recover after restart within 30 seconds");

const smoke = spawnSync("pnpm", ["db:smoke"], {
  encoding: "utf8",
  shell: process.platform === "win32",
  stdio: "inherit",
});
if (smoke.status !== 0) process.exit(smoke.status || 1);
console.log("PostgreSQL reconnected successfully after restart; data volume was preserved.");
