import { type Page } from "@playwright/test";

import { expect, login, seedOwnerHousehold, test } from "./support/fixtures";

// Issue #393: 備品・消耗品の登録画面から、入力欄のラベルやplaceholderと重なる
// 説明・見出しを減らした。縦にどれだけ詰まったかと、狭い幅でラベル・入力欄が
// 窮屈にならないかは実際の描画でしか分からないため、ここで確かめる
// (受け入れ基準の「390px幅で」「320px幅と390px幅で」に当たる確認)。

const REGISTRATION_PAGES = [
  { name: "備品", path: "/managed-items/new", submit: "管理対象を登録" },
  { name: "消耗品", path: "/consumables/new", submit: "消耗品を登録" },
] as const;

// 変更前の実測値(390px幅)。名前欄と登録ボタンの上端がここより上へ来ることを
// 確かめ、説明を戻したときに気付けるようにする。
const BEFORE_390PX = {
  "/consumables/new": { name: 333, submit: 979 },
  "/managed-items/new": { name: 374, submit: 1388 },
} as const;

async function topOf(page: Page, locator: ReturnType<Page["getByLabel"]>): Promise<number> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("要素の位置を取得できなかった");
  return box.y;
}

async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
}

test.beforeEach(async ({ db }) => {
  await seedOwnerHousehold(db);
});

test.describe("モバイル幅(390px)", () => {
  test.use({ viewport: { height: 844, width: 390 } });

  for (const { name, path, submit } of REGISTRATION_PAGES) {
    test(`${name}登録は見出し一つで始まり、必須項目と登録ボタンが上へ寄る`, async ({ page }) => {
      await login(page);
      await page.goto(path);

      // キッカーと大きな見出しを重ねず、小さめのページ見出し一つに収める。
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.locator(".detail-kicker")).toHaveCount(0);

      const nameTop = await topOf(page, page.getByLabel("名前").first());
      const submitTop = await topOf(page, page.getByRole("button", { name: submit }));
      expect(nameTop).toBeLessThan(BEFORE_390PX[path].name);
      expect(submitTop).toBeLessThan(BEFORE_390PX[path].submit);
    });
  }
});

for (const width of [320, 390]) {
  test.describe(`幅${String(width)}px`, () => {
    test.use({ viewport: { height: 844, width } });

    for (const { name, path } of REGISTRATION_PAGES) {
      test(`${name}登録のラベルと入力欄が横スクロールを出さない`, async ({ page }) => {
        await login(page);
        await page.goto(path);

        await expect(page.getByLabel("名前").first()).toBeVisible();
        expect(await hasHorizontalOverflow(page)).toBe(false);
      });
    }
  });
}
