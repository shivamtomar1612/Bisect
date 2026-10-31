import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@bisect/vm",
        replacement: fileURLToPath(new URL("./packages/vm/src/index.ts", import.meta.url)),
      },
      {
        find: "@bisect/merkle",
        replacement: fileURLToPath(new URL("./packages/merkle/src/index.ts", import.meta.url)),
      },
      {
        find: "@bisect/sdk",
        replacement: fileURLToPath(new URL("./packages/sdk/src/index.ts", import.meta.url)),
      },
    ],
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    coverage: { enabled: false },
  },
});
