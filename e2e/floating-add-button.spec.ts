import { expect, test, type Page } from "@playwright/test";
import { getPlatformProxy, type PlatformProxy } from "wrangler";

import { hashPassword } from "../src/lib/auth/password";
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

async function seedOwner(db: D1Database): Promise<void> {
  const ownerHash = await hashPassword(OWNER.password);
  await db.batch([
    db.prepare(
      "INSERT INTO users (id, email, password_hash) VALUES ('owner', ?1, ?2)",
    ).bind(OWNER.email, ownerHash),
    db.prepare(
      "INSERT INTO profiles (user_id, nickname) VALUES ('owner', '家族Aさん')",
    ),
    db.prepare(
      "INSERT INTO households (id, name) VALUES ('household-a', '架空の家庭A')",
    ),
    db.prepare(
      "INSERT INTO household_members (household_id, user_id) VALUES ('household-a', 'owner')",
    ),
  ]);
}

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  const loginRegion = page.getByRole("region", { name: "ログイン" });
  await loginRegion.getByLabel("メールアドレス").fill(OWNER.email);
  await loginRegion.getByLabel("パスワード").fill(OWNER.password);
  await loginRegion.getByRole("button", { name: "ログイン" }).click();
  await expect(page).toHaveURL(/\/$/u);
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
  await seedOwner(platform.env.DB);
});

test.afterAll(async () => {
  await platform.dispose();
});

test.describe("モバイル幅", () => {
  test.use({ viewport: { height: 844, width: 390 } });

  test("追加ボタンが下部ナビゲーションの上にあり、画面ごとに行き先が変わる", async ({
    page,
  }) => {
    await login(page);

    const todoAdd = page.getByRole("link", { name: "Todoを追加" });
    const navigation = page.getByRole("navigation", { name: "主要ナビゲーション" });
    await expect(todoAdd).toBeVisible();
    await expect(todoAdd).toHaveText("＋");
    const [todoAddBox, navigationBox] = await Promise.all([
      todoAdd.boundingBox(),
      navigation.boundingBox(),
    ]);
    expect(todoAddBox).not.toBeNull();
    expect(navigationBox).not.toBeNull();
    expect((todoAddBox?.y ?? 0) + (todoAddBox?.height ?? 0))
      .toBeLessThanOrEqual((navigationBox?.y ?? 0) - 15);

    await navigation.getByRole("link", { name: "Todo" }).click();
    await expect(page.getByRole("link", { name: "Todoを追加" })).toHaveAttribute(
      "href",
      "/todos/new",
    );

    await navigation.getByRole("link", { name: "台帳" }).click();
    const ledgerAdd = page.getByRole("link", { name: "台帳に追加" });
    await expect(ledgerAdd).toHaveAttribute("href", "/managed-items/new");
    await ledgerAdd.click();
    await expect(page).toHaveURL(/\/managed-items\/new$/u);
    await expect(page.getByRole("link", { name: "台帳に追加" })).toHaveCount(0);
  });
});

test.describe("PC幅", () => {
  test.use({ viewport: { height: 900, width: 1280 } });

  test("追加ボタンを画面右下に固定する", async ({ page }) => {
    await login(page);

    const addButton = page.getByRole("link", { name: "Todoを追加" });
    await expect(addButton).toHaveText("＋");
    const box = await addButton.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.abs(1280 - ((box?.x ?? 0) + (box?.width ?? 0)) - 24))
      .toBeLessThanOrEqual(1);
    expect(Math.abs(900 - ((box?.y ?? 0) + (box?.height ?? 0)) - 24))
      .toBeLessThanOrEqual(1);
  });
});
