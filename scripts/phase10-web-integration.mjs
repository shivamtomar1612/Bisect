import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const indexerDirectory = resolve(root, "apps/indexer");
const tsxCli = resolve(indexerDirectory, "node_modules/tsx/dist/cli.mjs");
const child = spawn(process.execPath, [tsxCli, "tests/phase8-integration.ts"], {
  cwd: indexerDirectory,
  env: { ...process.env, BISECT_WEB_INTEGRATION: "1" },
  stdio: "inherit",
});

const exitCode = await new Promise((resolveExit, reject) => {
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (signal) {
      reject(new Error(`Phase 10 integration was interrupted by ${signal}.`));
      return;
    }
    resolveExit(code ?? 1);
  });
});

process.exitCode = exitCode;
