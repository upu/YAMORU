import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.YAMORU_PREVIEW_URL;
if (baseURL === undefined || baseURL === "") {
  throw new Error(
    "YAMORU_PREVIEW_URL環境変数に、配備済みpreviewの公開HTTPS URLを指定してください。",
  );
}

// deploy-preview.ymlが公開境界smoke(cf:smoke)の後に実行する、家族利用の
// 主要導線に対する自動E2E(#151)。ローカルwebServerは起動せず、既に配備
// 済みのpreview URLへ直接アクセスする点がplaywright.config.tsと異なる。
export default defineConfig({
  expect: { timeout: 15_000 },
  forbidOnly: true,
  fullyParallel: false,
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  reporter: "list",
  testDir: "./e2e/preview",
  timeout: 180_000,
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  workers: 1,
});
