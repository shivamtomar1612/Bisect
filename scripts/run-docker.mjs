import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const suffix = process.platform === "win32" ? ".exe" : "";
const candidates = (process.env.PATH || "")
  .split(delimiter)
  .map((directory) => join(directory, `docker${suffix}`));
if (process.platform === "win32") {
  candidates.push(
    join(
      process.env.ProgramFiles || "C:\\Program Files",
      "Docker",
      "Docker",
      "resources",
      "bin",
      "docker.exe",
    ),
  );
}
const docker = candidates.find(existsSync);
if (!docker) {
  console.error(
    "Docker CLI is unavailable. Install Docker Desktop and see docs/database-setup.md.",
  );
  process.exit(127);
}

const result = spawnSync(docker, process.argv.slice(2), { cwd: root, stdio: "inherit" });
process.exit(result.status ?? 1);
