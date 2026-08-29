import { expect, test } from "@playwright/test";
import { getPlatformProxy, type PlatformProxy } from "wrangler";

import { hashPassword } from "../src/lib/auth/password";
import { createManagedItem } from "../src/lib/d1/managed-items";
import { E2E_WRANGLER_ENVIRONMENT } from "../scripts/e2e-environment";

const OWNER = { email: "owner@example.test", password: "owner-password-value" };
let platform: PlatformProxy<CloudflareEnv>;

async function clearDatabase(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM invitation_claims"),
    db.prepare("DELETE FROM household_invitations"),
    db.prepare("DELETE FROM completion_corrections"),
    db.prepare("DELETE FROM activity_logs"),
    db.prepare("DELETE FROM task_occurrences"),
    db.prepare("DELETE FROM task_rules"),
    db.prepare("DELETE FROM external_links"),
    db.prepare("DELETE FROM managed_items"),
    db.prepare("DELETE FROM household_members"),
    db.prepare("DELETE FROM profiles"),
    db.prepare("DELETE FROM households"),
    db.prepare("DELETE FROM users"),
  ]);
}

async function seedOwnerWithItems(db: D1Database): Promise<void> {
  const ownerHash = await hashPassword(OWNER.password);
  await db.batch([
    db.prepare("INSERT INTO users (id, email, password_hash) VALUES ('owner', ?1, ?2)")
      .bind(OWNER.email, ownerHash),
    db.prepare("INSERT INTO profiles (user_id, nickname) VALUES ('owner', '家族Aさん')"),
    db.prepare("INSERT INTO households (id, name) VALUES ('household-a', '架空の家庭A')"),
    db.prepare("INSERT INTO household_members (household_id, user_id) VALUES ('household-a', 'owner')"),
  ]);
  const session = { userId: "owner" };
  const common = { externalUrl: null, note: null, productInfo: null, startedOn: null };
  await createManagedItem(db, session, {
    ...common, customItemType: null, itemTypeCode: "appliance", kindCode: "asset", name: "台所の冷蔵庫",
  });
  await createManagedItem(db, session, {
    ...common, customItemType: "虫かご", itemTypeCode: null, kindCode: "asset", name: "カブトムシの虫かご",
  });
  await createManagedItem(db, session, {
    ...common, customItemType: null, itemTypeCode: "contract", kindCode: "service", name: "動画配信契約",
  });
}

async function loginAndOpenLedger(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/login");
  const loginRegion = page.getByRole("region", { name: "ログイン" });
  await loginRegion.getByLabel("メールアドレス").fill(OWNER.email);
  await loginRegion.getByLabel("パスワード").fill(OWNER.password);
  await loginRegion.getByRole("button", { name: "ログイン" }).click();
  await expect(page).toHaveURL(/\/$/u);
  await page.goto("/managed-items");
}

test.beforeAll(async () => {
  platform = await getPlatformProxy<CloudflareEnv>({
    environment: E2E_WRANGLER_ENVIRONMENT,
    persist: true,
    remoteBindings: false,
  });
});

test.beforeEach(async () => {
  await clearDatabase(platform.env.DB);
  await seedOwnerWithItems(platform.env.DB);
});

test.afterAll(async () => { await platform.dispose(); });

test("PC幅: 分類は選択時に即時反映し、詳しい種類は入力後にキーボードで選べる", async ({
  page,
}) => {
  await loginAndOpenLedger(page);
  await expect(page.getByLabel("3件")).toBeVisible();
  await expect(page.getByRole("radio", { name: "家電" })).toHaveCount(0);

  await page.getByLabel("大分類で絞り込み").selectOption("service");
  await expect(page).toHaveURL(/[?&]kind=service\b/u);
  await expect(page.getByLabel("1件")).toBeVisible();
  await expect(page.getByRole("link", { name: "動画配信契約" })).toBeVisible();

  await page.getByLabel("大分類で絞り込み").selectOption("");
  await expect(page).not.toHaveURL(/[?&]kind=/u);
  const itemTypeSearch = page.getByRole("searchbox", { name: "詳しい種類の一部を入力" });
  await itemTypeSearch.fill("虫");
  await expect(page.getByText("1件見つかりました。")).toBeVisible();
  const customType = page.getByRole("radio", { name: "虫かご（自由入力）" });
  await customType.focus();
  await expect(customType).toBeFocused();
  await page.keyboard.press("Space");

  await expect(page).toHaveURL(/[?&]itemType=custom%3A%E8%99%AB%E3%81%8B%E3%81%94\b/u);
  await expect(page.getByLabel("1件")).toBeVisible();
  const clearType = page.getByRole("link", { name: "詳しい種類「虫かご」を解除" });
  await clearType.focus();
  await page.keyboard.press("Enter");
  await expect(page).not.toHaveURL(/[?&]itemType=/u);

  const nameSearch = page.getByRole("searchbox", { name: "管理対象名で検索" });
  await nameSearch.fill("冷蔵");
  await expect(page).not.toHaveURL(/[?&]q=/u);
  await page.getByRole("button", { name: "名前を検索" }).click();
  await expect(page).toHaveURL(/[?&]q=%E5%86%B7%E8%94%B5\b/u);
  await expect(page.getByRole("link", { name: "台所の冷蔵庫" })).toBeVisible();
});

test.describe("モバイル幅", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("候補を初期表示せず、分類フォームで横スクロールが発生しない", async ({ page }) => {
    await loginAndOpenLedger(page);

    await expect(page.getByRole("radio", { name: "すべて" })).toHaveCount(0);
    await expect(page.getByRole("radio", { name: "家電" })).toHaveCount(0);
    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasHorizontalOverflow).toBe(false);
  });
});
