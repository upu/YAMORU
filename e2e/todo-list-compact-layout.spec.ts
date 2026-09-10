import { type Locator, type Page } from "@playwright/test";
import { expect, login, seedOwnerHousehold, test } from "./support/fixtures";

import { createOneTimeTask } from "../src/lib/d1/todos";
import { addDaysToTokyoDateUtcIso, PHASE_ONE_TIME_ZONE } from "../src/app/time-zone";

// Issue #390: 390px幅のTodo一覧で、ツールバーの操作が意図したまとまりで
// 収まっているか(検索だけが次行へ取り残されていないか)と、コンパクトな
// リスト表示の1行に主要情報が収まっているかを、実際の配置で確かめる。
// 行数や折り返しは文字幅で決まるため、jsdomのコンポーネントテストでは
// 見えない(受け入れ基準の「390px幅で」に当たる確認)。

const SHORT_TODO = "ごみ出し";
const LONG_TODO = "浄水器のフィルターを交換して記録を残す長いタイトルのTodo";

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

type Box = { height: number; width: number; x: number; y: number };

async function boxOf(locator: Locator, name: string): Promise<Box> {
  await expect(locator, `${name}が表示されていない`).toBeVisible();
  const box = await locator.boundingBox();
  if (box === null) throw new Error(`${name}の大きさを取得できなかった`);
  return box;
}

// 同じ行に並んでいるか。上下の中心が互いの高さの範囲に収まっていれば同じ行とみなす
// (高さの違う操作が縦中央でそろうため、yの一致では見られない)。
function isSameRow(left: Box, right: Box): boolean {
  const leftCenter = left.y + left.height / 2;
  const rightCenter = right.y + right.height / 2;
  return leftCenter >= right.y && leftCenter <= right.y + right.height
    && rightCenter >= left.y && rightCenter <= left.y + left.height;
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow, "横スクロールが発生している").toBe(false);
}

// 見た目が省略表示になっているか(はみ出した分だけscrollWidthが大きくなる)。
async function isTruncated(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => element.scrollWidth > element.clientWidth + 1);
}

test.beforeEach(async ({ db }) => {
  await seedOwnerHousehold(db);
  const session = { userId: "owner" };
  await createOneTimeTask(db, session, {
    managedItemId: null,
    scheduledFor: tokyoDateAfter(0),
    title: SHORT_TODO,
  });
  await createOneTimeTask(db, session, {
    managedItemId: null,
    scheduledFor: tokyoDateAfter(2),
    title: LONG_TODO,
  });
});

test.describe("390px幅", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("ツールバーは絞り込みとそれ以外の操作でまとまり、検索だけが次行へ残らない", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/todos");

    const search = await boxOf(page.getByLabel("Todoを検索"), "検索を開く");
    const listView = await boxOf(page.getByRole("link", { name: "リスト表示" }), "リスト表示");
    const cardView = await boxOf(page.getByRole("link", { name: "カード表示" }), "カード表示");
    const pending = await boxOf(page.getByRole("link", { name: "未完了" }), "未完了");
    const done = await boxOf(page.getByRole("link", { name: "実施済み" }), "実施済み");
    const assignee = await boxOf(page.getByText("担当: 全員", { exact: true }), "担当の絞り込み");

    // 検索は表示形式と同じ行に並ぶ(単独で次の行へ取り残されない)。
    expect(isSameRow(search, listView), "検索が表示形式と別の行にある").toBe(true);
    expect(isSameRow(listView, cardView), "表示形式の2択が別の行に分かれている").toBe(true);

    // 絞り込み(状態・担当)は互いに同じ行で、操作群とは別の行にまとまる。
    expect(isSameRow(pending, done), "状態の2択が別の行に分かれている").toBe(true);
    expect(isSameRow(pending, assignee), "状態と担当が別の行に分かれている").toBe(true);
    expect(isSameRow(pending, search), "絞り込みと検索が同じ行に混ざっている").toBe(false);

    // まとまりは2行までで、どの操作もはみ出さない。
    expect(search.y, "検索が絞り込みより下の行にある").toBeLessThan(pending.y);
    await expectNoHorizontalOverflow(page);
  });

  test("リスト表示は短いTodoを1行に収め、長いタイトルだけを省略する", async ({ page }) => {
    await login(page);
    await page.goto("/todos?view=list");

    const shortRow = page.getByRole("link", { name: new RegExp(SHORT_TODO) });
    const shortRowBox = await boxOf(shortRow, `${SHORT_TODO}の行`);
    const shortTitle = await boxOf(
      shortRow.getByText(SHORT_TODO, { exact: true }),
      `${SHORT_TODO}のタイトル`,
    );
    const shortBadge = await boxOf(shortRow.getByText("今日", { exact: true }), "状態ラベル");

    // 短いTodoはタイトル・日付/状態・状態ラベルが1行に収まる。
    expect(isSameRow(shortTitle, shortBadge), "状態ラベルが2行目へ落ちている").toBe(true);
    expect(shortRowBox.height, "短いTodoの行が1行に収まっていない").toBeLessThanOrEqual(48);
    expect(await isTruncated(shortRow.getByText(SHORT_TODO, { exact: true }))).toBe(false);

    // 長いタイトルは省略表示になり、状態ラベルを押し出さない。
    const longRow = page.getByRole("link", { name: new RegExp(LONG_TODO) });
    const longRowBox = await boxOf(longRow, `${LONG_TODO}の行`);
    const longTitleLocator = longRow.getByText(LONG_TODO, { exact: true });
    const longTitle = await boxOf(longTitleLocator, `${LONG_TODO}のタイトル`);
    const longBadge = await boxOf(longRow.getByText("予定", { exact: true }), "状態ラベル");

    expect(await isTruncated(longTitleLocator), "長いタイトルが省略表示になっていない").toBe(true);
    expect(isSameRow(longTitle, longBadge), "長いタイトルが状態ラベルを押し出している").toBe(true);
    expect(longRowBox.height, "長いTodoの行が2行以上になっている").toBeLessThanOrEqual(48);

    // 省略しても、行全体のリンク名にはTodo名の全文が残る。
    await expect(longRow).toHaveAccessibleName(new RegExp(LONG_TODO));

    // 行は引き続きTodo詳細への単一の導線(#224)。
    await longRow.click();
    await expect(page).toHaveURL(/\/todos\/[^/?]+$/u);

    await page.goBack();
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("320px幅", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("最小幅でもツールバーとリスト行が横スクロールなく収まる", async ({ page }) => {
    await login(page);

    await page.goto("/todos");
    await expectNoHorizontalOverflow(page);

    await page.goto("/todos?view=list");
    const row = page.getByRole("link", { name: new RegExp(LONG_TODO) });
    await expect(row).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // 検索を開いても、入力欄が画面からはみ出さない。
    await page.getByLabel("Todoを検索").click();
    await expect(page.getByLabel("Todo名で検索")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
