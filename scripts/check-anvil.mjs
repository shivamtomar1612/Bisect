import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const rpcUrl = process.env.ANVIL_RPC_URL || "http://127.0.0.1:8545";
const expected = 31337n;
const suffixes = process.platform === "win32" ? [".exe", ""] : [""];
const foundryDirectory = process.platform === "win32" ? "foundry-v1.8.7" : "foundry-linux-v1.8.7";
const candidates = [
  ...(process.env.PATH || "")
    .split(delimiter)
    .flatMap((directory) => suffixes.map((suffix) => join(directory, `anvil${suffix}`))),
  ...suffixes.map((suffix) => join(root, ".tools", foundryDirectory, `anvil${suffix}`)),
];
const anvil = candidates.find(existsSync);
if (!anvil) throw new Error("Anvil is not installed");

let startedHere = false;
let child;
const readChainId = async () => {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    signal: AbortSignal.timeout(1500),
  });
  if (!response.ok) throw new Error(`Anvil RPC returned HTTP ${response.status}`);
  const result = await response.json();
  if (result.error) throw new Error(`Anvil RPC error: ${result.error.message}`);
  return BigInt(result.result);
};

try {
  for (let attempt = 0; attempt < 45; attempt += 1) {
    try {
      const chainId = await readChainId();
      if (chainId !== expected)
        throw new Error(`Expected Anvil chain ID 31337; received ${chainId}`);
      console.log(`Anvil JSON-RPC verified chain ID ${chainId}.`);
      process.exitCode = 0;
      break;
    } catch (error) {
      if (attempt === 0) {
        child = spawn(
          anvil,
          ["--host", "127.0.0.1", "--port", "8545", "--chain-id", "31337", "--silent"],
          {
            stdio: "ignore",
            cwd: root,
          },
        );
        startedHere = true;
      }
      if (attempt === 44) throw error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
    }
  }
} finally {
  if (startedHere) child?.kill();
}
