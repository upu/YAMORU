import { type Locator, type Page } from "@playwright/test";

import {
  E2E_OWNER_USER_ID,
  expect,
  login,
  seedManagedItem,
  seedOwnerHousehold,
  test,
} from "./support/fixtures";

// Issue #400: 台帳の「家の台帳」は詳細画面と同じ大見出しで、スマホではキッカー・
// 大見出し・説明文だけでページ上部の縦幅を使っていた。台帳は一覧を日常的に確認・
// 操作する画面なので、本文を早く見られるほうを優先する。実際の描画で、見出しの
// 大きさと本文が始まるまでの縦幅を測る。

const ITEM_NAME = "リビングのエアコン";

// 変更前に実測した、mainの上端からカテゴリ切り替えの上端までの縦幅。
// 390pxで137px、320pxで158px使っていた。
const HEADER_HEIGHT_LIMIT = { 320: 120, 390: 100 } as const;

async function topOf(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("位置を取得できなかった");
  return box.y;
}

async function fontSizeOf(locator: Locator): Promise<number> {
  return locator.evaluate(
    (element) => Number.parseFloat(globalThis.getComputedStyle(element).fontSize),
  );
}

// mainの上端からカテゴリ切り替えの上端まで。ここが本文へたどり着くまでの縦幅。
async function headerHeight(page: Page): Promise<number> {
  const main = await topOf(page.getByRole("main"));
  const categories = await topOf(page.getByRole("navigation", { name: "台帳の種類" }));
  return categories - main;
}

async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
}

test.beforeEach(async ({ db }) => {
  await seedOwnerHousehold(db);
  await seedManagedItem(db, ITEM_NAME, E2E_OWNER_USER_ID);
});

test.describe("モバイル幅(390px)", () => {
  test.use({ viewport: { height: 844, width: 390 } });

  test("ページ見出しは詳細画面の大見出しより小さく、詳細画面の側は変えない", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/managed-items");
    const ledgerTitle = await fontSizeOf(
      page.getByRole("heading", { level: 1, name: "家の台帳" }),
    );

    await page.getByRole("link", { exact: true, name: ITEM_NAME }).click();
    await expect(page).toHaveURL(/\/managed-items\/[^/]+$/u);
    const detailTitle = await fontSizeOf(
      page.getByRole("heading", { level: 1, name: ITEM_NAME }),
    );

    expect(ledgerTitle).toBeLessThan(detailTitle);
    // 詳細画面はclamp(2rem, 8vw, 3.1rem)のまま。台帳を小さくしたついでに
    // ほかの画面の大見出しまで縮めていないことを、この下限で押さえる。
    expect(detailTitle).toBeGreaterThanOrEqual(32);
  });

  test("ヘッダーが本文を押し下げず、台帳の操作はそのまま使える", async ({ page }) => {
    await login(page);
    await page.goto("/managed-items");

    expect(await headerHeight(page)).toBeLessThanOrEqual(HEADER_HEIGHT_LIMIT[390]);

    // 既存の操作(カテゴリ切り替え・検索・追加)は残す。モバイル幅の追加導線は
    // 右下のフローティングボタンだけ(#391)。
    await expect(page.getByRole("searchbox", { name: "管理対象名で検索" })).toBeVisible();
    await expect(page.getByRole("link", { name: "備品を登録" })).toBeVisible();
    await page.getByRole("navigation", { name: "台帳の種類" })
      .getByRole("link", { name: "消耗品" }).click();
    await expect(page).toHaveURL(/\/consumables$/u);
    // カテゴリを切り替えても見出しは「家の台帳」のまま(#309)。
    await expect(page.getByRole("heading", { level: 1, name: "家の台帳" })).toBeVisible();
  });
});

test.describe("最小幅(320px)", () => {
  test.use({ viewport: { height: 720, width: 320 } });

  test("見出しと説明文が重ならず、横スクロールも出ない", async ({ page }) => {
    await login(page);
    await page.goto("/managed-items");

    expect(await headerHeight(page)).toBeLessThanOrEqual(HEADER_HEIGHT_LIMIT[320]);

    const title = await page.getByRole("heading", { level: 1, name: "家の台帳" })
      .boundingBox();
    const description = await page
      .getByText("家の備品、サービス・契約、消耗品をまとめます。").boundingBox();
    if (title === null || description === null) throw new Error("位置を取得できなかった");

    expect(description.y).toBeGreaterThanOrEqual(title.y + title.height - 1);
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });
});
