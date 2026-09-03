// Issue #100 / YDR-040: 0022が既存の月次ルールを保ったまま最終曜日を有効化し、
// 旧Workerが最終曜日を第5曜日として進めないロールアウト境界を確認する。
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import { applyMigrations, applyMigrationsThrough } from "./test-support/migrations";
import { completeTask, createCalendarTask } from "./todos";

const db = env.DB;
const memberA = { email: "a@example.com", userId: "user-a" };

beforeAll(async () => {
  await applyMigrationsThrough(db, "0021_calendar_schedule_specs");
  await db.batch([
    db.prepare("INSERT INTO users (id, email) VALUES ('user-a', 'a@example.com')"),
    db.prepare("INSERT INTO households (id, name) VALUES ('household-a', 'Household A')"),
    db.prepare("INSERT INTO household_members (household_id, user_id) VALUES ('household-a', 'user-a')"),
    db.prepare(`INSERT INTO task_rules (
      id, household_id, title, recurrence_basis, deadline_kind,
      schedule_kind, schedule_day_of_week, schedule_week_of_month
    ) VALUES ('rule-existing', 'household-a', '既存の第2火曜',
      'calendar', 'strict', 'monthly_nth_weekday', 2, 2)`),
    db.prepare(`INSERT INTO task_rule_schedules (
      id, household_id, task_rule_id, schedule_kind,
      day_of_week, week_of_month, week_last, day_of_month, month_end, month
    ) VALUES ('spec-existing', 'household-a', 'rule-existing',
      'monthly_nth_weekday', 2, 2, 0, 0, 0, 0)`),
    db.prepare(`INSERT INTO task_rules (
      id, household_id, title, recurrence_basis, deadline_kind,
      schedule_kind, schedule_day_of_month, schedule_month_end
    ) VALUES ('rule-existing-month-end', 'household-a', '既存の毎月末',
      'calendar', 'strict', 'monthly_day', 31, 1)`),
    db.prepare(`INSERT INTO task_rule_schedules (
      id, household_id, task_rule_id, schedule_kind,
      day_of_week, week_of_month, week_last, day_of_month, month_end, month
    ) VALUES ('spec-existing-month-end', 'household-a', 'rule-existing-month-end',
      'monthly_day', 0, 0, 0, 31, 1, 0)`),
    db.prepare(`INSERT INTO task_occurrences (
      id, household_id, task_rule_id, scheduled_for, due_at, status,
      schedule_spec_version
    ) VALUES ('occurrence-existing', 'household-a', 'rule-existing',
      '2026-08-10T15:00:00.000Z', '2026-08-10T15:00:00.000Z', 'pending', 1)`),
  ]);
  await applyMigrations(db, ["0022_monthly_weekday_positions"]);
});

describe("0022_monthly_weekday_positions", () => {
  it("既存の第N曜日指定を同じ意味のまま保持する", async () => {
    await expect(db.prepare(
      `SELECT id, day_of_week, week_of_month, week_last
         FROM task_rule_schedules WHERE task_rule_id = 'rule-existing'`,
    ).first()).resolves.toEqual({
      day_of_week: 2,
      id: "spec-existing",
      week_last: 0,
      week_of_month: 2,
    });

    const nextId = await completeTask(db, memberA, {
      idempotencyKey: "complete-existing-monthly-weekday",
      occurredAt: "2026-08-11T02:00:00.000Z",
      occurrenceId: "occurrence-existing",
      performedByUserId: null,
    });
    await expect(db.prepare(
      "SELECT scheduled_for FROM task_occurrences WHERE id = ?1",
    ).bind(nextId).first()).resolves.toEqual({
      scheduled_for: "2026-09-07T15:00:00.000Z",
    });
  });

  it("既存の月次日付・月末指定も同じ意味のまま保持する", async () => {
    await expect(db.prepare(
      `SELECT day_of_month, month_end, week_last
         FROM task_rule_schedules WHERE task_rule_id = 'rule-existing-month-end'`,
    ).first()).resolves.toEqual({
      day_of_month: 31,
      month_end: 1,
      week_last: 0,
    });
  });

  it("最終曜日1件だけのルールもversionなしの旧Worker書き込みを拒否する", async () => {
    const ruleId = await createCalendarTask(db, memberA, {
      managedItemId: null,
      scheduleDayOfMonth: null,
      scheduleDaysOfWeek: [5],
      scheduleKind: "monthly_nth_weekday",
      scheduleMonth: null,
      scheduleMonthEnd: false,
      scheduleWeekLast: true,
      scheduleWeekOfMonth: null,
      scheduleWeeksOfMonth: [],
      title: "毎月最終金曜",
    }, new Date("2026-08-01T00:00:00.000Z"));

    await expect(db.prepare(
      `INSERT INTO task_occurrences (
        id, household_id, task_rule_id, scheduled_for, due_at, status
      ) VALUES ('old-worker-occurrence', 'household-a', ?1,
        '2026-09-24T15:00:00.000Z', '2026-09-24T15:00:00.000Z', 'completed')`,
    ).bind(ruleId).run()).rejects.toThrow(/schedule-spec-aware Worker/u);
  });
});
