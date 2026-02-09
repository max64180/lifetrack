import { test, expect } from "@playwright/test";

test("login screen loads", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("LifeTrack")).toBeVisible();
  await expect(page.getByPlaceholder("nome@email.com")).toBeVisible();
});
