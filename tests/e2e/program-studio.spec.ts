import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

interface ExportedProof {
  readonly stateIndex: number;
  readonly siblingsBottomUp: readonly string[];
}

interface ExportedStudioBundle {
  readonly assemblySource: string;
  readonly result: {
    readonly output: string;
    readonly haltedWithinBudget: boolean;
    readonly haltIndex: number | null;
  };
  readonly execution: {
    readonly programHex: string;
    readonly publicInput: readonly string[];
    readonly transitionCount: number;
    readonly states: readonly unknown[];
    readonly traceRoot: string;
  };
  readonly selectedProof: ExportedProof | null;
}

interface ExportedClaim {
  readonly functionName: string;
  readonly calldata: string;
  readonly submission: {
    readonly publicInput: readonly string[];
    readonly transitionCount: number;
    readonly claimedOutput: string;
    readonly initialProof: { readonly siblings: readonly string[] };
    readonly finalProof: { readonly siblings: readonly string[] };
  };
}

async function readDownload(download: Awaited<ReturnType<typeof testDownload>>): Promise<string> {
  const path = await download.path();
  if (path === null) throw new Error("Playwright did not save the requested download.");
  return readFile(path, "utf8");
}

async function testDownload(page: import("@playwright/test").Page) {
  return page.waitForEvent("download");
}

test("runs the real VM, verifies and exports a state proof, and prepares Phase 5 calldata", async ({
  page,
}) => {
  await page.goto("/program-studio");
  await page.getByLabel("Start from an example").selectOption("addition");
  await page.getByTestId("studio-run").click();

  await expect(page.getByRole("heading", { name: "Run summary" })).toBeVisible();
  const output = page.locator(".studio-summary-value").filter({ hasText: "Output · R0" });
  await expect(output.locator("strong")).toHaveText("12");
  await expect(
    page
      .locator(".studio-result-card .studio-hash-row")
      .filter({ hasText: "Ordered Merkle root" })
      .locator("code"),
  ).toHaveText(/^0x[0-9a-f]{64}$/);

  await page.getByRole("button", { name: "Next trace state" }).click();
  await expect(page.getByRole("heading", { name: "State 1" })).toBeVisible();
  await expect(page.getByTestId("studio-selected-trace-row")).toHaveAttribute(
    "data-state-index",
    "1",
  );
  await page.getByTestId("studio-generate-proof").click();
  await expect(page.getByTestId("studio-proof-feedback")).toContainText(
    "Proof verified for state 1",
  );

  const proofDownloadEvent = page.waitForEvent("download");
  await page.getByTestId("studio-export-proof").click();
  const proofDownload = await proofDownloadEvent;
  const proofArtifact = JSON.parse(await readDownload(proofDownload)) as ExportedProof;
  expect(proofArtifact.stateIndex).toBe(1);
  expect(proofArtifact.siblingsBottomUp).toHaveLength(6);

  await page.getByTestId("studio-test-invalid-proof").click();
  await expect(page.getByTestId("studio-invalid-proof-result")).toContainText(
    "Tamper test rejected",
  );

  const bundleDownloadEvent = page.waitForEvent("download");
  await page.getByTestId("studio-export").click();
  const bundleDownload = await bundleDownloadEvent;
  const bundle = JSON.parse(await readDownload(bundleDownload)) as ExportedStudioBundle;
  expect(bundle.assemblySource).toContain("ADD R0, R0, R1");
  expect(bundle.result).toEqual({ haltedWithinBudget: true, haltIndex: 2, output: "12" });
  expect(bundle.execution.programHex).toMatch(/^0x[0-9a-f]+$/);
  expect(bundle.execution.publicInput.slice(0, 2)).toEqual(["7", "5"]);
  expect(bundle.execution.states).toHaveLength(64);
  expect(bundle.selectedProof?.stateIndex).toBe(1);

  await page.getByTestId("studio-prepare-claim").click();
  await expect(page.getByTestId("studio-claim-ready")).toContainText(
    "ClaimSubmission prepared locally",
  );
  const claimDownloadEvent = page.waitForEvent("download");
  await page.getByTestId("studio-export-claim").click();
  const claimDownload = await claimDownloadEvent;
  const claim = JSON.parse(await readDownload(claimDownload)) as ExportedClaim;
  expect(claim.functionName).toBe("submitClaim");
  expect(claim.calldata).toMatch(/^0x[0-9a-f]+$/);
  expect(claim.submission.publicInput.slice(0, 2)).toEqual(["7", "5"]);
  expect(claim.submission.claimedOutput).toBe("12");
  expect(claim.submission.transitionCount).toBe(63);
  expect(claim.submission.initialProof.siblings).toHaveLength(6);
  expect(claim.submission.finalProof.siblings).toHaveLength(6);
  await expect(page.getByText("No wallet was opened and no transaction was sent.")).toBeVisible();
});

