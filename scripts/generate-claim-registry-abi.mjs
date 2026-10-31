import { mkdir, readFile, writeFile } from "node:fs/promises";

const artifactUrl = new URL(
  "../contracts/out/BisectClaimRegistry.sol/BisectClaimRegistry.json",
  import.meta.url,
);
const targetUrl = new URL("../packages/sdk/src/abis/bisectClaimRegistry.ts", import.meta.url);
const artifact = JSON.parse(await readFile(artifactUrl, "utf8"));
if (!Array.isArray(artifact.abi)) throw new Error("Foundry artifact does not contain an ABI.");

await mkdir(new URL("../packages/sdk/src/abis/", import.meta.url), { recursive: true });
await writeFile(
  targetUrl,
  `import type { Abi } from "viem";\n\nexport const bisectClaimRegistryAbi = ${JSON.stringify(artifact.abi, null, 2)} as const satisfies Abi;\n`,
  "utf8",
);
