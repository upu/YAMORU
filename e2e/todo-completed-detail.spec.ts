import { expect, test, type Page } from "@playwright/test";
import { getPlatformProxy, type PlatformProxy } from "wrangler";

import { hashPassword } from "../src/lib/auth/password";
import { completeTask, createOneTimeTask } from "../src/lib/d1/todos";
import { addDaysToTokyoDateUtcIso, PHASE_ONE_TIME_ZONE } from "../src/app/time-zone";
import { E2E_WRANGLER_ENVIRONMENT } from "../scripts/e2e-environment";

const OWNER = { email: "owner@example.test", password: "owner-password-value" };
const TODO_TITLE = "浄水器のフィルター交換";

let platform: PlatformProxy<CloudflareEnv>;
let occurrenceId: string;

async function clearDatabase(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM invitation_claims"),
    db.prepare("DELETE FROM household_invitations"),
    db.prepare("DELETE FROM completion_corrections"),
    db.prepare("DELETE FROM activity_logs"),
    db.prepare("DELETE FROM task_occurrences"),
    db.prepare("DELETE FROM task_rules"),
    db.prepare("DELETE FROM external_links"),
    db.prepare("DELETE FROM managed_items"),
    db.prepare("DELETE FROM household_members"),
    db.prepare("DELETE FROM profiles"),
    db.prepare("DELETE FROM households"),
    db.prepare("DELETE FROM users"),
  ]);
}

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
  const ownerHash = await hashPassword(OWNER.password);
  await db.batch([
    db.prepare(
      "INSERT INTO users (id, email, password_hash) VALUES ('owner', ?1, ?2)",
    ).bind(OWNER.email, ownerHash),
    db.prepare("INSERT INTO profiles (user_id, nickname) VALUES ('owner', '家族Aさん')"),
    db.prepare("INSERT INTO households (id, name) VALUES ('household-a', '架空の家庭A')"),
    db.prepare(
      "INSERT INTO household_members (household_id, user_id) VALUES ('household-a', 'owner')",
    ),
  ]);
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

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  const loginRegion = page.getByRole("region", { name: "ログイン" });
  await loginRegion.getByLabel("メールアドレス").fill(OWNER.email);
  await loginRegion.getByLabel("パスワード").fill(OWNER.password);
  await loginRegion.getByRole("button", { name: "ログイン" }).click();
  await expect(page).toHaveURL(/\/$/u);
}

test.beforeAll(async () => {
  platform = await getPlatformProxy<CloudflareEnv>({
    environment: E2E_WRANGLER_ENVIRONMENT,
    persist: true,
    remoteBindings: false,
  });
});

test.beforeEach(async () => {
  await clearDatabase(platform.env.DB);
  await seedCompletedTodo(platform.env.DB);
});

test.afterAll(async () => {
  await platform.dispose();
});

test("完了済みTodoの詳細から実施日を訂正し、完了を取り消して未完了へ戻せる", async ({
  page,
}) => {
  await login(page);

  await page.goto(`/todos/${occurrenceId}`);
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
