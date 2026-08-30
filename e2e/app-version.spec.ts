import { E2E_OWNER, expect, test } from "./support/fixtures";

import { loadAppVersionBuildInfo } from "../scripts/app-version-build";
import { hashPassword } from "../src/lib/auth/password";

const VERSION_INFO = loadAppVersionBuildInfo();

test.beforeEach(async ({ db }) => {
  // 家庭に所属しない利用者でも、ログイン後の共通フッターに版番号が出る。
  const ownerHash = await hashPassword(E2E_OWNER.password);
  await db.prepare("INSERT INTO users (id, email, password_hash) VALUES ('owner', ?1, ?2)")
    .bind(E2E_OWNER.email, ownerHash).run();
});

test("ログイン後のフッターと設定メニューからバージョン情報を確認できる", async ({
  page,
}) => {
  await page.goto("/login");
  const loginRegion = page.getByRole("region", { name: "ログイン" });
  await loginRegion.getByLabel("メールアドレス").fill(E2E_OWNER.email);
  await loginRegion.getByLabel("パスワード").fill(E2E_OWNER.password);
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
