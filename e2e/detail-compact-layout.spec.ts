import { type Page } from "@playwright/test";

import { expect, login, seedManagedItem, seedOwnerHousehold, test } from "./support/fixtures";

import { createConsumable, recordConsumableRefill } from "../src/lib/d1/consumables";
import { createMaintenanceTask } from "../src/lib/d1/todos";

// Issue #395: Todo・備品・消耗品の詳細で、内容の少ない記録・関連・履歴まで
// 独立した大きなカードを占め、重要な状態と操作へ届くまでのスクロールが長かった。
// 縦にどれだけ詰まったかと、狭い幅で崩れないかは実際の描画でしか分からない。

const OWNER = { userId: "owner" };

// 変更前の実測値(390px幅・最後のカードの下端)。ここより上へ収まることを
// 確かめ、空カードや縦積みが戻ったときに気付けるようにする。
const BEFORE_390PX = {
  consumableEmpty: 1244,
  consumableFilled: 1492,
  managedItemEmpty: 833,
  managedItemFilled: 1144,
  todo: 1059,
};

const ids = {
  consumableEmpty: "",
  consumableFilled: "",
  managedItemEmpty: "",
  managedItemFilled: "",
  todo: "",
};

// 詳細のカードはどれも見出しで名前を持つsection(role=region)なので、見た目の
// クラス名ではなくその役割で取る(styles.mdの「テストから見た目のクラス名を
// 選択子に使わない」)。
function detailCards(page: Page) {
  return page.getByRole("main").getByRole("region");
}

async function contentBottom(page: Page): Promise<number> {
  const cards = detailCards(page);
  const last = await cards.nth((await cards.count()) - 1).boundingBox();
  if (last === null) throw new Error("詳細カードの位置を取得できなかった");
  return last.y + last.height;
}

async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
}

test.beforeEach(async ({ db }) => {
  await seedOwnerHousehold(db);
  ids.managedItemEmpty = await seedManagedItem(db, "空の備品");
  ids.managedItemFilled = await seedManagedItem(db, "リビングのエアコン");
  const ruleId = await createMaintenanceTask(db, OWNER, {
    firstDueAt: "2026-09-20T15:00:00.000Z",
    firstScheduledFor: "2026-09-12T15:00:00.000Z",
    managedItemId: ids.managedItemFilled,
    recommendedStartOffset: 1,
    recommendedUntilOffset: 2,
    title: "フィルターを交換する",
  });
  const occurrence = await db.prepare(
    "SELECT id FROM task_occurrences WHERE task_rule_id = ?1",
  ).bind(ruleId).first<{ id: string }>();
  if (occurrence === null) throw new Error("メンテナンスTodoの初回Occurrenceがありません。");
  ids.todo = occurrence.id;

  ids.consumableEmpty = await createConsumable(db, OWNER, {
    externalUrl: null,
    managedItemIds: [],
    name: "空の消耗品",
    note: null,
    productCode: null,
    taskRuleIds: [],
  });
  ids.consumableFilled = await createConsumable(db, OWNER, {
    externalUrl: "https://example.com/filter",
    managedItemIds: [ids.managedItemFilled],
    name: "交換フィルター",
    note: "予備は収納棚の上段",
    productCode: "FILTER-A",
    taskRuleIds: [ruleId],
  });
  await recordConsumableRefill(db, OWNER, ids.consumableFilled, "2026-09-01");
});

