// Issue #100 / YDR-040: 毎月の曜日方式で複数の第N曜日と最終曜日を持つルールを、
// 保存・候補計算・編集・DB制約の境界で確認する。
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyAllMigrations } from "./test-support/migrations";
import { completeTask, createCalendarTask, updateRecurringTaskRule } from "./todos";

const db = env.DB;
const memberA = { email: "a@example.com", userId: "user-a" };
const TOKYO_2026_07_31 = new Date("2026-07-30T15:00:00.000Z");

function monthlyWeekdayInput(
  weeksOfMonth: number[],
  weekLast: boolean,
  dayOfWeek = 5,
) {
  return {
    managedItemId: null,
    scheduleDayOfMonth: null,
    scheduleDaysOfWeek: [dayOfWeek],
    scheduleKind: "monthly_nth_weekday",
    scheduleMonth: null,
    scheduleMonthEnd: false,
    scheduleWeekLast: weekLast,
    scheduleWeekOfMonth: weeksOfMonth.at(0) ?? null,
    scheduleWeeksOfMonth: weeksOfMonth,
    title: "資源ごみを出す",
  };
}

async function readSpecs(ruleId: string) {
  const { results } = await db.prepare(
    `SELECT day_of_week, week_of_month, week_last
       FROM task_rule_schedules
      WHERE task_rule_id = ?1
      ORDER BY week_of_month, week_last`,
  ).bind(ruleId).all();
  return results;
}

async function pendingOccurrence(ruleId: string) {
  const row = await db.prepare(
    `SELECT id, scheduled_for
       FROM task_occurrences
      WHERE task_rule_id = ?1 AND status = 'pending'`,
  ).bind(ruleId).first<{ id: string; scheduled_for: string }>();
  if (row === null) throw new Error("Pending occurrence not found");
  return row;
}

beforeAll(async () => {
  await applyAllMigrations(db);
});

beforeEach(async () => {
  await db.batch([
    db.prepare("DELETE FROM task_rule_changes"),
    db.prepare("DELETE FROM activity_logs"),
    db.prepare("DELETE FROM task_occurrences"),
    db.prepare("DELETE FROM task_rule_schedules"),
    db.prepare("DELETE FROM task_rules"),
    db.prepare("DELETE FROM household_members"),
    db.prepare("DELETE FROM households"),
    db.prepare("DELETE FROM users"),
    db.prepare("INSERT INTO users (id, email) VALUES ('user-a', 'a@example.com')"),
    db.prepare("INSERT INTO households (id, name) VALUES ('household-a', 'Household A')"),
    db.prepare("INSERT INTO household_members (household_id, user_id) VALUES ('household-a', 'user-a')"),
  ]);
});

describe("毎月の複数第N曜日・最終曜日", () => {
  it("第Nと最終を別の候補指定として昇順に保存する", async () => {
    const ruleId = await createCalendarTask(
      db,
      memberA,
      monthlyWeekdayInput([4, 2, 5], true),
      TOKYO_2026_07_31,
    );

    await expect(readSpecs(ruleId)).resolves.toEqual([
      { day_of_week: 5, week_last: 0, week_of_month: 2 },
      { day_of_week: 5, week_last: 0, week_of_month: 4 },
      { day_of_week: 5, week_last: 0, week_of_month: 5 },
      { day_of_week: 5, week_last: 1, week_of_month: 5 },
    ]);
  });

  it("第5と最終が同日の月もpendingを1件だけ作り、次は最終曜日へ進む", async () => {
    const ruleId = await createCalendarTask(
      db,
      memberA,
      monthlyWeekdayInput([5], true),
      TOKYO_2026_07_31,
    );
    const first = await pendingOccurrence(ruleId);
    expect(first.scheduled_for).toBe("2026-07-30T15:00:00.000Z");

    await completeTask(db, memberA, {
      idempotencyKey: "complete-fifth-and-last",
      occurredAt: "2026-07-31T02:00:00.000Z",
      occurrenceId: first.id,
      performedByUserId: null,
    });

    await expect(pendingOccurrence(ruleId)).resolves.toMatchObject({
      scheduled_for: "2026-08-27T15:00:00.000Z",
    });
    await expect(db.prepare(
      "SELECT count(*) AS count FROM task_occurrences WHERE task_rule_id = ?1 AND status = 'pending'",
    ).bind(ruleId).first()).resolves.toEqual({ count: 1 });
  });

  it("出現位置を編集しても現在回を動かさず、完了後の次回から反映する", async () => {
    const ruleId = await createCalendarTask(
      db,
      memberA,
      monthlyWeekdayInput([5], false),
      TOKYO_2026_07_31,
    );
    const current = await pendingOccurrence(ruleId);

    await updateRecurringTaskRule(db, memberA, current.id, {
      ...monthlyWeekdayInput([2, 4], true),
      recurrenceBasis: "calendar",
    });

    await expect(pendingOccurrence(ruleId)).resolves.toEqual(current);
    await expect(readSpecs(ruleId)).resolves.toEqual([
      { day_of_week: 5, week_last: 0, week_of_month: 2 },
      { day_of_week: 5, week_last: 0, week_of_month: 4 },
      { day_of_week: 5, week_last: 1, week_of_month: 5 },
    ]);

    await completeTask(db, memberA, {
      idempotencyKey: "complete-after-monthly-edit",
      occurredAt: "2026-07-31T02:00:00.000Z",
      occurrenceId: current.id,
      performedByUserId: null,
    });
    await expect(pendingOccurrence(ruleId)).resolves.toMatchObject({
      scheduled_for: "2026-08-13T15:00:00.000Z",
    });
  });
});

describe("最終曜日のDB制約", () => {
  it("monthly_nth_weekdayのweek_of_month=5だけweek_lastを許す", async () => {
    const ruleId = await createCalendarTask(
      db,
      memberA,
      monthlyWeekdayInput([5], false),
      TOKYO_2026_07_31,
    );
    const insert = (week: number, kind = "monthly_nth_weekday") => db.prepare(
      `INSERT INTO task_rule_schedules (
        id, household_id, task_rule_id, schedule_kind,
        day_of_week, week_of_month, week_last, day_of_month, month_end, month
      ) VALUES (?1, 'household-a', ?2, ?3, 5, ?4, 1, 0, 0, 0)`,
    ).bind(crypto.randomUUID(), ruleId, kind, week).run();

    await expect(insert(5)).resolves.toMatchObject({ success: true });
    await expect(insert(4)).rejects.toThrow(/CHECK/u);
    await expect(insert(5, "weekly")).rejects.toThrow();
  });
});
