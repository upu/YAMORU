import { defineConfig } from "@playwright/test";
import base from "../playwright.config";
import { E2E_AUTH_SECRET } from "../scripts/e2e-environment";
import { fileURLToPath } from "node:url";
export default defineConfig({ ...base, testDir: "../e2e", testMatch: ["**/mcp-integration.spec.ts", "**/notification-scheduler.worker-e2e.ts"],
  use: { ...base.use, baseURL: "http://localhost:8787" },
  webServer: { command: `node --env-file=scripts/d1-test.env ./node_modules/wrangler/bin/wrangler.js dev --env e2e --local --test-scheduled --port 8787 --var AUTH_SECRET:${E2E_AUTH_SECRET}`, cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { AUTH_SECRET: E2E_AUTH_SECRET, AUTH_TRUST_HOST: "true" }, url: "http://localhost:8787/login", timeout: 120_000, reuseExistingServer: false },
});
