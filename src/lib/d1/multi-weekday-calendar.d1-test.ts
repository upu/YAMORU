// Issue #102 / YDR-040: 一つの定例日ルールが複数の曜日を持てることを、保存形式
// (task_rule_schedules)・候補列・単一pending・編集・家庭境界の順に確認する。
// 候補列は候補指定の和集合であり(YDR-040の2)、次回はYDR-013をそのまま適用して
// 1件だけ作る(YDR-014・YDR-016)。
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyAllMigrations } from "./test-support/migrations";
import { completeTask, createCalendarTask, updateRecurringTaskRule } from "./todos";

const db = env.DB;
const memberA = { email: "a@example.com", userId: "user-a" };
const memberB = { email: "b@example.com", userId: "user-b" };

// Asia/Tokyoの2026年8月: 月曜は3・10・17・24・31日、木曜は6・13・20・27日。
const TOKYO_2026_08_04 = new Date("2026-08-03T15:00:00.000Z");

function weeklyInput(daysOfWeek: number[], title = "毎週の家族会議") {
  return {
    managedItemId: null,
    scheduleDayOfMonth: null,
    scheduleDaysOfWeek: daysOfWeek,
    scheduleKind: "weekly",
    scheduleMonth: null,
    scheduleMonthEnd: false,
    scheduleWeekOfMonth: null,
    title,
  };
}

async function readSpecs(ruleId: string) {
  const { results } = await db.prepare(
    `SELECT schedule_kind, day_of_week, week_of_month, week_last,
            day_of_month, month_end, month
       FROM task_rule_schedules
      WHERE task_rule_id = ?1
      ORDER BY day_of_week`,
  ).bind(ruleId).all();
  return results;
}

async function pendingOccurrence(ruleId: string) {
  const row = await db.prepare(
    `SELECT id, scheduled_for, due_at, schedule_spec_version
       FROM task_occurrences
      WHERE task_rule_id = ?1 AND status = 'pending'`,
  ).bind(ruleId).first<{
    due_at: string;
    id: string;
    schedule_spec_version: number | null;
    scheduled_for: string;
  }>();
  if (row === null) throw new Error("Pending occurrence not found");
  return row;
}

async function countPending(ruleId: string) {
  const row = await db.prepare(
    "SELECT count(*) AS count FROM task_occurrences WHERE task_rule_id = ?1 AND status = 'pending'",
  ).bind(ruleId).first<{ count: number }>();
  return row?.count ?? 0;
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
    db.prepare("INSERT INTO users (id, email) VALUES ('user-a', 'a@example.com'), ('user-b', 'b@example.com')"),
    db.prepare("INSERT INTO households (id, name) VALUES ('household-a', 'Household A'), ('household-b', 'Household B')"),
    db.prepare("INSERT INTO household_members (household_id, user_id) VALUES ('household-a', 'user-a'), ('household-b', 'user-b')"),
  ]);
});

