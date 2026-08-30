import { type Page } from "@playwright/test";
import { expect, login, seedOwnerHousehold, test } from "./support/fixtures";

import { createManagedItem } from "../src/lib/d1/managed-items";

async function seedOwnerWithItems(db: D1Database): Promise<void> {
  await seedOwnerHousehold(db);
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

async function loginAndOpenLedger(page: Page): Promise<void> {
  await login(page);
  await page.goto("/managed-items");
}

test.beforeEach(async ({ db }) => {
  await seedOwnerWithItems(db);
});

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
  // Issue #285: 名前の入力欄は検索・絞り込み領域の中にあり、登録用ではない。
  await expect(nameSearch).toHaveAttribute("placeholder", "名前で検索");
  await expect(page.getByRole("form", { name: "検索・絞り込み" })).toContainText("検索・絞り込み");
  await nameSearch.fill("冷蔵");
  await expect(page).not.toHaveURL(/[?&]q=/u);
  await page.getByRole("button", { name: "名前を検索" }).click();
  await expect(page).toHaveURL(/[?&]q=%E5%86%B7%E8%94%B5\b/u);
  await expect(page.getByRole("link", { name: "台所の冷蔵庫" })).toBeVisible();

  // Issue #285: 検索欄へ入力せずに新規登録へ進める入口を一覧画面に置く。
  await page.getByRole("link", { name: "新しく登録" }).click();
  await expect(page).toHaveURL(/\/managed-items\/new$/u);
});

test.describe("モバイル幅", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("候補を初期表示せず、分類フォームで横スクロールが発生しない", async ({ page }) => {
    await loginAndOpenLedger(page);

    await expect(page.getByRole("radio", { name: "すべて" })).toHaveCount(0);
    await expect(page.getByRole("radio", { name: "家電" })).toHaveCount(0);
    // Issue #285: 検索・絞り込みの見出しと新規登録の入口が、モバイル幅でも
    // 一覧の上に収まって見える。
    await expect(page.getByRole("heading", { name: "検索・絞り込み" })).toBeVisible();
    await expect(page.getByRole("link", { name: "新しく登録" })).toBeVisible();
    await expect(page.getByRole("link", { name: "台所の冷蔵庫" })).toBeVisible();
    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasHorizontalOverflow).toBe(false);
  });
});
