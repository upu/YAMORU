import { defineConfig, devices } from "@playwright/test";

import { E2E_WRANGLER_ENVIRONMENT } from "./scripts/e2e-environment.ts";

const E2E_AUTH_SECRET = "yamoru-e2e-auth-secret-at-least-32-characters";

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
  // e2e/preview配下はplaywright.preview.config.ts専用(配備済みpreviewへ
  // 直接アクセスするE2E、#151)。ローカルwebServerでは実行しない。
  testIgnore: "preview/**",
  timeout: 120_000,
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev:http",
    env: {
      AUTH_SECRET: E2E_AUTH_SECRET,
      AUTH_TRUST_HOST: "true",
      NEXT_DEV_WRANGLER_ENV: E2E_WRANGLER_ENVIRONMENT,
    },
    reuseExistingServer: false,
    timeout: 120_000,
    url: "http://localhost:3000/login",
  },
  workers: 1,
});
