import { defineConfig, devices } from "@playwright/test";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default defineConfig({
  globalSetup: "./playwright.global-setup.ts",
  testDir: "./tests",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  use: {
    headless: true,
    trace: "off",
    viewport: { width: 1280, height: 720 },
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    env: { ...process.env, NEXT_PUBLIC_API_URL: API_BASE },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});

