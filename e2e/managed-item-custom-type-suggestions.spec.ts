import { type Page } from "@playwright/test";
import { expect, login, seedOwnerHousehold, test } from "./support/fixtures";

import { createManagedItem } from "../src/lib/d1/managed-items";

// Issue #288: 家庭内で1件目の「放課後デイサービス」を自由入力で登録済みという
// 前提を作る。2件目を登録するときに、同じ表記を候補から選べることを確かめる。
async function seedOwnerWithCustomTypeItem(db: D1Database): Promise<void> {
  await seedOwnerHousehold(db);
  const session = { userId: "owner" };
  const common = { externalUrl: null, note: null, productInfo: null, startedOn: null };
  await createManagedItem(db, session, {
    ...common,
    customItemType: "放課後デイサービス",
    itemTypeCode: null,
    kindCode: "service",
    name: "放課後等デイサービスA",
  });
  await createManagedItem(db, session, {
    ...common,
    customItemType: "虫かご",
    itemTypeCode: null,
    kindCode: "asset",
    name: "カブトムシの虫かご",
  });
}

async function openRegistrationWithCustomItemType(page: Page): Promise<void> {
  await login(page);
  await page.goto("/managed-items/new");
  await page.getByLabel("大分類").selectOption("service");
  await page.getByLabel("詳しい種類（任意）").selectOption("__custom__");
}

test.beforeEach(async ({ db }) => {
  await seedOwnerWithCustomTypeItem(db);
});

test("登録画面で家庭内の自由入力の詳しい種類を候補から選び、表記を揃えて登録できる", async ({
  page,
}) => {
  await openRegistrationWithCustomItemType(page);

  const suggestions = page.getByRole("group", { name: "使用中の詳しい種類から選ぶ" });
  await expect(suggestions.getByRole("button", { name: "放課後デイサービス" })).toBeVisible();
  // 別の大分類でだけ使っている自由入力は候補へ出さない。
  await expect(suggestions.getByRole("button", { name: "虫かご" })).toHaveCount(0);

  const customItemType = page.getByLabel("詳しい種類を入力");
  await customItemType.fill("放課後");
  await expect(page.getByText("使用中の種類が1件あります。選ぶと入力欄へ入ります。")).toBeVisible();
  await suggestions.getByRole("button", { name: "放課後デイサービス" }).click();
  await expect(customItemType).toHaveValue("放課後デイサービス");

  await page.getByLabel("名前").fill("放課後等デイサービスB");
  await page.getByRole("button", { name: "管理対象を登録" }).click();

  await expect(page).toHaveURL(/\/managed-items\/[^/]+$/u);
  await expect(page.getByText("放課後デイサービス").first()).toBeVisible();

  // 表記が揃っているため、一覧の詳しい種類の絞り込みで2件ともまとめて見つかる。
  await page.goto("/managed-items?itemType=custom%3A%E6%94%BE%E8%AA%B2%E5%BE%8C%E3%83%87%E3%82%A4%E3%82%B5%E3%83%BC%E3%83%93%E3%82%B9");
  await expect(page.getByLabel("2件")).toBeVisible();
});

test("候補にない詳しい種類は、これまでどおりそのまま自由入力できる", async ({ page }) => {
  await openRegistrationWithCustomItemType(page);

  const customItemType = page.getByLabel("詳しい種類を入力");
  await customItemType.fill("訪問リハビリ");

  await expect(
    page.getByText("入力中の文字に一致する使用中の種類はありません。新しい種類として入力できます。"),
  ).toBeVisible();
  await expect(page.getByRole("group", { name: "使用中の詳しい種類から選ぶ" })).toHaveCount(0);

  await page.getByLabel("名前").fill("週末の訪問リハビリ");
  await page.getByRole("button", { name: "管理対象を登録" }).click();

  await expect(page).toHaveURL(/\/managed-items\/[^/]+$/u);
  await expect(page.getByText("訪問リハビリ").first()).toBeVisible();
});

test.describe("モバイル幅", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("候補を並べても登録フォームで横スクロールが発生しない", async ({ page }) => {
    await openRegistrationWithCustomItemType(page);

    await expect(
      page.getByRole("group", { name: "使用中の詳しい種類から選ぶ" })
        .getByRole("button", { name: "放課後デイサービス" }),
    ).toBeVisible();
    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasHorizontalOverflow).toBe(false);
  });
});
