// Issue #102 / YDR-040: 既存の定例日ルールの候補指定を、単一値列から
// task_rule_schedulesへ移すmigrationを検証する。1要素の候補集合は移行前と同じ
// 候補列を生むため、既存ルールの予定は変わらない(YDR-040の9)。
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import { completeTask } from "./todos";
import { applyMigrations, applyMigrationsThrough } from "./test-support/migrations";

const db = env.DB;
const memberA = { email: "a@example.com", userId: "user-a" };

beforeAll(async () => {
  await applyMigrationsThrough(db, "0020_consumable_refills");
  await db.batch([
    db.prepare("INSERT INTO users (id, email) VALUES ('user-a', 'a@example.com')"),
    db.prepare("INSERT INTO households (id, name) VALUES ('household-a', 'Household A')"),
    db.prepare("INSERT INTO household_members (household_id, user_id) VALUES ('household-a', 'user-a')"),
    db.prepare(`INSERT INTO task_rules (
      id, household_id, title, recurrence_basis, deadline_kind,
      schedule_kind, schedule_day_of_week
    ) VALUES ('rule-weekly', 'household-a', '毎週の家族会議',
      'calendar', 'strict', 'weekly', 1)`),
    db.prepare(`INSERT INTO task_rules (
      id, household_id, title, recurrence_basis, deadline_kind,
      schedule_kind, schedule_day_of_month, schedule_month_end
    ) VALUES ('rule-month-end', 'household-a', '月謝の支払い',
      'calendar', 'strict', 'monthly_day', 31, 1)`),
    db.prepare(`INSERT INTO task_rules (
      id, household_id, title, recurrence_basis, deadline_kind,
      recommended_start_offset, recommended_until_offset
    ) VALUES ('rule-completion', 'household-a', 'フィルター交換',
      'completion', 'maintenance', 30, 60)`),
    // Asia/Tokyoの2026年8月31日(月)。rule_snapshotは0019がbackfillした形。
    db.prepare(`INSERT INTO task_occurrences (
      id, household_id, task_rule_id, scheduled_for, due_at, status, rule_snapshot
    ) VALUES ('occurrence-weekly', 'household-a', 'rule-weekly',
      '2026-08-30T15:00:00.000Z', '2026-08-30T15:00:00.000Z', 'pending',
      json_object('title', '毎週の家族会議', 'recurrenceBasis', 'calendar',
        'scheduleKind', 'weekly', 'scheduleDayOfWeek', 1))`),
  ]);
  await applyMigrations(db, ["0021_calendar_schedule_specs"]);
});

describe("定例日の候補指定migration", () => {
  it("既存のcalendarルールから候補指定を1件ずつbackfillする", async () => {
    const { results } = await db.prepare(
      `SELECT task_rule_id, schedule_kind, day_of_week, week_of_month, week_last,
              day_of_month, month_end, month
         FROM task_rule_schedules
        ORDER BY task_rule_id`,
    ).all();

    expect(results).toEqual([
      {
        day_of_month: 31,
        day_of_week: 0,
        month: 0,
        month_end: 1,
        schedule_kind: "monthly_day",
        task_rule_id: "rule-month-end",
        week_last: 0,
        week_of_month: 0,
      },
      {
        day_of_month: 0,
        day_of_week: 1,
        month: 0,
        month_end: 0,
        schedule_kind: "weekly",
        task_rule_id: "rule-weekly",
        week_last: 0,
        week_of_month: 0,
      },
    ]);
  });

  it("完了日基準ルールには候補指定を作らない", async () => {
    await expect(db.prepare(
      "SELECT count(*) AS count FROM task_rule_schedules WHERE task_rule_id = 'rule-completion'",
    ).first()).resolves.toEqual({ count: 0 });
  });

  it("既存Occurrenceのスナップショットへ候補指定の配列を足す", async () => {
    const row = await db.prepare(
      "SELECT rule_snapshot FROM task_occurrences WHERE id = 'occurrence-weekly'",
    ).first<{ rule_snapshot: string }>();
    const snapshot = JSON.parse(row?.rule_snapshot ?? "{}") as {
      scheduleDayOfWeek: number;
      scheduleSpecs: Record<string, number | string>[];
    };

    expect(snapshot.scheduleSpecs).toEqual([
      expect.objectContaining({ dayOfWeek: 1, kind: "weekly", weekLast: 0 }),
    ]);
    // 平坦なキーも残し、移行前後で過去回の表示を変えない。
    expect(snapshot.scheduleDayOfWeek).toBe(1);
  });

  it("既存ルールの次回候補は移行後も同じ暦規則で決まる", async () => {
    const nextId = await completeTask(db, memberA, {
      idempotencyKey: "complete-migrated-weekly",
      occurredAt: "2026-08-31T02:00:00.000Z",
      occurrenceId: "occurrence-weekly",
      performedByUserId: null,
    });

    // 8月31日(月)を完了したので、次回は9月7日(月)のまま。
    await expect(db.prepare(
      "SELECT scheduled_for FROM task_occurrences WHERE id = ?1",
    ).bind(nextId).first()).resolves.toEqual({
      scheduled_for: "2026-09-06T15:00:00.000Z",
    });
  });
});
