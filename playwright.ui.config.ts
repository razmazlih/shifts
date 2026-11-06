import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/ui",
  testMatch: "**/*.spec.ts",
  workers: 1,
  timeout: 20000,
  outputDir: "output/smart-schedule-ui/results",
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3348",
    browserName: "chromium",
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
    screenshot: "only-on-failure",
  },
  webServer: { command: "node scripts/serve-smart-schedule-harness.mjs", url: "http://127.0.0.1:3348", reuseExistingServer: false },
});
