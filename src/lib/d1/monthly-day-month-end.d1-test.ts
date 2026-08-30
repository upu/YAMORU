// Issue #227 / YDR-032: 毎月の定例日指定の「月末」を、固定日31日と区別して
// 保存・計算できることを確認する。暦計算自体は既存の31日補正規則
// (YDR-021)をそのまま使うため、月末・うるう年・年またぎの候補計算が
// 従来のcreateCalendarTask/completeTaskの流れで正しく進むことを確認する。
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyAllMigrations } from "./test-support/migrations";
import { completeTask, createCalendarTask } from "./todos";

const db = env.DB;
const memberA = { email: "a@example.com", userId: "user-a" };

function requireOccurrenceId(occurrenceId: string | null): string {
  if (occurrenceId === null) throw new Error("Expected a next occurrence to be generated");
  return occurrenceId;
}

async function occurrenceIdForRule(ruleId: string) {
  const row = await db.prepare(
    "SELECT id FROM task_occurrences WHERE task_rule_id = ?1 ORDER BY created_at LIMIT 1",
  ).bind(ruleId).first<{ id: string }>();
  if (row === null) throw new Error("Test occurrence not found");
  return row.id;
}

async function readRule(ruleId: string) {
  return db.prepare(
    "SELECT schedule_kind, schedule_day_of_month, schedule_month_end FROM task_rules WHERE id = ?1",
  ).bind(ruleId).first();
}

async function readOccurrence(occurrenceId: string) {
  return db.prepare(
    "SELECT scheduled_for, due_at FROM task_occurrences WHERE id = ?1",
  ).bind(occurrenceId).first<{ due_at: string; scheduled_for: string }>();
}

beforeAll(async () => {
  await applyAllMigrations(db);
});

beforeEach(async () => {
  await db.batch([
    db.prepare("DELETE FROM activity_logs"),
    db.prepare("DELETE FROM task_occurrences"),
    db.prepare("DELETE FROM task_rules"),
    db.prepare("DELETE FROM household_members"),
    db.prepare("DELETE FROM households"),
    db.prepare("DELETE FROM users"),
    db.prepare("INSERT INTO users (id, email) VALUES ('user-a', 'a@example.com')"),
    db.prepare("INSERT INTO households (id, name) VALUES ('household-a', 'Household A')"),
    db.prepare("INSERT INTO household_members (household_id, user_id) VALUES ('household-a', 'user-a')"),
  ]);
});

