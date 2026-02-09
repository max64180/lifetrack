import { test, expect } from "@playwright/test";

test("app loads (login or timeline)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("LifeTrack")).toBeVisible();

  const loginInput = page.getByPlaceholder(/email\.com/i);
  const timelineTab = page.getByRole("button", { name: /Timeline/i });

  await expect(loginInput.or(timelineTab)).toBeVisible({ timeout: 15000 });
});
