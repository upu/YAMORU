import { E2E_OWNER_USER_ID, expect, login, seedOwnerHousehold, test } from "./support/fixtures";

import { createConsumable, updateConsumableStockStatus } from "../src/lib/d1/consumables";
import { createManagedItem } from "../src/lib/d1/managed-items";
import { createOneTimeTask } from "../src/lib/d1/todos";

// Issue #350 / YDR-042: 横断検索の入口(下部ナビゲーションの4項目目)と検索画面。
// 実利用の起点は「冷蔵庫を見て卵が少ないと気づく」場面なので、検索→卵→在庫の
// 経路をそのまま通す。狭い画面での4項目表示も同じspecで確認する。
test.use({ viewport: { width: 390, height: 844 } });

const session = { userId: E2E_OWNER_USER_ID };

test.beforeEach(async ({ db }) => {
  await seedOwnerHousehold(db);
  await createConsumable(db, session, {
    externalUrl: null,
    managedItemIds: [],
    name: "卵",
    note: null,
    productCode: null,
    taskRuleIds: [],
  });
  await createManagedItem(db, session, {
    customItemType: "調理器具",
    externalUrl: null,
    itemTypeCode: null,
    kindCode: "asset",
    name: "卵焼き器",
    note: null,
    productInfo: null,
    startedOn: null,
  });
  await createOneTimeTask(db, session, {
    managedItemId: null,
    scheduledFor: "2026-09-10",
    title: "卵を買う",
  });
});

test("下部ナビゲーションの「検索」から名前で探し、種類ごとの結果から詳細へ到達できる", async ({
  page,
}) => {
  await login(page);

  const navigation = page.getByRole("navigation", { name: "主要ナビゲーション" });
  await navigation.getByRole("link", { name: "検索" }).click();
  await expect(page).toHaveURL(/\/search$/u);
  await expect(navigation.getByRole("link", { name: "検索" }))
    .toHaveAttribute("aria-current", "page");

  // 検索語が無いときは0件表示ではなく使い方の案内を出す。
  await expect(page.getByText("名前を入力すると", { exact: false })).toBeVisible();

  const searchForm = page.getByRole("search", { name: "YAMORU全体を検索" });
  await searchForm.getByLabel("名前で検索").fill("卵");
  await searchForm.getByRole("button", { name: "検索" }).click();

  // URLへ検索語が残り、再読み込み・共有で同じ結果になる。
  await expect(page).toHaveURL(/\/search\?q=/u);

  // 種類ごとのセクションへ分かれ、どの種類かが分かる。
  const todoSection = page.getByRole("region", { name: "Todo" });
  const assetSection = page.getByRole("region", { name: "備品" });
  const consumableSection = page.getByRole("region", { name: "消耗品" });
  await expect(todoSection.getByRole("link", { name: "卵を買う" })).toBeVisible();
  await expect(assetSection.getByRole("link", { name: "卵焼き器" })).toBeVisible();
  await expect(consumableSection.getByRole("link", { name: "卵" })).toBeVisible();

  // 消耗品の行では、詳細へ入る前に在庫状態が分かる。
  await expect(consumableSection.getByText("ある")).toBeVisible();

  // 行から対象の詳細へ移動できる(卵の在庫を更新する導線)。
  await consumableSection.getByRole("link", { name: "卵" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "卵" })).toBeVisible();
});

test("在庫状態を変えると検索結果の表示も変わる", async ({ db, page }) => {
  const consumableId = await db.prepare("SELECT id FROM consumables WHERE name = '卵'")
    .first<{ id: string }>();
  if (consumableId === null) throw new Error("Test consumable not found");
  await updateConsumableStockStatus(db, session, consumableId.id, "low");

  await login(page);
  await page.goto("/search?q=%E5%8D%B5");

  const consumableSection = page.getByRole("region", { name: "消耗品" });
  await expect(consumableSection.getByText("少ない")).toBeVisible();
});

test("一致しない検索語では0件と各一覧の入口を示す", async ({ page }) => {
  await login(page);
  await page.goto("/search?q=%E3%81%82%E3%82%8A%E5%BE%97%E3%81%AA%E3%81%84%E5%90%8D%E5%89%8D");

  await expect(page.getByRole("heading", { name: /に一致する対象はありません/u })).toBeVisible();
  await expect(page.getByRole("link", { name: "Todo一覧を開く" })).toBeVisible();
  await expect(page.getByRole("link", { name: "台帳（消耗品）を開く" })).toBeVisible();
});

test("狭い画面でも4項目のラベルが1行に収まり、横スクロールが出ない", async ({ page }) => {
  await page.setViewportSize({ height: 640, width: 320 });
  await login(page);

  const navigation = page.getByRole("navigation", { name: "主要ナビゲーション" });
  const labels = ["ホーム", "Todo", "台帳", "検索"];
  for (const label of labels) {
    const link = navigation.getByRole("link", { name: label });
    await expect(link).toBeVisible();
    // ラベルが折り返すと1行分(line-height 1.2 × 0.7rem ≒ 13.4px)を超える。
    const lineCount = await link.locator("span").evaluate(
      (element) => Math.round(element.getBoundingClientRect().height / 14),
    );
    expect(lineCount).toBe(1);
  }

  await expect(page.evaluate(() => document.documentElement.scrollWidth))
    .resolves.toBeLessThanOrEqual(320);
});

test("公開画面には検索の入口を出さない", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("navigation", { name: "主要ナビゲーション" })).toHaveCount(0);
});