describe("複数曜日の定例日基準Todo(createCalendarTask)", () => {
  it("選んだ曜日を候補指定として1件ずつ保存する", async () => {
    const ruleId = await createCalendarTask(db, memberA, weeklyInput([4, 1]), TOKYO_2026_08_04);

    await expect(readSpecs(ruleId)).resolves.toEqual([
      {
        day_of_month: 0,
        day_of_week: 1,
        month: 0,
        month_end: 0,
        schedule_kind: "weekly",
        week_last: 0,
        week_of_month: 0,
      },
      {
        day_of_month: 0,
        day_of_week: 4,
        month: 0,
        month_end: 0,
        schedule_kind: "weekly",
        week_last: 0,
        week_of_month: 0,
      },
    ]);
  });

  it("初回は登録日以降で最も早い候補だけをpendingにする", async () => {
    const ruleId = await createCalendarTask(db, memberA, weeklyInput([1, 4]), TOKYO_2026_08_04);

    // 8月4日(火)に登録すると、次の木曜(8月6日)が最も早い候補。
    await expect(pendingOccurrence(ruleId)).resolves.toMatchObject({
      due_at: "2026-08-05T15:00:00.000Z",
      schedule_spec_version: 1,
      scheduled_for: "2026-08-05T15:00:00.000Z",
    });
    await expect(countPending(ruleId)).resolves.toBe(1);
  });

  it("完了すると次の選択曜日へ1件だけ進む", async () => {
    const ruleId = await createCalendarTask(db, memberA, weeklyInput([1, 4]), TOKYO_2026_08_04);
    const first = await pendingOccurrence(ruleId);

    await completeTask(db, memberA, {
      idempotencyKey: "complete-thursday",
      occurredAt: "2026-08-05T16:00:00.000Z",
      occurrenceId: first.id,
      performedByUserId: null,
    });

    // 8月6日(木)を完了したので、次回は8月10日(月)。
    await expect(pendingOccurrence(ruleId)).resolves.toMatchObject({
      scheduled_for: "2026-08-09T15:00:00.000Z",
    });
    await expect(countPending(ruleId)).resolves.toBe(1);
  });

  it("遅延完了では実施日時以前の候補を飛ばし、さかのぼって作らない", async () => {
    const ruleId = await createCalendarTask(db, memberA, weeklyInput([1, 4]), TOKYO_2026_08_04);
    const first = await pendingOccurrence(ruleId);

    // 8月6日(木)予定を8月20日(木)に完了する。
    await completeTask(db, memberA, {
      idempotencyKey: "complete-late",
      occurredAt: "2026-08-19T16:00:00.000Z",
      occurrenceId: first.id,
      performedByUserId: null,
    });

    // 8月10日〜8月20日の候補は作らず、次回は8月24日(月)の1件だけ。
    await expect(pendingOccurrence(ruleId)).resolves.toMatchObject({
      scheduled_for: "2026-08-23T15:00:00.000Z",
    });
    const { results } = await db.prepare(
      "SELECT count(*) AS count FROM task_occurrences WHERE task_rule_id = ?1",
    ).bind(ruleId).all();
    expect(results).toEqual([{ count: 2 }]);
  });

  it("曜日を1つも選ばないルールは作れない", async () => {
    await expect(createCalendarTask(db, memberA, weeklyInput([]), TOKYO_2026_08_04))
      .rejects.toThrow("Weekly schedule requires 1 to 7 weekdays");
    await expect(db.prepare("SELECT count(*) AS count FROM task_rules").first())
      .resolves.toEqual({ count: 0 });
  });
});

