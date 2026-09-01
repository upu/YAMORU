// Issue #265 / YDR-039: 既存Occurrenceへ当時参照できるTaskRuleをbackfillし、
// 以後のルール変更から過去表示を分離するmigrationを検証する。
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import { applyMigrations, applyMigrationsThrough } from "./test-support/migrations";

const db = env.DB;

beforeAll(async () => {
  await applyMigrationsThrough(db, "0018_completion_calendar_rollout_guard");
  await db.batch([
    db.prepare("INSERT INTO users (id, email) VALUES ('user-a', 'a@example.com')"),
    db.prepare("INSERT INTO households (id, name) VALUES ('household-a', 'Household A')"),
    db.prepare("INSERT INTO household_members (household_id, user_id) VALUES ('household-a', 'user-a')"),
    db.prepare("INSERT INTO managed_items (id, household_id, name, kind) VALUES ('item-a', 'household-a', '浄水器', 'appliance')"),
    db.prepare(`INSERT INTO task_rules (
      id, household_id, managed_item_id, title, recurrence_basis, deadline_kind,
      schedule_kind, schedule_day_of_week
    ) VALUES ('rule-a', 'household-a', 'item-a', 'フィルター交換',
      'calendar', 'strict', 'weekly', 1)`),
    db.prepare(`INSERT INTO task_occurrences (
      id, household_id, task_rule_id, scheduled_for, due_at, status
    ) VALUES ('occurrence-a', 'household-a', 'rule-a',
      '2026-08-30T15:00:00.000Z', '2026-08-30T15:00:00.000Z', 'completed')`),
  ]);
  await applyMigrations(db, ["0019_recurring_todo_edit"]);
});

describe("繰り返しTodo編集migration", () => {
  it("既存Occurrenceへ名前・関連先・繰り返し条件をbackfillする", async () => {
    const row = await db.prepare(
      "SELECT rule_snapshot FROM task_occurrences WHERE id = 'occurrence-a'",
    ).first<{ rule_snapshot: string }>();
    expect(JSON.parse(row?.rule_snapshot ?? "{}")).toMatchObject({
      managedItemId: "item-a",
      managedItemName: "浄水器",
      recurrenceBasis: "calendar",
      scheduleDayOfWeek: 1,
      scheduleKind: "weekly",
      title: "フィルター交換",
    });
  });

  it("ルール変更履歴は同じ家庭のRule・Occurrence・操作主体だけを参照できる", async () => {
    const snapshot = JSON.stringify({ title: "変更前" });
    await expect(db.prepare(`INSERT INTO task_rule_changes (
      id, household_id, task_rule_id, task_occurrence_id, actor_user_id,
      previous_rule_snapshot, new_rule_snapshot
    ) VALUES ('change-a', 'household-a', 'rule-a', 'occurrence-a', 'user-a', ?1, ?2)`)
      .bind(snapshot, JSON.stringify({ title: "変更後" })).run()).resolves.toBeDefined();

    await expect(db.prepare(
      "SELECT count(*) AS total FROM task_rule_changes WHERE household_id = 'household-a'",
    ).first()).resolves.toEqual({ total: 1 });
  });
});
