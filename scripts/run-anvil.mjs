import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const suffixes = process.platform === "win32" ? [".exe", ""] : [""];
const foundryDirectory = process.platform === "win32" ? "foundry-v1.8.7" : "foundry-linux-v1.8.7";
const candidates = [
  ...(process.env.PATH || "")
    .split(delimiter)
    .flatMap((directory) => suffixes.map((suffix) => join(directory, `anvil${suffix}`))),
  ...suffixes.map((suffix) => join(root, ".tools", foundryDirectory, `anvil${suffix}`)),
];
const anvil = candidates.find(existsSync);
if (!anvil) {
  console.error("Anvil is not installed. See docs/windows-wsl-setup.md.");
  process.exit(127);
}

const child = spawn(
  anvil,
  ["--host", "127.0.0.1", "--port", "8545", "--chain-id", "31337", "--silent"],
  {
    stdio: "inherit",
    cwd: root,
  },
);
child.on("exit", (code) => process.exit(code ?? 1));
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
