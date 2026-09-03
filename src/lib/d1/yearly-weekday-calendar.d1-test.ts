// Issue #101 / YDR-040: 毎年の第N曜日・最終曜日を持つルールを、保存・候補計算・
// 編集・DB制約の境界で確認する。
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyAllMigrations } from "./test-support/migrations";
import { completeTask, createCalendarTask, updateRecurringTaskRule } from "./todos";

const db = env.DB;
const memberA = { email: "a@example.com", userId: "user-a" };
const TOKYO_2026_01_01 = new Date("2025-12-31T15:00:00.000Z");

function yearlyWeekdayInput(
  month: number,
  weeksOfMonth: number[],
  weekLast: boolean,
  dayOfWeek = 4,
) {
  return {
    managedItemId: null,
    scheduleDayOfMonth: null,
    scheduleDaysOfWeek: [dayOfWeek],
    scheduleKind: "yearly_nth_weekday",
    scheduleMonth: month,
    scheduleMonthEnd: false,
    scheduleWeekLast: weekLast,
    scheduleWeekOfMonth: weeksOfMonth.at(0) ?? null,
    scheduleWeeksOfMonth: weeksOfMonth,
    title: "年末の大掃除",
  };
}

async function readSpecs(ruleId: string) {
  const { results } = await db.prepare(
    `SELECT day_of_week, month, week_of_month, week_last
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

describe("毎年の第N曜日と最終曜日", () => {
  it("月を含む候補指定として保存し、初回は指定月の第N曜日にする", async () => {
    const ruleId = await createCalendarTask(
      db,
      memberA,
      yearlyWeekdayInput(11, [3], false),
      TOKYO_2026_01_01,
    );

    await expect(readSpecs(ruleId)).resolves.toEqual([
      { day_of_week: 4, month: 11, week_last: 0, week_of_month: 3 },
    ]);
    await expect(pendingOccurrence(ruleId)).resolves.toMatchObject({
      scheduled_for: "2026-11-18T15:00:00.000Z",
    });
  });

  it("完了すると翌年の同じ位置へ進む", async () => {
    const ruleId = await createCalendarTask(
      db,
      memberA,
      yearlyWeekdayInput(5, [2], false, 1),
      TOKYO_2026_01_01,
    );
    const first = await pendingOccurrence(ruleId);
    expect(first.scheduled_for).toBe("2026-05-10T15:00:00.000Z");

    await completeTask(db, memberA, {
      idempotencyKey: "complete-yearly-nth-weekday",
      occurredAt: "2026-05-11T02:00:00.000Z",
      occurrenceId: first.id,
      performedByUserId: null,
    });

    await expect(pendingOccurrence(ruleId)).resolves.toMatchObject({
      scheduled_for: "2027-05-09T15:00:00.000Z",
    });
  });

  it("第5曜日がない年をスキップし、最終曜日はその年に候補を作る", async () => {
    const fifth = await createCalendarTask(
      db,
      memberA,
      yearlyWeekdayInput(5, [5], false, 1),
      TOKYO_2026_01_01,
    );
    const last = await createCalendarTask(
      db,
      memberA,
      yearlyWeekdayInput(5, [], true, 1),
      TOKYO_2026_01_01,
    );

    await expect(pendingOccurrence(fifth)).resolves.toMatchObject({
      scheduled_for: "2027-05-30T15:00:00.000Z",
    });
    await expect(pendingOccurrence(last)).resolves.toMatchObject({
      scheduled_for: "2026-05-24T15:00:00.000Z",
    });
  });

  it("同じ年に複数の位置が当たってもpendingは1件で、次は後ろの位置へ進む", async () => {
    const ruleId = await createCalendarTask(
      db,
      memberA,
      yearlyWeekdayInput(5, [2], true, 1),
      TOKYO_2026_01_01,
    );
    const first = await pendingOccurrence(ruleId);
    expect(first.scheduled_for).toBe("2026-05-10T15:00:00.000Z");

    await completeTask(db, memberA, {
      idempotencyKey: "complete-yearly-second-monday",
      occurredAt: "2026-05-11T02:00:00.000Z",
      occurrenceId: first.id,
      performedByUserId: null,
    });

    await expect(pendingOccurrence(ruleId)).resolves.toMatchObject({
      scheduled_for: "2026-05-24T15:00:00.000Z",
    });
    await expect(db.prepare(
      "SELECT count(*) AS count FROM task_occurrences WHERE task_rule_id = ?1 AND status = 'pending'",
    ).bind(ruleId).first()).resolves.toEqual({ count: 1 });
  });

  // YDR-039 / YDR-040の6: 方式を変える編集でも現在回は動かさず、次回から反映する。
  it("毎年の月日から曜日方式へ変えても現在回を動かさない", async () => {
    const ruleId = await createCalendarTask(db, memberA, {
      managedItemId: null,
      scheduleDayOfMonth: 20,
      scheduleDaysOfWeek: [],
      scheduleKind: "yearly",
      scheduleMonth: 5,
      scheduleMonthEnd: false,
      scheduleWeekOfMonth: null,
      title: "年末の大掃除",
    }, TOKYO_2026_01_01);
    const current = await pendingOccurrence(ruleId);
    expect(current.scheduled_for).toBe("2026-05-19T15:00:00.000Z");

    await updateRecurringTaskRule(db, memberA, current.id, {
      ...yearlyWeekdayInput(5, [2], false, 1),
      recurrenceBasis: "calendar",
    });

    await expect(pendingOccurrence(ruleId)).resolves.toEqual(current);
    await expect(db.prepare(
      "SELECT schedule_kind FROM task_rules WHERE id = ?1",
    ).bind(ruleId).first()).resolves.toEqual({ schedule_kind: "yearly_nth_weekday" });
    await expect(readSpecs(ruleId)).resolves.toEqual([
      { day_of_week: 1, month: 5, week_last: 0, week_of_month: 2 },
    ]);

    await completeTask(db, memberA, {
      idempotencyKey: "complete-after-yearly-edit",
      occurredAt: "2026-05-21T02:00:00.000Z",
      occurrenceId: current.id,
      performedByUserId: null,
    });
    await expect(pendingOccurrence(ruleId)).resolves.toMatchObject({
      scheduled_for: "2027-05-09T15:00:00.000Z",
    });
  });
});

describe("毎年の第N曜日のDB制約", () => {
  it("月のない候補指定と、親と違う種類の候補指定を拒否する", async () => {
    const ruleId = await createCalendarTask(
      db,
      memberA,
      yearlyWeekdayInput(11, [3], false),
      TOKYO_2026_01_01,
    );
    const insert = (month: number, week: number, kind = "yearly_nth_weekday") =>
      db.prepare(
        `INSERT INTO task_rule_schedules (
          id, household_id, task_rule_id, schedule_kind,
          day_of_week, week_of_month, week_last, day_of_month, month_end, month
        ) VALUES (?1, 'household-a', ?2, ?3, 4, ?4, 0, 0, 0, ?5)`,
      ).bind(crypto.randomUUID(), ruleId, kind, week, month).run();

    await expect(insert(11, 1)).resolves.toMatchObject({ success: true });
    await expect(insert(0, 2)).rejects.toThrow(/CHECK/u);
    await expect(insert(13, 2)).rejects.toThrow(/CHECK/u);
    // 月を持たない月次の候補指定はCHECKを満たすが、親の種類と違うため
    // 0023の複合外部キーで拒否される(YDR-040の8)。
    await expect(insert(0, 2, "monthly_nth_weekday")).rejects.toThrow(/FOREIGN KEY/u);
  });

  it("最終曜日はweek_of_month = 5のときだけ許す", async () => {
    const ruleId = await createCalendarTask(
      db,
      memberA,
      yearlyWeekdayInput(11, [3], false),
      TOKYO_2026_01_01,
    );
    const insertLast = (week: number) => db.prepare(
      `INSERT INTO task_rule_schedules (
        id, household_id, task_rule_id, schedule_kind,
        day_of_week, week_of_month, week_last, day_of_month, month_end, month
      ) VALUES (?1, 'household-a', ?2, 'yearly_nth_weekday', 4, ?3, 1, 0, 0, 11)`,
    ).bind(crypto.randomUUID(), ruleId, week).run();

    await expect(insertLast(5)).resolves.toMatchObject({ success: true });
    await expect(insertLast(4)).rejects.toThrow(/CHECK/u);
  });

  it("versionを明示しない旧Workerの書き込みを拒否する", async () => {
    const ruleId = await createCalendarTask(
      db,
      memberA,
      yearlyWeekdayInput(11, [3], false),
      TOKYO_2026_01_01,
    );

    await expect(db.prepare(
      `INSERT INTO task_occurrences (
        id, household_id, task_rule_id, scheduled_for, due_at, status
      ) VALUES ('old-worker-occurrence', 'household-a', ?1,
        '2027-11-17T15:00:00.000Z', '2027-11-17T15:00:00.000Z', 'completed')`,
    ).bind(ruleId).run()).rejects.toThrow(/schedule-spec-aware Worker/u);
  });
});
