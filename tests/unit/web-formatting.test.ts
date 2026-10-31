import { describe, expect, it } from "vitest";
import { formatWei } from "../../apps/web/src/components/format";

describe("exact ETH display formatting", () => {
  it("formats integer wei without floating point rounding", () => {
    expect(formatWei(1n)).toBe("0.000000000000000001");
    expect(formatWei("1234567890123456789")).toBe("1.234567890123456789");
    expect(formatWei(10n ** 18n)).toBe("1");
  });

  it("rejects negative amounts", () => {
    expect(() => formatWei(-1n)).toThrow("ETH amount cannot be negative");
  });
});
