import { defineConfig, devices } from "@playwright/test";

import { getE2ETestEnvironment } from "./scripts/e2e-environment.ts";

const environment = getE2ETestEnvironment();

export default defineConfig({
  expect: { timeout: 10_000 },
  forbidOnly: true,
  fullyParallel: false,
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  reporter: "list",
  testDir: "./e2e",
  timeout: 120_000,
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev:http",
    env: {
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: environment.publishableKey,
      NEXT_PUBLIC_SUPABASE_URL: environment.supabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: environment.serviceRoleKey,
    },
    reuseExistingServer: false,
    timeout: 120_000,
    url: "http://localhost:3000/login",
  },
  workers: 1,
});
