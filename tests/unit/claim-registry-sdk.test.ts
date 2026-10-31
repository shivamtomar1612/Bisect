import { describe, expect, it } from "vitest";
import { bisectClaimRegistryAbi } from "../../packages/sdk/src/index.js";

describe("claim registry SDK bindings", () => {
  it("exports the generated financial ABI without an unimplemented challenge surface", () => {
    const functionNames = bisectClaimRegistryAbi
      .filter((item) => item.type === "function")
      .map((item) => item.name);

    expect(functionNames).toContain("submitClaim");
    expect(functionNames).toContain("finalize");
    expect(functionNames).toContain("withdraw");
    expect(functionNames).toContain("totalLiabilities");
    expect(functionNames).not.toContain("challenge");
    expect(functionNames).not.toContain("withdrawTo");
  });
});
