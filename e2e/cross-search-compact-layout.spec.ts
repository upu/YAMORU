import { type Page } from "@playwright/test";

import { E2E_OWNER_USER_ID, expect, login, seedOwnerHousehold, test } from "./support/fixtures";

import { createConsumable } from "../src/lib/d1/consumables";
import { createManagedItem } from "../src/lib/d1/managed-items";
import { createOneTimeTask } from "../src/lib/d1/todos";

// Issue #396: 検索結果は分類ごとに外側のカードを作り、結果行の枠と二重の囲いに
// なっていた。1件しかない分類でも余白と見出しが縦幅を使う。どれだけ詰まったか
// と、狭い幅・長い名前で崩れないことは実際の描画でしか分からない。

const session = { userId: E2E_OWNER_USER_ID };

// 変更前の実測値(390px幅・分類のまとまりの高さ)。ここより低く収まることを
// 確かめ、二重の囲いが戻ったときに気付けるようにする。
const BEFORE_390PX = { allKinds: 711, singleKind: 144 };

const LONG_TITLE = "台所の換気扇のフィルターを外して洗剤につけ置きしてから洗う";

async function resultsBlockHeight(page: Page): Promise<number> {
  const groups = page.getByRole("main").getByRole("region");
  const count = await groups.count();
  const first = await groups.nth(0).boundingBox();
  const last = await groups.nth(count - 1).boundingBox();
  if (first === null || last === null) throw new Error("分類のまとまりの位置を取得できなかった");
  return last.y + last.height - first.y;
}

async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
}

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
  await createManagedItem(db, session, {
    customItemType: null,
    externalUrl: null,
    itemTypeCode: null,
    kindCode: "service",
    name: "卵の定期便",
    note: null,
    productInfo: null,
    startedOn: null,
  });
  await createOneTimeTask(db, session, {
    managedItemId: null,
    scheduledFor: "2026-09-10",
    title: "卵を買う",
  });
  await createOneTimeTask(db, session, {
    managedItemId: null,
    scheduledFor: "2026-09-11",
    title: LONG_TITLE,
  });
});

test.describe("モバイル幅(390px)", () => {
  test.use({ viewport: { height: 844, width: 390 } });

  test("1件だけの分類が大きな二重カードにならない", async ({ page }) => {
    await login(page);
    await page.goto("/search?q=%E5%8D%B5%E7%84%BC");

    // 分類は一つ、結果も1件。
    await expect(page.getByRole("main").getByRole("region")).toHaveCount(1);
    await expect(page.getByRole("region", { name: "備品" })
      .getByRole("link", { name: "卵焼き器" })).toBeVisible();
    expect(await resultsBlockHeight(page)).toBeLessThan(BEFORE_390PX.singleKind);
  });

  test("複数の分類でも、分類と結果行を見分けたまま縦に詰まる", async ({ page }) => {
    await login(page);
    await page.goto("/search?q=%E5%8D%B5");

    for (const name of ["Todo", "備品", "サービス・契約", "消耗品"]) {
      await expect(page.getByRole("region", { name })).toBeVisible();
    }
    expect(await resultsBlockHeight(page)).toBeLessThan(BEFORE_390PX.allKinds);

    // 既存のクイック操作は残る。
    await expect(page.getByRole("button", { name: "卵を買うを記録" })).toBeVisible();
    await expect(page.getByRole("group", { name: "卵の在庫状態を変更" })).toBeVisible();
  });

  test("結果が0件でも分類の見出しを置かず、探し直す入口だけを出す", async ({ page }) => {
    await login(page);
    await page.goto("/search?q=%E3%81%82%E3%82%8A%E3%81%88%E3%81%AA%E3%81%84");

    for (const name of ["Todo", "備品", "サービス・契約", "消耗品"]) {
      await expect(page.getByRole("region", { name })).toHaveCount(0);
    }
    await expect(page.getByRole("link", { name: "Todo一覧を開く" })).toBeVisible();
  });
});

for (const width of [320, 390]) {
  test.describe(`幅${String(width)}px`, () => {
    test.use({ viewport: { height: 844, width } });

    test("長い名前でも操作と分類表示が崩れず、横スクロールも出ない", async ({ page }) => {
      await login(page);
      await page.goto("/search?q=%E6%B4%97");

      const todos = page.getByRole("region", { name: "Todo" });
      await expect(todos.getByRole("link", { name: LONG_TITLE })).toBeVisible();
      const action = todos.getByRole("button", { name: `${LONG_TITLE}を記録` });
      const box = await action.boundingBox();
      if (box === null) throw new Error("完了操作の位置を取得できなかった");
      // 押せる領域は--tap-target(44px)を保つ。
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(await hasHorizontalOverflow(page)).toBe(false);
    });
  });
}
