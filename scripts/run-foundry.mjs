import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";

const [subcommand, ...extraArgs] = process.argv.slice(2);
if (!subcommand || !["build", "test"].includes(subcommand)) {
  console.error("Usage: node scripts/run-foundry.mjs <build|test> [forge arguments]");
  process.exit(2);
}

const root = resolve(import.meta.dirname, "..");
const suffixes = process.platform === "win32" ? [".exe", ""] : [""];
const installDirectory = process.platform === "win32" ? "foundry-v1.8.7" : "foundry-linux-v1.8.7";
const candidates = [
  ...(process.env.PATH || "")
    .split(delimiter)
    .flatMap((directory) => suffixes.map((suffix) => join(directory, `forge${suffix}`))),
  ...suffixes.map((suffix) => join(root, ".tools", installDirectory, `forge${suffix}`)),
];
const forge = candidates.find(existsSync);
if (!forge) {
  console.error("Foundry forge is not installed. See docs/windows-wsl-setup.md.");
  process.exit(127);
}

const result = spawnSync(forge, [subcommand, "--root", "contracts", ...extraArgs], {
  stdio: "inherit",
  cwd: root,
});
process.exit(result.status ?? 1);
