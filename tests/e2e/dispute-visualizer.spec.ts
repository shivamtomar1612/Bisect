import { expect, test } from "@playwright/test";

test("labeled 1,023-transition simulation replays ten authenticated reductions", async ({
  page,
}) => {
  await page.goto("/disputes/demo");
  await expect(page.getByText(/EDUCATIONAL SIMULATION/)).toBeVisible();
  await expect(page.getByText("1,023 transitions", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Round 10 ·/ }).click();
  await expect(page.getByRole("heading", { name: /Round 10/ })).toBeVisible();
  await expect(page.getByText(/1 possible states remain/)).toBeVisible();
  await page.getByRole("button", { name: "Next step" }).click();
  await expect(page.getByRole("heading", { name: "One disputed state remains" })).toBeVisible();
  await expect(page.getByText(/No on-chain outcome/)).toBeVisible();
  await page.getByRole("button", { name: "Previous step" }).press("Enter");
  await expect(page.getByRole("heading", { name: /Round 10/ })).toBeVisible();
});

test("visualizer fits a narrow viewport without horizontal page overflow", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/disputes/demo");
  await expect(page.getByRole("heading", { name: /Watch 1,023 transitions/ })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
});

test("real replay shows unavailable indexer data rather than invented rounds", async ({ page }) => {
  await page.goto("/disputes/1/1");
  await expect(page.getByRole("heading", { name: "Interactive bisection replay" })).toBeVisible();
  await expect(
    page.getByText(/Read API not configured|Read API unreachable|Indexer or RPC check failed/),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Round 1 ·/ })).toHaveCount(0);
});
