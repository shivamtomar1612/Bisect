import { expect, test } from "@playwright/test";

test("ledger requires an external wallet and never invents balances", async ({ page }) => {
  await page.goto("/account-ledger");
  await expect(page.getByRole("heading", { name: "Account Ledger" })).toBeVisible();
  await expect(page.getByText(/connect.*wallet/i).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /withdraw available credit/i })).toHaveCount(0);
});

test("claim action stays unavailable without a verified registry address", async ({ page }) => {
  await page.goto("/program-studio");
  await page.getByRole("button", { name: "Run VM and build commitment" }).click();
  await page.getByTestId("studio-prepare-claim").click();
  await expect(page.getByTestId("studio-submit-claim")).toBeDisabled();
});

test("ledger API rejects an invalid wallet address", async ({ request }) => {
  const response = await request.get("/api/account-ledger?address=invalid");
  expect(response.status()).toBe(400);
});
