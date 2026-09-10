import { type Page } from "@playwright/test";
import { expect, login, seedOwnerHousehold, test } from "./support/fixtures";

import { createOneTimeTask } from "../src/lib/d1/todos";
import { addDaysToTokyoDateUtcIso, PHASE_ONE_TIME_ZONE } from "../src/app/time-zone";

// Issue #392: 未完了Todoの詳細から、内容を確認したまま担当と完了を実行できる。
// 操作の成否そのものはコンポーネントテストで見るため、ここでは実際のD1と
// 再検証を通したときに「詳細画面の表示が最新状態へ更新される」ことを確かめる
// (受け入れ基準)。

const TODO_TITLE = "浄水器のフィルター交換";
const OTHER_MEMBER_NICKNAME = "たろう";

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

test.beforeEach(async ({ db }) => {
  await seedOwnerHousehold(db);
  // 担当の選択肢が複数ある状態にする。
  await db.batch([
    db.prepare(
      "INSERT INTO users (id, email, password_hash) VALUES ('member2', ?1, 'e2e-not-a-real-hash')",
    ).bind("member2@example.test"),
    db.prepare("INSERT INTO profiles (user_id, nickname) VALUES ('member2', ?1)")
      .bind(OTHER_MEMBER_NICKNAME),
    db.prepare("INSERT INTO household_members (household_id, user_id) VALUES ('household-a', 'member2')"),
  ]);
  await createOneTimeTask(db, { userId: "owner" }, {
    managedItemId: null,
    scheduledFor: tokyoDateAfter(0),
    title: TODO_TITLE,
  });
});

async function openTodoDetail(page: Page): Promise<void> {
  await login(page);
  await page.goto("/todos");
  await page.getByRole("link", { name: TODO_TITLE }).first().click();
  await expect(page).toHaveURL(/\/todos\/[^/?]+$/u);
  await expect(page.getByRole("heading", { level: 1, name: TODO_TITLE })).toBeVisible();
}

test("Todo詳細で担当を設定すると、その場の表示が最新の担当へ更新される", async ({ page }) => {
  await openTodoDetail(page);

  const assignee = page.getByLabel(`${TODO_TITLE}の担当`);
  await expect(assignee).toHaveValue("");

  await assignee.selectOption({ label: OTHER_MEMBER_NICKNAME });

  // 再検証後の詳細画面が、選び直した担当を保ったまま表示される。
  await expect(page.getByLabel(`${TODO_TITLE}の担当`)).toHaveValue("member2");
  await page.reload();
  await expect(page.getByLabel(`${TODO_TITLE}の担当`)).toHaveValue("member2");
});

test("Todo詳細から完了すると、完了済みの詳細へ表示が切り替わる", async ({ page }) => {
  await openTodoDetail(page);

  // 既存と同じ確認手順(「やったよ」→ダイアログ)を通す。
  await page.getByRole("button", { name: `${TODO_TITLE}を記録` }).click();
  await page.getByRole("button", { name: "今、自分がやった" }).click();

  // 完了済みの詳細になり、担当・完了の操作は消えて実施記録の修正が使える。
  await expect(page.getByText("完了", { exact: true })).toBeVisible();
  await expect(page.getByLabel(`${TODO_TITLE}の担当`)).toHaveCount(0);
  await expect(page.getByRole("button", { name: `${TODO_TITLE}を記録` })).toHaveCount(0);
  await expect(page.getByRole("button", { name: `${TODO_TITLE}を修正` })).toBeVisible();

  // Todo一覧側も未完了から消え、実施済みへ移っている。
  await page.goto("/todos");
  await expect(page.getByRole("heading", { level: 3, name: TODO_TITLE })).toHaveCount(0);
  await page.goto("/todos?status=completed");
  await expect(page.getByRole("heading", { level: 3, name: TODO_TITLE })).toBeVisible();
});
