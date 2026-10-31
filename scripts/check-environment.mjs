import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, isAbsolute, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const pathEntries = (process.env.PATH || "").split(delimiter);
const foundryDirectory = process.platform === "win32" ? "foundry-v1.8.7" : "foundry-linux-v1.8.7";
const findTool = (name) => {
  const suffixes = process.platform === "win32" ? [".exe", ".cmd", ""] : [""];
  const directories = [...pathEntries, join(root, ".tools", foundryDirectory)];
  if (name === "docker" && process.platform === "win32") {
    directories.push(
      join(process.env.ProgramFiles || "C:\\Program Files", "Docker", "Docker", "resources", "bin"),
    );
  }
  for (const directory of directories) {
    for (const suffix of suffixes) {
      const candidate = join(directory, `${name}${suffix}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
};

const checks = [
  ["Node.js", process.execPath, ["--version"], true],
  ["pnpm", "pnpm", ["--version"], true],
  ["Git", "git", ["--version"], true],
  ["Foundry Forge", findTool("forge"), ["--version"], true],
  ["Anvil", findTool("anvil"), ["--version"], true],
  ["Cast", findTool("cast"), ["--version"], true],
  ["Docker CLI", findTool("docker"), ["--version"], true],
  ["Docker Compose", findTool("docker"), ["compose", "version"], true],
];

let failed = false;
for (const [label, command, args, required] of checks) {
  const result = command
    ? spawnSync(command, args, {
        encoding: "utf8",
        shell: process.platform === "win32" && !isAbsolute(command),
      })
    : { status: null, stdout: "", stderr: "" };
  const output = (result.stdout || result.stderr || "").trim().split(/\r?\n/)[0];
  const okay = result.status === 0;
  console.log(
    `${okay ? "PASS" : required ? "MISSING" : "SKIP"} ${label}${output ? `: ${output}` : ""}`,
  );
  if (!okay && required) failed = true;
}

if (failed) process.exitCode = 1;
