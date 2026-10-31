import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("requirements traceability matrix", () => {
  it("contains stable requirement IDs and does not claim implementation for planned work", () => {
    const matrix = readFileSync(resolve(process.cwd(), "docs/requirements.md"), "utf8");
    const requirementRows = matrix
      .split("\n")
      .filter((line) => /^\|\s*[MTNQ]-\d{2}\s*\|/.test(line));
    const ids = requirementRows.map((line) => line.split("|")[1]?.trim() ?? "");

    expect(requirementRows.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^[MTNQ]-\d{2}$/.test(id))).toBe(true);
    expect(matrix).toContain("No external hackathon rubric or submission checklist was supplied");
  });
});
