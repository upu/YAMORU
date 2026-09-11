import { type Page } from "@playwright/test";

import { E2E_OWNER_USER_ID, expect, login, seedOwnerHousehold, test } from "./support/fixtures";

import { createOneTimeTask } from "../src/lib/d1/todos";

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

const TODO_TITLE = "換気扇を掃除する";

test.beforeEach(async ({ db }) => {
  await seedOwnerHousehold(db);
  await createOneTimeTask(db, { userId: E2E_OWNER_USER_ID }, {
    managedItemId: null,
    scheduledFor: "2026-09-10",
    title: TODO_TITLE,
  });
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

  // サイドバーを出さない画面では、その幅の余白も空けない。bodyへ一律に余白を
  // 置くと、ログイン・招待受諾の画面まで左側が空いたままになる。
  test("公開画面にはサイドバーを出さず、その幅の余白も空けない", async ({ page }) => {
    for (const path of ["/login", "/invitations/accept"]) {
      await page.goto(path);

      await expect(primaryNavigation(page)).toHaveCount(0);
      // 本文は画面の中央のまま。サイドバーの幅だけ右へ寄っていれば、左右の
      // 余白が食い違う。
      const content = await page.getByRole("main").boundingBox();
      if (content === null) throw new Error("本文の位置を取得できなかった");
      expect(content.x).toBe(1280 - (content.x + content.width));
    }
  });
});

// モーダルを開いている間は、サイドバーも覆いの後ろへ入れる。手前にあると、
// 移動先を押せてしまううえ、狭いPC幅ではダイアログの左端に重なる。
test.describe("サイドバーを出す中間幅(600px)", () => {
  test.use({ viewport: { height: 844, width: 600 } });

  test("ダイアログを開くとサイドバーは覆いの後ろへ入る", async ({ page }) => {
    await login(page);
    await page.goto("/todos");

    const home = primaryNavigation(page).getByRole("link", { name: "ホーム" });
    const before = await home.boundingBox();
    if (before === null) throw new Error("サイドバーの位置を取得できなかった");

    await page.getByRole("button", { name: `${TODO_TITLE}を記録` }).click();
    await expect(page.getByRole("dialog", { name: `${TODO_TITLE}を記録` })).toBeVisible();

    // サイドバーの項目があった場所を押しても、当たるのは覆いの側。
    const topmost = await page.evaluate(
      ([x, y]) => {
        const element = document.elementFromPoint(x, y);
        return element?.closest("nav") === null ? "backdrop" : "navigation";
      },
      [before.x + before.width / 2, before.y + before.height / 2] as const,
    );
    expect(topmost).toBe("backdrop");
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

// 境界は「サイドバーを出したあとの本文の幅」で決めている。564pxまでは下部
// ナビゲーション、565pxからサイドバー。サイドバーを出すとき、本文は
// これまで下部ナビゲーションなしで扱っていた幅(481px以上)を保つ。
test.describe("切り替えの境界", () => {
  test("564pxは下部ナビゲーション、565pxからサイドバーへ替わる", async ({ page }) => {
    await login(page);

    await page.setViewportSize({ height: 844, width: 564 });
    await page.goto("/todos");
    const bottom = await primaryNavigation(page).boundingBox();
    if (bottom === null) throw new Error("位置を取得できなかった");
    expect(bottom.width).toBe(564);
    expect(await page.getByRole("main").boundingBox()).toMatchObject({ x: 0 });

    await page.setViewportSize({ height: 844, width: 565 });
    const sidebar = await primaryNavigation(page).boundingBox();
    const content = await page.getByRole("main").boundingBox();
    if (sidebar === null || content === null) throw new Error("位置を取得できなかった");
    expect(sidebar.x).toBe(0);
    expect(sidebar.height).toBeGreaterThan(200);
    // 本文に残る幅が481pxを下回らない。
    expect(565 - sidebar.width).toBeGreaterThanOrEqual(481);
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
