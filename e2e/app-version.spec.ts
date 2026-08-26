import { expect, test } from "@playwright/test";
import { getPlatformProxy, type PlatformProxy } from "wrangler";

import { loadAppVersionBuildInfo } from "../scripts/app-version-build";
import { E2E_WRANGLER_ENVIRONMENT } from "../scripts/e2e-environment";
import { hashPassword } from "../src/lib/auth/password";

const OWNER = { email: "owner@example.test", password: "owner-password-value" };
const VERSION_INFO = loadAppVersionBuildInfo();

let platform: PlatformProxy<CloudflareEnv>;

test.beforeAll(async () => {
  platform = await getPlatformProxy<CloudflareEnv>({
    environment: E2E_WRANGLER_ENVIRONMENT,
    persist: true,
    remoteBindings: false,
  });
});

test.beforeEach(async () => {
  const ownerHash = await hashPassword(OWNER.password);
  await platform.env.DB.batch([
    platform.env.DB.prepare("DELETE FROM invitation_claims"),
    platform.env.DB.prepare("DELETE FROM household_invitations"),
    platform.env.DB.prepare("DELETE FROM completion_corrections"),
    platform.env.DB.prepare("DELETE FROM activity_logs"),
    platform.env.DB.prepare("DELETE FROM task_occurrences"),
    platform.env.DB.prepare("DELETE FROM task_rules"),
    platform.env.DB.prepare("DELETE FROM external_links"),
    platform.env.DB.prepare("DELETE FROM managed_items"),
    platform.env.DB.prepare("DELETE FROM household_members"),
    platform.env.DB.prepare("DELETE FROM profiles"),
    platform.env.DB.prepare("DELETE FROM households"),
    platform.env.DB.prepare("DELETE FROM users"),
    platform.env.DB.prepare(
      "INSERT INTO users (id, email, password_hash) VALUES ('owner', ?1, ?2)",
    ).bind(OWNER.email, ownerHash),
  ]);
});

test.afterAll(async () => {
  await platform.dispose();
});

test("ログイン後のフッターと設定メニューからバージョン情報を確認できる", async ({
  page,
}) => {
  await page.goto("/login");
  const loginRegion = page.getByRole("region", { name: "ログイン" });
  await loginRegion.getByLabel("メールアドレス").fill(OWNER.email);
  await loginRegion.getByLabel("パスワード").fill(OWNER.password);
  await loginRegion.getByRole("button", { name: "ログイン" }).click();
  await expect(page).toHaveURL(/\/$/u);

  const footer = page.getByRole("contentinfo");
  await expect(footer).toContainText(`YAMORU ${VERSION_INFO.version}`);
  await expect(footer).not.toContainText(VERSION_INFO.environment);
  await expect(footer).not.toContainText(VERSION_INFO.buildId);

  await page.getByRole("button", { name: "設定メニュー" }).click();
  await page.getByRole("link", { name: "ヘルプ" }).click();
  await expect(page).toHaveURL(/\/help$/u);
  await expect(page.getByText(
    `YAMORU ${VERSION_INFO.version} · ${VERSION_INFO.environment} · ${VERSION_INFO.buildId}`,
  )).toBeVisible();
});
