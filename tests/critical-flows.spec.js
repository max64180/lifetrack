import { test, expect } from "@playwright/test";

const E2E_EMAIL = process.env.E2E_EMAIL || "";
const E2E_PASSWORD = process.env.E2E_PASSWORD || "";
const HAS_CREDS = Boolean(E2E_EMAIL && E2E_PASSWORD);
const E2E_STRICT = process.env.CI === "true" || process.env.E2E_STRICT === "true";

function skipIfNoCredsInLocal() {
  if (!HAS_CREDS && !E2E_STRICT) test.skip(true, "Requires E2E_EMAIL and E2E_PASSWORD");
}

async function bootstrapDeterministicData(page) {
  await page.addInitScript(() => {
    const now = new Date();
    const mk = (deltaMonth, day, done, title, asset) => {
      const d = new Date(now.getFullYear(), now.getMonth() + deltaMonth, day, 12, 0, 0, 0);
      return {
        id: `e2e_${title}_${d.getTime()}`,
        title,
        cat: "casa",
        asset,
        date: d.toISOString(),
        budget: 42,
        notes: "",
        done,
        mandatory: false,
        essential: true,
        autoPay: false,
        estimateMissing: false,
        documents: [],
        recurring: null,
      };
    };
    const deadlines = [
      mk(-1, 10, false, "E2E_OVERDUE", "E2E_ASSET"),
      mk(0, 15, true, "E2E_DONE", "E2E_ASSET"),
      mk(1, 20, false, "E2E_TIMELINE", "E2E_ASSET"),
    ];
    const categories = [
      { id: "casa", label: "Casa", icon: "🏠", color: "#E8855D", light: "#E8855D22", assets: ["E2E_ASSET"] },
      { id: "auto", label: "Auto", icon: "🚗", color: "#5B8DD9", light: "#5B8DD922", assets: [] },
    ];
    localStorage.setItem("lifetrack_sync_enabled", "false");
    localStorage.setItem("lifetrack_categories", JSON.stringify(categories));
    localStorage.setItem("lifetrack_deadlines", JSON.stringify(deadlines));
    localStorage.setItem("lifetrack_worklogs", JSON.stringify({}));
    localStorage.setItem("lifetrack_asset_docs", JSON.stringify({}));
    localStorage.setItem("lifetrack_pets", JSON.stringify([]));
    localStorage.setItem("lifetrack_pet_events", JSON.stringify([]));
    localStorage.setItem("lifetrack_pet_deadlines", JSON.stringify([]));
    localStorage.setItem("lifetrack_pet_docs", JSON.stringify([]));
  });
}

async function loginIfNeeded(page) {
  if (!HAS_CREDS && E2E_STRICT) {
    throw new Error("Missing E2E_EMAIL/E2E_PASSWORD for strict E2E run");
  }
  await page.goto("/");
  await expect(page.getByText("LifeTrack")).toBeVisible();

  const timelineTab = page.getByRole("button", { name: /timeline/i });
  const emailInput = page.getByPlaceholder(/email\.com/i);
  await expect(timelineTab.or(emailInput)).toBeVisible({ timeout: 20000 });
  if (await timelineTab.isVisible().catch(() => false)) return;

  await emailInput.fill(E2E_EMAIL);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.getByRole("button", { name: /accedi|sign in|login/i }).click();
  await expect(page.getByRole("button", { name: /timeline/i })).toBeVisible({ timeout: 20000 });
}

test("new deadline wizard opens from + without white screen", async ({ page }) => {
  skipIfNoCredsInLocal();
  await bootstrapDeterministicData(page);
  await loginIfNeeded(page);

  await page.getByRole("button", { name: "+" }).last().click();
  await expect(page.getByText(/nuova scadenza|modifica scadenza|new deadline|edit deadline/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /avanti|next/i })).toBeVisible();
});

test("overdue tab can navigate to previous month with data", async ({ page }) => {
  skipIfNoCredsInLocal();
  await bootstrapDeterministicData(page);
  await loginIfNeeded(page);

  await page.getByRole("button", { name: /scadute|overdue/i }).click();
  await page.getByRole("button", { name: "‹" }).click();
  await expect(page.getByText("E2E_OVERDUE")).toBeVisible();
});

test("asset add-work modal opens without runtime crash", async ({ page }) => {
  skipIfNoCredsInLocal();
  await bootstrapDeterministicData(page);
  await loginIfNeeded(page);

  await page.getByRole("button", { name: /asset/i }).click();
  await page.getByRole("button", { name: /e2e_asset/i }).first().click();
  await page.getByRole("button", { name: /aggiungi|add/i }).first().click();
  await expect(page.getByText(/titolo|title/i)).toBeVisible();
});
