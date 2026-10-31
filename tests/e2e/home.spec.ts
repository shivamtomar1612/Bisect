import { expect, test } from "@playwright/test";

test("landing page explains the protocol and links to its working areas", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /make outsourced computation publicly challengeable/i }),
  ).toBeVisible();
  await expect(page.getByText("BASE SEPOLIA · TESTNET PROTOTYPE")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Trace data must be available" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "An active challenger matters" })).toBeVisible();
  await expect(
    page.getByText("Illustrative protocol flow. No live claim or proof is shown."),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /open dashboard/i })).toHaveAttribute(
    "href",
    "/dashboard",
  );
  await expect(page.getByRole("link", { name: /explore program studio/i })).toHaveAttribute(
    "href",
    "/program-studio",
  );
});

test("claims and disputes never present missing indexer data as an empty or successful result", async ({
  page,
}) => {
  await page.goto("/claims");
  await expect(page.getByRole("heading", { name: "Claims", level: 1 })).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: /read api not configured|read api unreachable|indexer or rpc check failed|read api response invalid/i,
    }),
  ).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
  await page.goto("/disputes");
  await expect(page.getByRole("heading", { name: "Disputes", level: 1 })).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
});

test("theme toggle persists and mobile drawer supports Escape", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.evaluate(() => localStorage.getItem("bisect-theme"))).resolves.toBe("dark");
  const trigger = page.getByRole("button", { name: "Open navigation" });
  await trigger.click();
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});

test("wallet safety dialog is keyboard dismissible", async ({ page }) => {
  await page.goto("/settings");
  const trigger = page.getByRole("button", { name: "Review wallet safety" });
  await trigger.click();
  await expect(page.getByRole("dialog", { name: "Keep signing in your wallet" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("all information architecture routes have one named page heading", async ({ page }) => {
  for (const [route, heading] of [
    ["/dashboard", "Network overview"],
    ["/program-studio", "Program Studio"],
    ["/claims", "Claims"],
    ["/disputes", "Disputes"],
    ["/account-ledger", "Account Ledger"],
    ["/documentation", "Documentation"],
    ["/settings", "Settings"],
  ]) {
    await page.goto(route);
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  }
});

test("skip link and labeled navigation work from the keyboard", async ({ page }) => {
  await page.goto("/dashboard");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
});

test("accessibility smoke: controls are named and semantic color pairs meet AA", async ({
  page,
}) => {
  await page.goto("/");
  const audit = await page.evaluate(() => {
    const variables = getComputedStyle(document.documentElement);
    const rgb = (value: string) => {
      const color = value.trim();
      if (color.startsWith("#")) {
        const hex = color.slice(1);
        const full =
          hex.length === 3
            ? hex
                .split("")
                .map((digit) => digit + digit)
                .join("")
            : hex;
        return [0, 2, 4].map((offset) => Number.parseInt(full.slice(offset, offset + 2), 16));
      }
      return (
        color
          .match(/[\d.]+/g)
          ?.slice(0, 3)
          .map(Number) ?? []
      );
    };
    const luminance = (value: string) => {
      const channels = rgb(value).map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return (
        0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0)
      );
    };
    const contrast = (foreground: string, background: string) => {
      const values = [luminance(foreground), luminance(background)].sort(
        (left, right) => right - left,
      );
      return ((values[0] ?? 0) + 0.05) / ((values[1] ?? 0) + 0.05);
    };
    const pairs = [
      ["--text", "--panel"],
      ["--muted", "--panel"],
      ["--accent", "--accentsoft"],
      ["--good", "--goodsoft"],
      ["--warn", "--warnsoft"],
    ] as const;
    const contrasts = pairs.map(([foreground, background]) =>
      contrast(variables.getPropertyValue(foreground), variables.getPropertyValue(background)),
    );
    const unnamedButtons = Array.from(document.querySelectorAll("button")).filter(
      (button) => !button.textContent?.trim() && !button.getAttribute("aria-label"),
    );
    const unnamedInputs = Array.from(
      document.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input,select"),
    ).filter((input) => !input.getAttribute("aria-label") && !input.labels?.length);
    return {
      lang: document.documentElement.lang,
      contrasts,
      unnamedButtons: unnamedButtons.length,
      unnamedInputs: unnamedInputs.length,
    };
  });
  expect(audit.lang).toBe("en");
  expect(audit.unnamedButtons).toBe(0);
  expect(audit.unnamedInputs).toBe(0);
  expect(audit.contrasts.every((value) => value >= 4.5)).toBe(true);
  await page.locator("html").evaluate((html) => {
    html.dataset.theme = "dark";
  });
  const dark = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const luminance = (value: string) => {
      const color = value.trim();
      const channels = color.startsWith("#")
        ? [0, 2, 4].map(
            (offset) => Number.parseInt(color.slice(1).slice(offset, offset + 2), 16) / 255,
          )
        : (color
            .match(/[\d.]+/g)
            ?.slice(0, 3)
            .map((channel) => Number(channel) / 255) ?? []);
      const linear = channels.map((channel) =>
        channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
      );
      return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
    };
    const ratio = (foreground: string, background: string) => {
      const [high, low] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
      return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05);
    };
    return [
      ["--text", "--panel"],
      ["--muted", "--panel"],
      ["--accent", "--accentsoft"],
      ["--good", "--goodsoft"],
      ["--warn", "--warnsoft"],
    ].map(([fg, bg]) => ratio(root.getPropertyValue(fg ?? ""), root.getPropertyValue(bg ?? "")));
  });
  for (const [index, value] of dark.entries()) {
    expect(value, `Dark contrast pair ${index + 1}: ${value}`).toBeGreaterThanOrEqual(4.5);
  }
});

test("missing wallet shows guidance without a completed transaction", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await expect(page.getByRole("status")).toContainText("Install an EVM wallet");
  await expect(page.getByRole("table")).toHaveCount(0);
});

test("landing page and dashboard fit a narrow mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const landingWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(landingWidth).toBeLessThanOrEqual(375);
  await page.goto("/dashboard");
  const dashboardWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(dashboardWidth).toBeLessThanOrEqual(375);
});

test("dashboard marks unavailable metrics instead of rendering invented zero values", async ({
  page,
}) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Network overview", level: 1 })).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: /read api not configured|read api unreachable|indexer or rpc check failed|read api response invalid/i,
    }),
  ).toBeVisible();
  await expect(page.locator(".dashboard-metric").first()).toContainText("—");
});
