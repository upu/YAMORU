// Issue #48 / YDR-038: 完了日基準Todoの月・年を、初回と完了後で同じ暦補正にする。
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyAllMigrations } from "./test-support/migrations";
import { completeTask, createMaintenanceTask } from "./todos";

const db = env.DB;
const memberA = { email: "a@example.com", userId: "user-a" };

async function resetFixtures(): Promise<void> {
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
}

async function occurrenceIdForRule(ruleId: string): Promise<string> {
  const row = await db.prepare(
    "SELECT id FROM task_occurrences WHERE task_rule_id = ?1 ORDER BY created_at LIMIT 1",
  ).bind(ruleId).first<{ id: string }>();
  if (row === null) throw new Error("Occurrence not found");
  return row.id;
}

async function readOccurrence(id: string) {
  return db.prepare(
    `SELECT scheduled_for, due_at, status, completion_calendar_version
       FROM task_occurrences WHERE id = ?1`,
  ).bind(id).first();
}

beforeAll(async () => {
  await applyAllMigrations(db);
});

beforeEach(resetFixtures);

describe("完了日基準Todoの月・年単位", () => {
  it("月単位の値を保存し、1月31日の完了から2月末〜3月31日を作る", async () => {
    const ruleId = await createMaintenanceTask(db, memberA, {
      firstDueAt: "2025-01-30T15:00:00.000Z",
      firstScheduledFor: "2025-01-30T15:00:00.000Z",
      managedItemId: null,
      recommendedStartOffset: 0,
      recommendedStartValue: 1,
      recommendedUnit: "month",
      recommendedUntilOffset: 0,
      recommendedUntilValue: 2,
      title: "フィルター交換",
    });
    const occurrenceId = await occurrenceIdForRule(ruleId);

    await expect(db.prepare(`SELECT recommended_start_value, recommended_until_value,
      recommended_unit FROM task_rules WHERE id = ?1`).bind(ruleId).first()).resolves.toEqual({
      recommended_start_value: 1,
      recommended_unit: "month",
      recommended_until_value: 2,
    });

    const nextId = await completeTask(db, memberA, {
      idempotencyKey: "complete-month",
      occurredAt: "2025-01-31T02:00:00.000Z",
      occurrenceId,
      performedByUserId: null,
    });
    if (nextId === null) throw new Error("Next occurrence not generated");

    await expect(readOccurrence(nextId)).resolves.toEqual({
      completion_calendar_version: 1,
      due_at: "2025-03-30T15:00:00.000Z",
      scheduled_for: "2025-02-27T15:00:00.000Z",
      status: "pending",
    });
  });

  it("年単位では2月29日の1年後と4年後を別々に補正する", async () => {
    const ruleId = await createMaintenanceTask(db, memberA, {
      firstDueAt: "2024-02-28T15:00:00.000Z",
      firstScheduledFor: "2024-02-28T15:00:00.000Z",
      managedItemId: null,
      recommendedStartOffset: 0,
      recommendedStartValue: 1,
      recommendedUnit: "year",
      recommendedUntilOffset: 0,
      recommendedUntilValue: 4,
      title: "うるう日点検",
    });
    const nextId = await completeTask(db, memberA, {
      idempotencyKey: "complete-year",
      occurredAt: "2024-02-29T02:00:00.000Z",
      occurrenceId: await occurrenceIdForRule(ruleId),
      performedByUserId: null,
    });
    if (nextId === null) throw new Error("Next occurrence not generated");

    await expect(readOccurrence(nextId)).resolves.toMatchObject({
      completion_calendar_version: 1,
      due_at: "2028-02-28T15:00:00.000Z",
      scheduled_for: "2025-02-27T15:00:00.000Z",
    });
  });

  it("追加列のない既存行は従来の日数計算を維持する", async () => {
    const ruleId = await createMaintenanceTask(db, memberA, {
      firstDueAt: "2025-01-30T15:00:00.000Z",
      firstScheduledFor: "2025-01-30T15:00:00.000Z",
      managedItemId: null,
      recommendedStartOffset: 7,
      recommendedUntilOffset: 14,
      title: "既存の週単位",
    });
    const nextId = await completeTask(db, memberA, {
      idempotencyKey: "complete-legacy",
      occurredAt: "2025-01-31T02:00:00.000Z",
      occurrenceId: await occurrenceIdForRule(ruleId),
      performedByUserId: null,
    });
    if (nextId === null) throw new Error("Next occurrence not generated");

    await expect(readOccurrence(nextId)).resolves.toMatchObject({
      completion_calendar_version: null,
      due_at: "2025-02-13T15:00:00.000Z",
      scheduled_for: "2025-02-06T15:00:00.000Z",
    });
  });

  it("旧Worker形式の月単位次回INSERTを拒否し、完了batch全体を戻す", async () => {
    const ruleId = await createMaintenanceTask(db, memberA, {
      firstDueAt: "2025-02-27T15:00:00.000Z",
      firstScheduledFor: "2025-02-27T15:00:00.000Z",
      managedItemId: null,
      recommendedStartOffset: 0,
      recommendedStartValue: 1,
      recommendedUnit: "month",
      recommendedUntilOffset: 0,
      recommendedUntilValue: 1,
      title: "旧Worker防止",
    });
    const occurrenceId = await occurrenceIdForRule(ruleId);

    await expect(db.batch([
      db.prepare(`INSERT INTO activity_logs (
        id, household_id, task_occurrence_id, action, actor_user_id,
        performed_by_user_id, occurred_at, idempotency_key, next_task_occurrence_id
      ) VALUES ('old-log', 'household-a', ?1, 'completed', 'user-a', 'user-a',
        '2025-02-28T02:00:00.000Z', 'old-worker', 'old-next')`).bind(occurrenceId),
      db.prepare("UPDATE task_occurrences SET status = 'completed' WHERE id = ?1")
        .bind(occurrenceId),
      db.prepare(`INSERT INTO task_occurrences (
        id, household_id, task_rule_id, scheduled_for, due_at
      ) VALUES ('old-next', 'household-a', ?1,
        '2025-02-28T15:00:00.000Z', '2025-02-28T15:00:00.000Z')`).bind(ruleId),
    ])).rejects.toThrow("calendar-aware Worker");

    await expect(db.prepare(
      "SELECT status FROM task_occurrences WHERE id = ?1",
    ).bind(occurrenceId).first()).resolves.toEqual({ status: "pending" });
    await expect(db.prepare(
      "SELECT COUNT(*) AS count FROM activity_logs WHERE id = 'old-log'",
    ).first()).resolves.toEqual({ count: 0 });
  });
});
