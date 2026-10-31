import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const vmRoot = resolve(repositoryRoot, "packages/vm");
const tsxCli = resolve(vmRoot, "node_modules/tsx/dist/cli.mjs");
const vmCli = resolve(vmRoot, "src/cli.ts");
const result = spawnSync(process.execPath, [tsxCli, vmCli, ...process.argv.slice(2)], {
  cwd: repositoryRoot,
  stdio: "inherit",
});

if (result.error) {
  process.stderr.write(`Unable to start the BISECT VM CLI: ${result.error.message}\n`);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