describe("毎月末の定例日基準Todo(createCalendarTask)", () => {
  it("固定日31日と月末を区別して保存する", async () => {
    const ruleId = await createCalendarTask(db, memberA, {
      managedItemId: null,
      scheduleDayOfMonth: 31,
      scheduleDayOfWeek: null,
      scheduleKind: "monthly_day",
      scheduleMonth: null,
      scheduleMonthEnd: true,
      scheduleWeekOfMonth: null,
      title: "月謝の支払い",
    }, new Date("2026-01-01T00:00:00.000Z"));

    await expect(readRule(ruleId)).resolves.toEqual({
      schedule_day_of_month: 31,
      schedule_kind: "monthly_day",
      schedule_month_end: 1,
    });

    const occurrenceId = await occurrenceIdForRule(ruleId);
    // Asia/Tokyoの1月31日 00:00 = UTC前日15:00。
    await expect(readOccurrence(occurrenceId)).resolves.toEqual({
      due_at: "2026-01-30T15:00:00.000Z",
      scheduled_for: "2026-01-30T15:00:00.000Z",
    });
  });

  it("遅れて完了しても、次回は元の「毎月末」ルールから次の月末を計算する", async () => {
    const ruleId = await createCalendarTask(db, memberA, {
      managedItemId: null,
      scheduleDayOfMonth: 31,
      scheduleDayOfWeek: null,
      scheduleKind: "monthly_day",
      scheduleMonth: null,
      scheduleMonthEnd: true,
      scheduleWeekOfMonth: null,
      title: "月謝の支払い",
    }, new Date("2026-01-01T00:00:00.000Z"));
    const januaryOccurrenceId = await occurrenceIdForRule(ruleId);

    // 1月末(1/31)の予定を、3日遅れの2/3に完了する。
    const nextOccurrenceId = await completeTask(db, memberA, {
      idempotencyKey: "late-jan-2026",
      occurredAt: "2026-02-02T15:00:00.000Z",
      occurrenceId: januaryOccurrenceId,
      performedByUserId: null,
    });
    // 遅れても2月末をまたいで3月末へは飛ばず、次の月末である2月末になる。
    await expect(readOccurrence(requireOccurrenceId(nextOccurrenceId))).resolves.toMatchObject({
      scheduled_for: "2026-02-27T15:00:00.000Z",
    });
  });

  it("2月・30日までの月を挟んでも正しい月末日を予定日にする", async () => {
    const ruleId = await createCalendarTask(db, memberA, {
      managedItemId: null,
      scheduleDayOfMonth: 31,
      scheduleDayOfWeek: null,
      scheduleKind: "monthly_day",
      scheduleMonth: null,
      scheduleMonthEnd: true,
      scheduleWeekOfMonth: null,
      title: "月謝の支払い",
    }, new Date("2026-01-01T00:00:00.000Z"));
    const firstOccurrenceId = await occurrenceIdForRule(ruleId);

    const secondOccurrenceId = await completeTask(db, memberA, {
      idempotencyKey: "jan-2026",
      occurredAt: "2026-01-30T15:00:00.000Z",
      occurrenceId: firstOccurrenceId,
      performedByUserId: null,
    });
    // 2026年は平年なので2月末は28日。
    const secondOccurrence = requireOccurrenceId(secondOccurrenceId);
    await expect(readOccurrence(secondOccurrence)).resolves.toMatchObject({
      scheduled_for: "2026-02-27T15:00:00.000Z",
    });

    const thirdOccurrenceId = await completeTask(db, memberA, {
      idempotencyKey: "feb-2026",
      occurredAt: "2026-02-27T15:00:00.000Z",
      occurrenceId: secondOccurrence,
      performedByUserId: null,
    });
    // 2月の次は3月。3月は31日まであるので3月末=31日。
    await expect(readOccurrence(requireOccurrenceId(thirdOccurrenceId))).resolves.toMatchObject({
      scheduled_for: "2026-03-30T15:00:00.000Z",
    });
  });

  it("うるう年の2月は29日を月末として次回を計算する", async () => {
    const ruleId = await createCalendarTask(db, memberA, {
      managedItemId: null,
      scheduleDayOfMonth: 31,
      scheduleDayOfWeek: null,
      scheduleKind: "monthly_day",
      scheduleMonth: null,
      scheduleMonthEnd: true,
      scheduleWeekOfMonth: null,
      title: "月謝の支払い",
    }, new Date("2024-01-01T00:00:00.000Z"));
    const januaryOccurrenceId = await occurrenceIdForRule(ruleId);

    const februaryOccurrenceId = await completeTask(db, memberA, {
      idempotencyKey: "jan-2024",
      occurredAt: "2024-01-30T15:00:00.000Z",
      occurrenceId: januaryOccurrenceId,
      performedByUserId: null,
    });
    // 2024年はうるう年なので2月末は29日。
    await expect(readOccurrence(requireOccurrenceId(februaryOccurrenceId))).resolves.toMatchObject({
      scheduled_for: "2024-02-28T15:00:00.000Z",
    });
  });

  it("年をまたいでも毎月末ルールのまま次回を計算する", async () => {
    const ruleId = await createCalendarTask(db, memberA, {
      managedItemId: null,
      scheduleDayOfMonth: 31,
      scheduleDayOfWeek: null,
      scheduleKind: "monthly_day",
      scheduleMonth: null,
      scheduleMonthEnd: true,
      scheduleWeekOfMonth: null,
      title: "月謝の支払い",
    }, new Date("2025-12-01T00:00:00.000Z"));
    const decemberOccurrenceId = await occurrenceIdForRule(ruleId);
    await expect(readOccurrence(decemberOccurrenceId)).resolves.toMatchObject({
      scheduled_for: "2025-12-30T15:00:00.000Z",
    });

    const januaryOccurrenceId = await completeTask(db, memberA, {
      idempotencyKey: "dec-2025",
      occurredAt: "2025-12-30T15:00:00.000Z",
      occurrenceId: decemberOccurrenceId,
      performedByUserId: null,
    });
    const januaryOccurrence = requireOccurrenceId(januaryOccurrenceId);
    await expect(readOccurrence(januaryOccurrence)).resolves.toMatchObject({
      scheduled_for: "2026-01-30T15:00:00.000Z",
    });
    // 元の「毎月末」ルールから計算しており、別のTaskRuleへ切り替わっていない
    // ことを確認する。
    await expect(
      db.prepare("SELECT task_rule_id FROM task_occurrences WHERE id = ?1")
        .bind(januaryOccurrence).first(),
    ).resolves.toEqual({ task_rule_id: ruleId });
  });
});

describe("固定日31日と月末指定のTRIGGER制約(0010_monthly_day_month_end)", () => {
  it("monthly_day以外でschedule_month_end=1を拒否する", async () => {
    await expect(db.prepare(
      `INSERT INTO task_rules (
        id, household_id, title, recurrence_basis, deadline_kind,
        schedule_kind, schedule_day_of_week, schedule_month_end
      ) VALUES ('bad-rule-1', 'household-a', 'Bad', 'calendar', 'strict', 'weekly', 1, 1)`,
    ).run()).rejects.toThrow();
  });

  it("monthly_dayでも日付が31日以外ならschedule_month_end=1を拒否する", async () => {
    await expect(db.prepare(
      `INSERT INTO task_rules (
        id, household_id, title, recurrence_basis, deadline_kind,
        schedule_kind, schedule_day_of_month, schedule_month_end
      ) VALUES ('bad-rule-2', 'household-a', 'Bad', 'calendar', 'strict', 'monthly_day', 15, 1)`,
    ).run()).rejects.toThrow();
  });

  it("monthly_dayかつ31日ならschedule_month_end=1を許可する", async () => {
    await expect(db.prepare(
      `INSERT INTO task_rules (
        id, household_id, title, recurrence_basis, deadline_kind,
        schedule_kind, schedule_day_of_month, schedule_month_end
      ) VALUES ('good-rule', 'household-a', 'Good', 'calendar', 'strict', 'monthly_day', 31, 1)`,
    ).run()).resolves.toBeDefined();
  });
});
