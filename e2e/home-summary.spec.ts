import { type Page } from "@playwright/test";
import { expect, login, seedOwnerHousehold, test } from "./support/fixtures";

import { createConsumable, updateConsumableStockStatus } from "../src/lib/d1/consumables";
import { createOneTimeTask } from "../src/lib/d1/todos";
import { addDaysToTokyoDateUtcIso, PHASE_ONE_TIME_ZONE } from "../src/app/time-zone";

// Issue #394: ホーム上部の「対応状況」は、390px幅で2列+3つ目が全幅となり、
// サマリーだけで2行を使って本文を押し下げていた。0件・一部のみ・全項目に
// 件数ありの3通りで、3項目が1行に収まることを実際の配置で確かめる
// (受け入れ基準の「390px幅でUIテストする」)。

const TODAY_TODO = "ごみ出し";
const OVERDUE_TODO = "電池交換";
const CONSUMABLE_NAME = "食洗機用洗剤";

function tokyoDateAfter(days: number): string {
  const today = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: PHASE_ONE_TIME_ZONE,
    year: "numeric",
  }).format(new Date());
  const scheduledFor = addDaysToTokyoDateUtcIso(today, days);
  if (scheduledFor === null) throw new Error("予定日を計算できなかった");
  return scheduledFor;
}

async function seedTodos(db: D1Database, overdue: boolean): Promise<void> {
  const session = { userId: "owner" };
  await createOneTimeTask(db, session, {
    managedItemId: null,
    scheduledFor: tokyoDateAfter(0),
    title: TODAY_TODO,
  });
  if (!overdue) return;
  await createOneTimeTask(db, session, {
    managedItemId: null,
    scheduledFor: tokyoDateAfter(-3),
    title: OVERDUE_TODO,
  });
}

async function seedShoppingCandidate(db: D1Database): Promise<void> {
  const session = { userId: "owner" };
  const consumableId = await createConsumable(db, session, {
    externalUrl: null,
    managedItemIds: [],
    name: CONSUMABLE_NAME,
    note: null,
    productCode: null,
    taskRuleIds: [],
  });
  await updateConsumableStockStatus(db, session, consumableId, "out");
}

// 3項目が同じ行に並んでいるか(上端がそろっているか)。
async function expectSummaryOnOneRow(page: Page): Promise<void> {
  const tops = await page.getByLabel("対応状況").evaluate((element) =>
    Array.from(element.children).map((child) =>
      Math.round(child.getBoundingClientRect().top)));

  expect(tops, "対応状況が3項目ではない").toHaveLength(3);
  expect(new Set(tops).size, `対応状況が1行に収まっていない(top=${tops.join(",")})`).toBe(1);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow, "横スクロールが発生している").toBe(false);
}

test.beforeEach(async ({ db }) => {
  await seedOwnerHousehold(db);
});

test.describe("390px幅", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("0件でも、対応状況の3項目が1行に収まる", async ({ page }) => {
    await login(page);

    const summary = page.getByLabel("対応状況");
    await expect(summary).toContainText("0件の予定");
    await expect(summary).toContainText("0件が期限切れ");
    await expect(summary).toContainText("0件 買うもの");
    await expectSummaryOnOneRow(page);
    await expectNoHorizontalOverflow(page);
  });

  test("一部だけ件数があっても、対応状況の3項目が1行に収まる", async ({ db, page }) => {
    await seedTodos(db, false);
    await login(page);

    const summary = page.getByLabel("対応状況");
    await expect(summary).toContainText("1件の予定");
    await expect(summary).toContainText("0件が期限切れ");
    await expectSummaryOnOneRow(page);
    await expectNoHorizontalOverflow(page);
  });

  test("全項目に件数があっても1行に収まり、各サマリーから該当セクションへ移動できる", async ({
    db,
    page,
  }) => {
    await seedTodos(db, true);
    await seedShoppingCandidate(db);
    await login(page);

    const summary = page.getByLabel("対応状況");
    await expectSummaryOnOneRow(page);
    await expectNoHorizontalOverflow(page);

    // Issue #360 / #388: 件数のあるサマリーは該当セクションへの導線を兼ねる。
    // 短い表示ラベルにしても、読み上げ名と移動先は変えない。
    await summary.getByRole("link", { name: "買っておきたいもの1件へ移動" }).click();
    await expect(page.getByRole("region", { name: "買っておきたいもの" })).toBeVisible();
    await expect(page).toHaveURL(/#/u);
  });

  // Issue #394: 期日の状態はバッジが伝えるため、本文で同じ意味を繰り返さない。
  test("Todoカードは期日の状態をバッジだけで示し、本文では日付を繰り返さない", async ({
    db,
    page,
  }) => {
    await seedTodos(db, false);
    await login(page);

    const card = page.locator("article.task-card", { hasText: TODAY_TODO });
    await expect(card.getByText("今日", { exact: true })).toBeVisible();
    await expect(card).not.toContainText("今日（");
    await expect(card).not.toContainText("の予定です");

    // 詳細・担当・完了の操作はそのまま使える。
    await expect(card.getByRole("link", { name: TODAY_TODO })).toBeVisible();
    await expect(card.getByLabel(`${TODAY_TODO}の担当`)).toBeVisible();
    await expect(card.getByRole("button", { name: `${TODAY_TODO}を記録` })).toBeVisible();
  });
});

test.describe("320px幅", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("最小幅でも対応状況が1行に収まり、横スクロールが出ない", async ({ db, page }) => {
    await seedTodos(db, true);
    await seedShoppingCandidate(db);
    await login(page);

    await expectSummaryOnOneRow(page);
    await expectNoHorizontalOverflow(page);
  });
});
