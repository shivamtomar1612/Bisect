import { mkdir, readFile, writeFile } from "node:fs/promises";

await mkdir(new URL("../packages/sdk/src/abis/", import.meta.url), { recursive: true });
const artifacts = [
  {
    artifact: "BisectClaimRegistry.sol/BisectClaimRegistry.json",
    target: "bisectClaimRegistry.ts",
    exportName: "bisectClaimRegistryAbi",
  },
  {
    artifact: "BisectDisputeRegistryV1.sol/BisectDisputeRegistryV1.json",
    target: "bisectDisputeRegistryV1.ts",
    exportName: "bisectDisputeRegistryV1Abi",
  },
];

for (const entry of artifacts) {
  const artifactUrl = new URL(`../contracts/out/${entry.artifact}`, import.meta.url);
  const targetUrl = new URL(`../packages/sdk/src/abis/${entry.target}`, import.meta.url);
  const artifact = JSON.parse(await readFile(artifactUrl, "utf8"));
  if (!Array.isArray(artifact.abi)) {
    throw new Error(`Foundry artifact ${entry.artifact} does not contain an ABI.`);
  }
  await writeFile(
    targetUrl,
    `import type { Abi } from "viem";\n\nexport const ${entry.exportName} = ${JSON.stringify(artifact.abi, null, 2)} as const satisfies Abi;\n`,
    "utf8",
  );
}
