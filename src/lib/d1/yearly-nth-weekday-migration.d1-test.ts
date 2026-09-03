// Issue #101 / YDR-040の8・9: 0023はtask_rulesとその子孫を作り直す。既存の
// 定例日ルール・Occurrence・履歴・関連付けを保ったまま、yearly_nth_weekdayと
// 親子の種類の一致を守る複合外部キーを有効にすることを確認する。
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import { applyMigrations, applyMigrationsThrough } from "./test-support/migrations";
import { completeTask, createCalendarTask } from "./todos";

const db = env.DB;
const memberA = { email: "a@example.com", userId: "user-a" };

beforeAll(async () => {
  await applyMigrationsThrough(db, "0022_monthly_weekday_positions");
  await db.batch([
    db.prepare("INSERT INTO users (id, email) VALUES ('user-a', 'a@example.com')"),
    db.prepare("INSERT INTO households (id, name) VALUES ('household-a', 'Household A')"),
    db.prepare("INSERT INTO household_members (household_id, user_id) VALUES ('household-a', 'user-a')"),
    db.prepare(`INSERT INTO managed_items (id, household_id, name, kind)
      VALUES ('item-existing', 'household-a', '玄関', 'housing_equipment')`),
    db.prepare(`INSERT INTO task_rules (
      id, household_id, managed_item_id, title, recurrence_basis, deadline_kind,
      schedule_kind, schedule_day_of_month, schedule_month
    ) VALUES ('rule-yearly', 'household-a', 'item-existing', '既存の毎年11月20日',
      'calendar', 'strict', 'yearly', 20, 11)`),
    db.prepare(`INSERT INTO task_rule_schedules (
      id, household_id, task_rule_id, schedule_kind,
      day_of_week, week_of_month, week_last, day_of_month, month_end, month
    ) VALUES ('spec-yearly', 'household-a', 'rule-yearly',
      'yearly', 0, 0, 0, 20, 0, 11)`),
    db.prepare(`INSERT INTO task_occurrences (
      id, household_id, task_rule_id, scheduled_for, due_at, status,
      schedule_spec_version
    ) VALUES ('occurrence-yearly', 'household-a', 'rule-yearly',
      '2026-05-19T15:00:00.000Z', '2026-05-19T15:00:00.000Z', 'pending', 1)`),
    db.prepare(`INSERT INTO activity_logs (
      id, household_id, task_occurrence_id, action, actor_user_id, occurred_at
    ) VALUES ('log-existing', 'household-a', 'occurrence-yearly', 'postponed',
      'user-a', '2026-05-01T02:00:00.000Z')`),
  ]);
  await applyMigrations(db, ["0023_yearly_nth_weekday"]);
});

describe("0023_yearly_nth_weekday", () => {
  it("既存の毎年月日ルールと候補指定・Occurrence・履歴を保つ", async () => {
    await expect(db.prepare(
      `SELECT schedule_kind, schedule_day_of_month, schedule_month, managed_item_id
         FROM task_rules WHERE id = 'rule-yearly'`,
    ).first()).resolves.toEqual({
      managed_item_id: "item-existing",
      schedule_day_of_month: 20,
      schedule_kind: "yearly",
      schedule_month: 11,
    });
    await expect(db.prepare(
      `SELECT day_of_month, month, schedule_kind
         FROM task_rule_schedules WHERE id = 'spec-yearly'`,
    ).first()).resolves.toEqual({
      day_of_month: 20,
      month: 11,
      schedule_kind: "yearly",
    });
    await expect(db.prepare(
      "SELECT status, scheduled_for FROM task_occurrences WHERE id = 'occurrence-yearly'",
    ).first()).resolves.toEqual({
      scheduled_for: "2026-05-19T15:00:00.000Z",
      status: "pending",
    });
    await expect(db.prepare(
      "SELECT action FROM activity_logs WHERE id = 'log-existing'",
    ).first()).resolves.toEqual({ action: "postponed" });
  });

  it("既存の毎年月日ルールが移行後も同じ次回候補を生む", async () => {
    const nextId = await completeTask(db, memberA, {
      idempotencyKey: "complete-existing-yearly",
      occurredAt: "2026-05-20T02:00:00.000Z",
      occurrenceId: "occurrence-yearly",
      performedByUserId: null,
    });

    await expect(db.prepare(
      "SELECT scheduled_for FROM task_occurrences WHERE id = ?1",
    ).bind(nextId).first()).resolves.toEqual({
      scheduled_for: "2026-11-19T15:00:00.000Z",
    });
  });

  it("移行後はyearly_nth_weekdayのルールを保存できる", async () => {
    const ruleId = await createCalendarTask(db, memberA, {
      managedItemId: null,
      scheduleDayOfMonth: null,
      scheduleDaysOfWeek: [4],
      scheduleKind: "yearly_nth_weekday",
      scheduleMonth: 11,
      scheduleMonthEnd: false,
      scheduleWeekLast: false,
      scheduleWeekOfMonth: 3,
      scheduleWeeksOfMonth: [3],
      title: "毎年11月の第3木曜",
    }, new Date("2025-12-31T15:00:00.000Z"));

    await expect(db.prepare(
      "SELECT scheduled_for FROM task_occurrences WHERE task_rule_id = ?1",
    ).bind(ruleId).first()).resolves.toEqual({
      scheduled_for: "2026-11-18T15:00:00.000Z",
    });
  });
});
