import { type Page } from "@playwright/test";
import { expect, login, seedOwnerHousehold, test } from "./support/fixtures";

import { createOneTimeTask, setTaskOccurrenceAssignee } from "../src/lib/d1/todos";
import { addDaysToTokyoDateUtcIso, PHASE_ONE_TIME_ZONE } from "../src/app/time-zone";

// Issue #224: Todo一覧のカード表示とコンパクトなリスト表示の切り替えを、
// PC幅(既定のDesktop Chromeプロジェクト)とモバイル幅の両方で確認する
// (受け入れ基準「モバイルとPCの主要幅を自動テストまたはスクリーンショット
// で確認している」)。

const TASK_TITLE = "浄水フィルター交換";

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

async function seedOwnerWithAssignedPendingTodo(db: D1Database): Promise<void> {
  await seedOwnerHousehold(db);
  const session = { userId: "owner" };
  const ruleId = await createOneTimeTask(db, session, {
    managedItemId: null,
    scheduledFor: tokyoDateAfter(1),
    title: TASK_TITLE,
  });
  const occurrence = await db.prepare(
    "SELECT id FROM task_occurrences WHERE task_rule_id = ?1",
  ).bind(ruleId).first<{ id: string }>();
  if (occurrence === null) throw new Error("Occurrenceを作成できなかった");
  await setTaskOccurrenceAssignee(db, session, occurrence.id, "owner");
}

async function loginAndOpenTodoList(page: Page): Promise<void> {
  await login(page);
  await page.goto("/todos");
}

test.beforeEach(async ({ db }) => {
  await seedOwnerWithAssignedPendingTodo(db);
});

test("PC幅: カード表示とリスト表示を切り替え、リスト行はキーボードでもTodo詳細へ移動できる", async ({
  page,
}) => {
  await loginAndOpenTodoList(page);

  // 既定はカード表示で、現在の操作性(担当・完了)を維持する(受け入れ基準)。
  await expect(page.getByRole("link", { name: "カード表示" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByLabel(`${TASK_TITLE}の担当`)).toBeVisible();

  // Issue #266: 担当候補は閉じた選択UIに収める。summaryはキーボードで
  // 開け、選択後は閉じた状態でも現在の条件が分かる。
  const assigneeToggle = page.getByText("担当: 全員", { exact: true });
  await assigneeToggle.focus();
  await expect(assigneeToggle).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("link", { name: "自分" })).toBeVisible();
  await page.getByRole("link", { name: "自分" }).click();
  await expect(page).toHaveURL(/[?&]assignee=owner\b/u);
  await expect(page.getByText("担当: 自分", { exact: true })).toBeVisible();

  // リストへ切り替える。表示形式はURLに残り、再読み込みしても復元できる。
  const listSwitch = page.getByRole("link", { name: "リスト表示" });
  await listSwitch.focus();
  await expect(listSwitch).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/[?&]view=list\b/u);
  await expect(page.getByRole("link", { name: "リスト表示" })).toHaveAttribute("aria-current", "page");

  // リスト表示では担当・完了の変更操作を出さず(誤操作を避けるための設計、
  // issue本文の設計メモ)、識別情報(名前・予定・担当予定者)だけを行内に表示する。
  await expect(page.getByLabel(`${TASK_TITLE}の担当`)).toHaveCount(0);
  await expect(page.getByRole("button", { name: `${TASK_TITLE}を記録` })).toHaveCount(0);
  const row = page.getByRole("link", { name: new RegExp(TASK_TITLE) });
  await expect(row).toBeVisible();
  // Issue #243: 見た目は「担当:」を出さず、値だけで担当予定者を示す。
  await expect(row).toContainText("自分");
  await expect(row).not.toContainText("担当:");

  // 行全体がTodo詳細への単一の導線になる。キーボードでも遷移できる。
  await row.focus();
  await expect(row).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/todos\/[^/?]+$/u);
  await expect(page.getByRole("heading", { name: TASK_TITLE })).toBeVisible();

  // 詳細から一覧へ戻っても、表示形式はブラウザ履歴どおりリストのまま。
  await page.goBack();
  await expect(page).toHaveURL(/[?&]view=list\b/u);
});

test.describe("モバイル幅", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("モバイル幅でもリスト表示へ切り替えられ、行から横スクロールなくTodo詳細を開ける", async ({
    page,
  }) => {
    await loginAndOpenTodoList(page);

    await page.getByRole("link", { name: "リスト表示" }).click();
    await expect(page).toHaveURL(/[?&]view=list\b/u);

    const row = page.getByRole("link", { name: new RegExp(TASK_TITLE) });
    await expect(row).toBeVisible();
    // Issue #243: 見た目は「担当:」を出さず、値だけで担当予定者を示す。
    await expect(row).toContainText("自分");
    await expect(row).not.toContainText("担当:");

    // モバイル下部ナビゲーション(#146)と重ならず操作できる幅で、
    // ページ全体が横スクロールを必要としないことを確認する。
    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasHorizontalOverflow).toBe(false);

    await row.click();
    await expect(page).toHaveURL(/\/todos\/[^/?]+$/u);
    await expect(page.getByRole("heading", { name: TASK_TITLE })).toBeVisible();
  });
});
