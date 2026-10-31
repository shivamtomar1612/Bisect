import { expect, test } from "@playwright/test";

test("home page reports the actual foundation stage", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /make computation challengeable/i }),
  ).toBeVisible();
  await expect(
    page.getByText(/no vm, proof, transaction, bond, or testnet integration is implemented yet/i),
  ).toBeVisible();
});