test("validates the bounded assembly grammar and preserves full-width uint64 input", async ({
  page,
}) => {
  await page.goto("/program-studio");
  await page.getByLabel("Start from an example").selectOption("invalid-register");
  await expect(page.getByTestId("studio-validation")).toContainText(
    "Registers must be written R0 through R7",
  );
  await expect(page.getByTestId("studio-run")).toBeDisabled();

  await page.getByLabel("Start from an example").selectOption("addition");
  await page.getByLabel("R0 public input").fill("18446744073709551615");
  await page.getByLabel("R1 public input").fill("1");
  await page.getByTestId("studio-run").click();
  const output = page.locator(".studio-summary-value").filter({ hasText: "Output · R0" });
  await expect(output.locator("strong")).toHaveText("0");

  const bundleDownloadEvent = page.waitForEvent("download");
  await page.getByTestId("studio-export").click();
  const bundleDownload = await bundleDownloadEvent;
  const bundle = JSON.parse(await readDownload(bundleDownload)) as ExportedStudioBundle;
  expect(bundle.execution.publicInput[0]).toBe("18446744073709551615");
  expect(bundle.execution.publicInput[1]).toBe("1");
  expect(bundle.result.output).toBe("0");
});

test("identical program, input, and budget produce the same browser commitment", async ({
  page,
}) => {
  await page.goto("/program-studio");
  await page.getByTestId("studio-run").click();
  const root = page
    .locator(".studio-result-card .studio-hash-row")
    .filter({ hasText: "Ordered Merkle root" })
    .locator("code");
  const firstRoot = await root.textContent();
  if (firstRoot === null) throw new Error("The VM run did not render its Merkle root.");
  await page.getByTestId("studio-run").click();
  await expect(root).toHaveText(firstRoot);
  await expect(
    page.locator(".studio-summary-value").filter({ hasText: "Output · R0" }).locator("strong"),
  ).toHaveText("12");
});

test("virtualizes the maximum approved trace and supports HALT stuttering", async ({ page }) => {
  await page.goto("/program-studio");
  await page.getByLabel("Start from an example").selectOption("halt-stutter");
  await page.getByLabel("Transition budget").selectOption("4095");
  await page.getByTestId("studio-run").click();
  await expect(page.getByText("4,096 total")).toBeVisible();
  await expect(page.getByRole("heading", { name: "State 0" })).toBeVisible();
  const renderedRows = await page.locator(".studio-trace-list-item").count();
  expect(renderedRows).toBeLessThanOrEqual(20);
  await page.getByRole("button", { name: "Next trace state" }).click();
  await expect(page.getByRole("heading", { name: "State 1" })).toBeVisible();
  await page.getByRole("button", { name: "Next trace state" }).click();
  await expect(page.getByRole("heading", { name: "State 2" })).toBeVisible();
  await expect(page.getByText("HALT reached")).toBeVisible();
});

test("trace play, pause, previous, next, and reset controls follow the selected state", async ({
  page,
}) => {
  await page.goto("/program-studio");
  await page.getByTestId("studio-run").click();
  await page.getByRole("button", { name: "Next trace state" }).click();
  await expect(page.getByRole("heading", { name: "State 1" })).toBeVisible();
  await page.getByRole("button", { name: "Previous trace state" }).click();
  await expect(page.getByRole("heading", { name: "State 0" })).toBeVisible();
  await page.getByRole("button", { name: "Play trace" }).click();
  await expect(page.getByRole("heading", { name: /State [1-9]/ })).toBeVisible();
  await page.getByRole("button", { name: "Pause trace playback" }).click();
  await page.getByRole("button", { name: "Reset trace to initial state" }).click();
  await expect(page.getByRole("heading", { name: "State 0" })).toBeVisible();
});

test("labels the same-output dishonest trace as a test and rejects its transition", async ({
  page,
}) => {
  await page.goto("/program-studio");
  await page.getByText("Test scenario: correct output, altered intermediate state").click();
  await page.getByTestId("studio-run-dishonest-scenario").click();
  const result = page.getByTestId("studio-dishonest-result");
  await expect(result).toContainText("Membership proof: verified");
  await expect(result).toContainText("First transition: invalid");
  await expect(result).toContainText("Final output: unchanged · 12");
  await expect(result).toContainText("Test-only altered root");
});

test("Studio reflows to a narrow screen without page-level horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/program-studio");
  await page.getByTestId("studio-run").click();
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(375);
  await expect(page.getByLabel("R7 public input")).toBeVisible();
  await expect(page.getByTestId("studio-run")).toBeVisible();
});

test("accessibility smoke: Studio inputs and trace actions have names and keyboard operation", async ({
  page,
}) => {
  await page.goto("/program-studio");
  const unnamedControls = await page.evaluate(() => {
    return Array.from(
      document.querySelectorAll<
        HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >("button,input,select,textarea"),
    ).filter((control) => {
      if (control instanceof HTMLButtonElement) {
        return !control.textContent?.trim() && !control.getAttribute("aria-label");
      }
      return !control.getAttribute("aria-label") && !control.labels?.length;
    }).length;
  });
  expect(unnamedControls).toBe(0);
  await expect(page.getByLabel("BISECT assembly")).toBeVisible();
  await expect(page.getByLabel("R7 public input")).toBeVisible();

  await page.getByTestId("studio-run").click();
  const next = page.getByRole("button", { name: "Next trace state" });
  await next.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "State 1" })).toBeVisible();
});
