import { type Page } from "@playwright/test";

import { expect, login, seedOwnerHousehold, test } from "./support/fixtures";

// Issue #219: モバイル幅より広い画面には主要ナビゲーションが無く、行き先へ
// 移動する手段が共通ヘッダーのYAMORU(ホーム)だけだった。PCではサイドバー、
// モバイルでは下部ナビゲーションと出し分ける。どちらが出るか・本文を覆わない
// か・拡大しても使えるかは、実際の描画でしか確かめられない。

// 文字サイズだけを2倍にした状態(既定16px)。ページ全体の拡大とは違い、幅は
// 変わらず文字だけが大きくなるため、サイドバーの逃げ場を確かめられる。
const DOUBLED_TEXT_STYLE = "html { font-size: 32px !important; }";

function primaryNavigation(page: Page) {
  return page.getByRole("navigation", { name: "主要ナビゲーション" });
}

async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
}

test.beforeEach(async ({ db }) => {
  await seedOwnerHousehold(db);
});

test.describe("PC幅(1280px)", () => {
  test.use({ viewport: { height: 900, width: 1280 } });

  test("サイドバーで主要な移動先を常に見せ、現在地を示す", async ({ page }) => {
    await login(page);
    await page.goto("/todos");

    const navigation = primaryNavigation(page);
    // 下部ナビゲーションはdisplay: noneなので、支援技術からも一つだけ見える。
    await expect(navigation).toHaveCount(1);
    await expect(navigation.getByRole("link")).toHaveCount(4);
    for (const name of ["ホーム", "Todo", "台帳", "検索"]) {
      await expect(navigation.getByRole("link", { name })).toBeVisible();
    }
    await expect(navigation.getByRole("link", { name: "Todo" }))
      .toHaveAttribute("aria-current", "page");

    // 画面の左端に立て、本文を覆わない。
    const sidebar = await navigation.boundingBox();
    const content = await page.getByRole("main").boundingBox();
    if (sidebar === null || content === null) throw new Error("位置を取得できなかった");
    expect(sidebar.x).toBe(0);
    expect(sidebar.height).toBeGreaterThan(400);
    expect(content.x).toBeGreaterThanOrEqual(sidebar.x + sidebar.width);
  });

  test("サイドバーから移動すると現在地の表示が移る", async ({ page }) => {
    await login(page);
    await page.goto("/todos");

    await primaryNavigation(page).getByRole("link", { name: "台帳" }).click();
    await expect(page).toHaveURL(/\/managed-items/u);
    await expect(primaryNavigation(page).getByRole("link", { name: "台帳" }))
      .toHaveAttribute("aria-current", "page");
    await expect(primaryNavigation(page).getByRole("link", { name: "Todo" }))
      .not.toHaveAttribute("aria-current", "page");
  });

  test("キーボードだけでサイドバーの項目へ移動して開ける", async ({ page }) => {
    await login(page);
    await page.goto("/");

    const search = primaryNavigation(page).getByRole("link", { name: "検索" });
    await search.focus();
    await expect(search).toBeFocused();
    // フォーカス表示(outline)が付く。
    await expect(search).toHaveCSS("outline-style", "solid");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/search$/u);
  });

  test("文字サイズを2倍にしてもサイドバーと本文が横へはみ出さない", async ({ page }) => {
    await login(page);
    await page.goto("/todos");
    await page.addStyleTag({ content: DOUBLED_TEXT_STYLE });

    await expect(primaryNavigation(page).getByRole("link", { name: "台帳" }))
      .toBeVisible();
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });

  // 補助導線(アカウント・家庭・ヘルプ)は共通ヘッダーの設定メニューのまま。
  // 同じ行き先をサイドバーにも並べて二重に出すことはしない(#391の規約)。
  test("補助導線は共通ヘッダーの設定メニューから開ける", async ({ page }) => {
    await login(page);
    await page.goto("/todos");

    await page.getByRole("button", { name: "設定メニュー" }).click();
    const menu = page.getByRole("navigation", { name: "設定メニュー" });
    for (const name of ["アカウント", "家庭", "ヘルプ"]) {
      await expect(menu.getByRole("link", { name })).toBeVisible();
    }
    await expect(primaryNavigation(page).getByRole("link", { name: "アカウント" }))
      .toHaveCount(0);
  });

  test("ログイン画面にはサイドバーを出さない", async ({ page }) => {
    await page.goto("/login");

    await expect(primaryNavigation(page)).toHaveCount(0);
  });
});

// 中間幅は本文の幅を優先して折りたたむが、語そのものは残す。
test.describe("中間幅(768px)", () => {
  test.use({ viewport: { height: 900, width: 768 } });

  test("折りたたんだサイドバーでも、行き先の語が読める", async ({ page }) => {
    await login(page);
    await page.goto("/");

    const navigation = primaryNavigation(page);
    await expect(navigation).toHaveCount(1);
    for (const name of ["ホーム", "Todo", "台帳", "検索"]) {
      await expect(navigation.getByRole("link", { name })).toBeVisible();
    }
    const sidebar = await navigation.boundingBox();
    const content = await page.getByRole("main").boundingBox();
    if (sidebar === null || content === null) throw new Error("位置を取得できなかった");
    expect(content.x).toBeGreaterThanOrEqual(sidebar.x + sidebar.width);
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });
});

test.describe("モバイル幅(390px)", () => {
  test.use({ viewport: { height: 844, width: 390 } });

  test("下部ナビゲーションのままで、サイドバーは出さない", async ({ page }) => {
    await login(page);
    await page.goto("/todos");

    const navigation = primaryNavigation(page);
    await expect(navigation).toHaveCount(1);
    // 画面の下端に固定された帯のままであることで、下部ナビゲーションだと分かる。
    const box = await navigation.boundingBox();
    if (box === null) throw new Error("位置を取得できなかった");
    expect(box.x).toBe(0);
    expect(box.width).toBe(390);
    expect(box.y + box.height).toBeGreaterThan(844 - 100);

    const content = await page.getByRole("main").boundingBox();
    expect(content?.x ?? -1).toBe(0);
  });
});
