import { expect, test } from "@playwright/test";
import { getPlatformProxy, type PlatformProxy } from "wrangler";

import { hashPassword } from "../src/lib/auth/password";
import { createManagedItem } from "../src/lib/d1/managed-items";
import { E2E_WRANGLER_ENVIRONMENT } from "../scripts/e2e-environment";

const OWNER = { email: "owner@example.test", password: "owner-password-value" };
// 大分類は中黒を含む実際のラベル、詳しい種類は自由入力の上限に近い長さを使い、
// 連結表示に戻っていないことと、狭い画面でも折り返せることを同時に確かめる。
const KIND_LABEL = "支払い・手続き";
const LONG_ITEM_TYPE = "とても長い名前の詳しい種類サンプル文字列";
const ITEM_NAME = "2026年度 固定資産税";

let platform: PlatformProxy<CloudflareEnv>;
let managedItemId: string;

// iPhone相当の幅。バッジを二つ並べても横スクロールが出ないことを確認する(#195)。
test.use({ viewport: { width: 390, height: 844 } });

async function clearDatabase(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM invitation_claims"),
    db.prepare("DELETE FROM household_invitations"),
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

async function seedOwnerWithClassifiedItem(db: D1Database): Promise<void> {
  const ownerHash = await hashPassword(OWNER.password);
  await db.batch([
    db.prepare(
      "INSERT INTO users (id, email, password_hash) VALUES ('owner', ?1, ?2)",
    ).bind(OWNER.email, ownerHash),
    db.prepare("INSERT INTO profiles (user_id, nickname) VALUES ('owner', '家族Aさん')"),
    db.prepare("INSERT INTO households (id, name) VALUES ('household-a', '架空の家庭A')"),
    db.prepare(
      "INSERT INTO household_members (household_id, user_id) VALUES ('household-a', 'owner')",
    ),
  ]);
  managedItemId = await createManagedItem(db, { userId: "owner" }, {
    customItemType: LONG_ITEM_TYPE,
    externalUrl: null,
    itemTypeCode: null,
    kindCode: "obligation",
    name: ITEM_NAME,
    note: null,
    productInfo: null,
    purchasedOn: null,
  });
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
  await seedOwnerWithClassifiedItem(platform.env.DB);
});

test.afterAll(async () => {
  await platform.dispose();
});

test("モバイル幅の台帳一覧と詳細で大分類と詳しい種類が別々のバッジとして収まる", async ({
  page,
}) => {
  await page.goto("/login");
  const loginRegion = page.getByRole("region", { name: "ログイン" });
  await loginRegion.getByLabel("メールアドレス").fill(OWNER.email);
  await loginRegion.getByLabel("パスワード").fill(OWNER.password);
  await loginRegion.getByRole("button", { name: "ログイン" }).click();
  await expect(page).toHaveURL(/\/$/u);

  for (const path of ["/managed-items", `/managed-items/${managedItemId}`]) {
    await page.goto(path);

    const badges = page.getByRole("list", { name: "分類" });
    await expect(badges.getByRole("listitem")).toHaveText([
      `大分類: ${KIND_LABEL}`,
      `詳しい種類: ${LONG_ITEM_TYPE}`,
    ]);

    // 二つのバッジが別々の列または行として置かれ、重なっていない。
    const kindBox = await badges.getByRole("listitem").first().boundingBox();
    const itemTypeBox = await badges.getByRole("listitem").last().boundingBox();
    if (kindBox === null || itemTypeBox === null) {
      throw new Error(`${path}でバッジが描画されていない`);
    }
    const separated =
      kindBox.x + kindBox.width <= itemTypeBox.x + 1
      || kindBox.y + kindBox.height <= itemTypeBox.y + 1;
    expect(separated, `${path}のバッジが重なっている`).toBe(true);

    // 390px幅で横スクロールが発生しない。
    const overflow = await page.evaluate(() => {
      const root = document.documentElement;
      return root.scrollWidth - root.clientWidth;
    });
    expect(overflow, `${path}で横スクロールが発生している`).toBeLessThanOrEqual(0);
  }
});