describe("候補指定のDB制約", () => {
  async function insertSpec(
    ruleId: string,
    overrides: Record<string, number | string> = {},
  ) {
    const values = {
      day_of_month: 0,
      day_of_week: 2,
      household_id: "household-a",
      month: 0,
      month_end: 0,
      schedule_kind: "weekly",
      week_last: 0,
      week_of_month: 0,
      ...overrides,
    };
    return db.prepare(
      `INSERT INTO task_rule_schedules (
        id, household_id, task_rule_id, schedule_kind,
        day_of_week, week_of_month, week_last, day_of_month, month_end, month
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    ).bind(
      crypto.randomUUID(),
      values.household_id,
      ruleId,
      values.schedule_kind,
      values.day_of_week,
      values.week_of_month,
      values.week_last,
      values.day_of_month,
      values.month_end,
      values.month,
    ).run();
  }

  it("同じ候補指定を二度保存できない", async () => {
    const ruleId = await createCalendarTask(db, memberA, weeklyInput([1]), TOKYO_2026_08_04);
    await expect(insertSpec(ruleId, { day_of_week: 1 })).rejects.toThrow(/UNIQUE/u);
  });

  it("親と違う種類の候補指定を保存できない", async () => {
    const ruleId = await createCalendarTask(db, memberA, weeklyInput([1]), TOKYO_2026_08_04);
    await expect(
      insertSpec(ruleId, { day_of_month: 5, day_of_week: 0, schedule_kind: "monthly_day" }),
    ).rejects.toThrow(/same schedule_kind/u);
  });

  it("範囲外の曜日と、まだ有効化していない最終曜日を保存できない", async () => {
    const ruleId = await createCalendarTask(db, memberA, weeklyInput([1]), TOKYO_2026_08_04);
    await expect(insertSpec(ruleId, { day_of_week: 8 })).rejects.toThrow(/CHECK/u);
    await expect(insertSpec(ruleId, { day_of_week: 2, week_last: 1 })).rejects.toThrow(/CHECK/u);
  });

  it("他の家庭の候補指定として保存できない", async () => {
    const ruleId = await createCalendarTask(db, memberA, weeklyInput([1]), TOKYO_2026_08_04);
    await expect(insertSpec(ruleId, { household_id: "household-b" })).rejects.toThrow();
    await expect(
      db.prepare(
        "SELECT count(*) AS count FROM task_rule_schedules WHERE task_rule_id = ?1",
      ).bind(ruleId).first(),
    ).resolves.toEqual({ count: 1 });
  });

  // 0021のロールアウトガード(0018と同じ考え方)。候補指定を1件しか読まない
  // 旧Workerが、複数候補ルールの次回Occurrenceを作ってしまうことを防ぐ。
  it("複数候補ルールのOccurrenceはversionなしで作れない", async () => {
    const ruleId = await createCalendarTask(db, memberA, weeklyInput([1, 4]), TOKYO_2026_08_04);
    await expect(db.prepare(
      `INSERT INTO task_occurrences (
        id, household_id, task_rule_id, scheduled_for, due_at, status
      ) VALUES (?1, 'household-a', ?2,
        '2026-09-06T15:00:00.000Z', '2026-09-06T15:00:00.000Z', 'completed')`,
    ).bind(crypto.randomUUID(), ruleId).run())
      .rejects.toThrow(/schedule-spec-aware Worker/u);
  });

  it("候補指定が1件のルールは旧Workerの書き込みを妨げない", async () => {
    const ruleId = await createCalendarTask(db, memberA, weeklyInput([1]), TOKYO_2026_08_04);
    await expect(db.prepare(
      `INSERT INTO task_occurrences (
        id, household_id, task_rule_id, scheduled_for, due_at, status
      ) VALUES (?1, 'household-a', ?2,
        '2026-09-06T15:00:00.000Z', '2026-09-06T15:00:00.000Z', 'completed')`,
    ).bind(crypto.randomUUID(), ruleId).run()).resolves.toMatchObject({ success: true });
  });
});

describe("複数曜日ルールの編集(updateRecurringTaskRule)", () => {
  it("選び直した曜日で候補指定を置き換える", async () => {
    const ruleId = await createCalendarTask(db, memberA, weeklyInput([1, 4]), TOKYO_2026_08_04);
    const occurrence = await pendingOccurrence(ruleId);

    await updateRecurringTaskRule(db, memberA, occurrence.id, {
      managedItemId: null,
      recurrenceBasis: "calendar",
      scheduleDayOfMonth: null,
      scheduleDaysOfWeek: [2, 6],
      scheduleKind: "weekly",
      scheduleMonth: null,
      scheduleMonthEnd: false,
      scheduleWeekOfMonth: null,
      title: "毎週の家族会議",
    });

    await expect(readSpecs(ruleId)).resolves.toMatchObject([
      { day_of_week: 2 },
      { day_of_week: 6 },
    ]);
    // 現在回の予定は動かさない(YDR-039の1)。
    await expect(pendingOccurrence(ruleId)).resolves.toMatchObject({
      scheduled_for: occurrence.scheduled_for,
    });
  });

  it("編集後の完了は新しい候補指定で次回を決める", async () => {
    const ruleId = await createCalendarTask(db, memberA, weeklyInput([1, 4]), TOKYO_2026_08_04);
    const occurrence = await pendingOccurrence(ruleId);

    await updateRecurringTaskRule(db, memberA, occurrence.id, {
      managedItemId: null,
      recurrenceBasis: "calendar",
      scheduleDayOfMonth: null,
      scheduleDaysOfWeek: [3],
      scheduleKind: "weekly",
      scheduleMonth: null,
      scheduleMonthEnd: false,
      scheduleWeekOfMonth: null,
      title: "毎週水曜の家族会議",
    });

    await completeTask(db, memberA, {
      idempotencyKey: "complete-after-weekday-edit",
      occurredAt: "2026-08-05T16:00:00.000Z",
      occurrenceId: occurrence.id,
      performedByUserId: null,
    });

    // 8月6日(木)を完了した後の次回は、編集後の水曜(8月12日)。
    await expect(pendingOccurrence(ruleId)).resolves.toMatchObject({
      scheduled_for: "2026-08-11T15:00:00.000Z",
    });
  });

  it("他の家庭からは候補指定を書き換えられない", async () => {
    const ruleId = await createCalendarTask(db, memberA, weeklyInput([1, 4]), TOKYO_2026_08_04);
    const occurrence = await pendingOccurrence(ruleId);

    await expect(updateRecurringTaskRule(db, memberB, occurrence.id, {
      managedItemId: null,
      recurrenceBasis: "calendar",
      scheduleDayOfMonth: null,
      scheduleDaysOfWeek: [2],
      scheduleKind: "weekly",
      scheduleMonth: null,
      scheduleMonthEnd: false,
      scheduleWeekOfMonth: null,
      title: "乗っ取り",
    })).rejects.toThrow();

    await expect(readSpecs(ruleId)).resolves.toMatchObject([
      { day_of_week: 1 },
      { day_of_week: 4 },
    ]);
  });
});
