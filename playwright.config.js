import { defineConfig } from "@playwright/test";
import path from "node:path";

const tmpBase = process.env.TMPDIR || "/tmp";
const pwOutDir = path.join(tmpBase, "lifetrack-playwright-results");

export default defineConfig({
  testDir: "tests",
  outputDir: pwOutDir,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
  },
});
