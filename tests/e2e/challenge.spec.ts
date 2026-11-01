import { expect, test } from "@playwright/test";

test("challenger route requires a verified contract deployment", async ({ page }) => {
  await page.goto("/challenge/1");
  await expect(page.getByRole("heading", { name: "Challenge claim #1" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Challenger unavailable" })).toBeVisible();
  await expect(page.getByText(/verified registry address must be configured/i)).toBeVisible();
});

test("challenger route rejects malformed claim IDs", async ({ page }) => {
  const response = await page.goto("/challenge/not-a-number");
  expect(response?.status()).toBe(404);
});
