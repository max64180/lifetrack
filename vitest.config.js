import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: "./vitest.setup.js",
    clearMocks: true,
    globals: true,
    include: ["src/**/*.test.{js,jsx,ts,tsx}"],
    exclude: ["**/node_modules/**", "tests/**"],
  },
});