test.describe("モバイル幅(390px)", () => {
  test.use({ viewport: { height: 844, width: 390 } });

  test("空の記録・関連・履歴が大きなカードとして連続しない", async ({ page }) => {
    await login(page);

    await page.goto(`/managed-items/${ids.managedItemEmpty}`);
    // 完了の記録はここから足せないため、記録がないうちはカードごと出さない。
    await expect(page.getByRole("region", { name: "直近の完了" })).toHaveCount(0);
    // 追加導線があるカードは、空でも見出しと導線だけを残す。
    const relatedTodos = page.getByRole("region", { name: "関連するTodo" });
    await expect(relatedTodos.getByRole("link", { name: "Todoを追加" })).toBeVisible();
    await expect(relatedTodos.getByRole("listitem")).toHaveCount(0);
    expect(await contentBottom(page)).toBeLessThan(BEFORE_390PX.managedItemEmpty);

    await page.goto(`/consumables/${ids.consumableEmpty}`);
    await expect(page.getByRole("region", { name: "関連する管理対象" })
      .getByRole("listitem")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "関連するTodo" })
      .getByRole("listitem")).toHaveCount(0);
    expect(await contentBottom(page)).toBeLessThan(BEFORE_390PX.consumableEmpty);
  });

  test("内容のある詳細でも、表示と関連先への遷移を保ったまま縦に詰まる", async ({ page }) => {
    await login(page);

    await page.goto(`/managed-items/${ids.managedItemFilled}`);
    await expect(page.getByRole("region", { name: "関連するTodo" })
      .getByRole("link", { name: "フィルターを交換する" })).toBeVisible();
    await expect(page.getByRole("region", { name: "関連する消耗品" })
      .getByRole("link", { name: "交換フィルター" })).toBeVisible();
    expect(await contentBottom(page)).toBeLessThan(BEFORE_390PX.managedItemFilled);

    await page.goto(`/consumables/${ids.consumableFilled}`);
    await expect(page.getByText("FILTER-A")).toBeVisible();
    await expect(page.getByText("予備は収納棚の上段")).toBeVisible();
    await expect(page.getByRole("region", { name: "関連する管理対象" })
      .getByRole("link", { name: "リビングのエアコン" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 3, name: "補充履歴" })).toBeVisible();
    expect(await contentBottom(page)).toBeLessThan(BEFORE_390PX.consumableFilled);

    await page.goto(`/todos/${ids.todo}`);
    await expect(page.getByRole("link", { name: "リビングのエアコン" })).toBeVisible();
    expect(await contentBottom(page)).toBeLessThan(BEFORE_390PX.todo);
  });

  test("重要な状態と主要な操作が最初の画面に収まる", async ({ page }) => {
    await login(page);

    // 消耗品は在庫の状態と、在庫を戻す補充の操作が同じ1枚目のカードに入る。
    await page.goto(`/consumables/${ids.consumableFilled}`);
    const stock = page.getByRole("region", { name: "在庫と補充" });
    for (const name of ["ある", "少ない", "ない", "補充した"]) {
      // 「ない」は「少ない」の一部でもあるため、名前は完全一致で選ぶ。
      const box = await stock.getByRole("button", { exact: true, name }).boundingBox();
      expect(box === null ? Number.MAX_SAFE_INTEGER : box.y + box.height)
        .toBeLessThanOrEqual(844);
    }

    // Todoは担当の変更と、完了を記録する操作が1枚目に入る。
    await page.goto(`/todos/${ids.todo}`);
    const actions = page.getByRole("region", { name: "担当と完了" });
    const completeBox = await actions
      .getByRole("button", { name: "フィルターを交換するを記録" })
      .boundingBox();
    expect(completeBox === null ? Number.MAX_SAFE_INTEGER : completeBox.y + completeBox.height)
      .toBeLessThanOrEqual(844);
  });
});

for (const width of [320, 390]) {
  test.describe(`幅${String(width)}px`, () => {
    test.use({ viewport: { height: 844, width } });

    test("記録の名称と値が衝突せず、横スクロールも出ない", async ({ page }) => {
      await login(page);

      for (const path of [
        `/managed-items/${ids.managedItemFilled}`,
        `/consumables/${ids.consumableFilled}`,
        `/todos/${ids.todo}`,
      ]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        expect(await hasHorizontalOverflow(page)).toBe(false);
      }
    });

    // 名称の列は一覧全体で一つ。行ごとに列を作ると、値の始まる位置が名称の
    // 長さでばらつく。
    test("1行に並べた属性の値が、名称の長さによらず同じ位置から始まる", async ({ page }) => {
      await login(page);
      await page.goto(`/todos/${ids.todo}`);

      const values = page.getByRole("region", { name: "Todoの内容" }).locator("dd");
      const lefts = await values.evaluateAll(
        (nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().left)),
      );
      expect(lefts.length).toBeGreaterThan(1);
      expect(new Set(lefts).size).toBe(1);
    });
  });
}
