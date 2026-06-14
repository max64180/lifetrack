import { test, expect } from "@playwright/test";

test("app loads (login or home/deadlines nav)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("LifeTrack")).toBeVisible();

  const loginInput = page.getByPlaceholder(/email\.com/i);
  const primaryNav = page.getByRole("button", { name: /home|scadenze|deadlines/i }).first();

  await expect(loginInput.or(primaryNav)).toBeVisible({ timeout: 15000 });
});
