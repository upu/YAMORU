import { expect, login, seedOwnerHousehold, test } from "./support/fixtures";

import { completeTask, createOneTimeTask } from "../src/lib/d1/todos";
import { addDaysToTokyoDateUtcIso, PHASE_ONE_TIME_ZONE } from "../src/app/time-zone";

const TODO_TITLE = "浄水器のフィルター交換";

let occurrenceId: string;

// アプリと同じAsia/Tokyoの暦日で、date入力へ渡すYYYY-MM-DDを作る。
function toTokyoDateString(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: PHASE_ONE_TIME_ZONE,
    year: "numeric",
  }).format(date);
}

function tokyoDateAfter(days: number): string {
  const iso = addDaysToTokyoDateUtcIso(toTokyoDateString(new Date()), days);
  if (iso === null) throw new Error("日付を計算できなかった");
  return iso;
}

async function seedCompletedTodo(db: D1Database): Promise<void> {
  await seedOwnerHousehold(db);
  const ruleId = await createOneTimeTask(db, { userId: "owner" }, {
    managedItemId: null,
    scheduledFor: tokyoDateAfter(0),
    title: TODO_TITLE,
  });
  const row = await db.prepare(
    "SELECT id FROM task_occurrences WHERE task_rule_id = ?1",
  ).bind(ruleId).first<{ id: string }>();
  if (row === null) throw new Error("Occurrenceが作られていない");
  occurrenceId = row.id;
  await completeTask(db, { userId: "owner" }, {
    idempotencyKey: "e2e-complete",
    occurredAt: tokyoDateAfter(-2),
    occurrenceId,
    performedByUserId: null,
  });
}

test.beforeEach(async ({ db }) => {
  await seedCompletedTodo(db);
});

test("完了済みTodoの詳細から実施日を訂正し、完了を取り消して未完了へ戻せる", async ({
  page,
}) => {
  await login(page);

  // Issue #206: 最近の実施は確認専用とし、Todo名から完了済み詳細へ移動する。
  const recentSection = page.getByRole("region", { name: "最近の実施" });
  await expect(recentSection.getByRole("button", { name: `${TODO_TITLE}を修正` }))
    .toHaveCount(0);
  await recentSection.getByRole("link", { name: TODO_TITLE }).click();
  await expect(page).toHaveURL(`/todos/${occurrenceId}`);
  const summary = page.getByRole("region", { name: "Todoの内容" });
  await expect(page.getByRole("heading", { level: 1, name: TODO_TITLE })).toBeVisible();
  await expect(summary.getByText("完了", { exact: true })).toBeVisible();
  await expect(summary.getByText("家族Aさん")).toBeVisible();

  // 実施日の訂正。元の完了記録は残したまま、訂正後の値が表示される(YDR-026)。
  const correctedOn = toTokyoDateString(new Date(tokyoDateAfter(-1)));
  await page.getByRole("button", { name: `${TODO_TITLE}を修正` }).click();
  await page.getByRole("button", { name: "実施日時を訂正する" }).click();
  await page.getByLabel("実施日").fill(correctedOn);
  await page.getByRole("button", { name: "この日付で訂正する" }).click();
  const correctedLabel = new Intl.DateTimeFormat("ja-JP", {
    day: "numeric",
    month: "long",
    timeZone: PHASE_ONE_TIME_ZONE,
    year: "numeric",
  }).format(new Date(tokyoDateAfter(-1)));
  await expect(summary.getByText(correctedLabel)).toBeVisible();

  // 完了取消。未完了へ戻り、ホームとTodo一覧へ再び現れる。
  await page.getByRole("button", { name: `${TODO_TITLE}を修正` }).click();
  await page.getByRole("button", { name: "完了を取り消す" }).click();
  await page.getByRole("button", { name: "この完了を取り消す" }).click();
  await expect(summary.getByText("未完了")).toBeVisible();
  await expect(
    page.getByRole("button", { name: `${TODO_TITLE}を修正` }),
  ).toHaveCount(0);

  await page.goto("/");
  await expect(page.getByRole("link", { name: TODO_TITLE })).toBeVisible();
  await page.goto("/todos");
  await expect(page.getByRole("link", { name: TODO_TITLE })).toBeVisible();
});
