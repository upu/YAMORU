import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { listRecentActiveCompletions } from "./home";
import { loadManagedItemDetail } from "./managed-item-detail";
import { applyAllMigrations } from "./test-support/migrations";
import {
  completeTask,
  correctCompletionOccurredAt,
  createCalendarTask,
  createIntervalTask,
  createMaintenanceTask,
  loadTodoDetail,
  undoTaskCompletion,
  updateRecurringOccurrence,
  updateRecurringTaskRule,
} from "./todos";

const db = env.DB;
const memberA = { email: "a@example.com", userId: "user-a" };
const memberB = { email: "b@example.com", userId: "user-b" };

async function occurrenceIdForRule(ruleId) {
  const row = await db.prepare(
    "SELECT id FROM task_occurrences WHERE task_rule_id = ?1 ORDER BY created_at LIMIT 1",
  ).bind(ruleId).first();
  if (row === null) throw new Error("Test occurrence not found");
  return row.id;
}

async function readTodo(occurrenceId) {
  return db.prepare(
    `SELECT o.scheduled_for, o.due_at, o.assignee_user_id, o.status,
            r.title, r.managed_item_id
       FROM task_occurrences o
       JOIN task_rules r ON r.id = o.task_rule_id
      WHERE o.id = ?1`,
  ).bind(occurrenceId).first();
}

beforeAll(async () => {
  await applyAllMigrations(db);
});

beforeEach(async () => {
  await db.batch([
    db.prepare("DELETE FROM completion_corrections"),
    db.prepare("DELETE FROM activity_logs"),
    db.prepare("DELETE FROM task_occurrences"),
    db.prepare("DELETE FROM task_rules"),
    db.prepare("DELETE FROM managed_items"),
    db.prepare("DELETE FROM household_members"),
    db.prepare("DELETE FROM profiles"),
    db.prepare("DELETE FROM households"),
    db.prepare("DELETE FROM users"),
    db.prepare("INSERT INTO users (id, email) VALUES ('user-a','a@example.com'), ('user-a2','a2@example.com'), ('user-b','b@example.com')"),
    db.prepare("INSERT INTO households (id, name) VALUES ('household-a', 'Household A'), ('household-b', 'Household B')"),
    db.prepare("INSERT INTO household_members (household_id, user_id) VALUES ('household-a','user-a'), ('household-a','user-a2'), ('household-b','user-b')"),
    db.prepare("INSERT INTO managed_items (id, household_id, name, kind) VALUES ('item-a','household-a','Item A','other'), ('item-b','household-b','Item B','other')"),
  ]);
});

describe("繰り返しTodoの安全な編集(Issue #265)", () => {
  it("今回の担当・現在期限だけを変更し、本来の予定とルールは維持する", async () => {
    const ruleId = await createCalendarTask(db, memberA, {
      managedItemId: null,
      scheduleDayOfMonth: null,
      scheduleDayOfWeek: 1,
      scheduleKind: "weekly",
      scheduleMonth: null,
      scheduleMonthEnd: false,
      scheduleWeekOfMonth: null,
      title: "毎週の家族会議",
    });
    const occurrenceId = await occurrenceIdForRule(ruleId);
    const before = await readTodo(occurrenceId);

    await updateRecurringOccurrence(db, memberA, occurrenceId, {
      assigneeUserId: "user-a2",
      dueAt: "2026-09-20T15:00:00.000Z",
    });

    await expect(readTodo(occurrenceId)).resolves.toMatchObject({
      assignee_user_id: "user-a2",
      due_at: "2026-09-20T15:00:00.000Z",
      scheduled_for: before?.scheduled_for,
      title: "毎週の家族会議",
    });
    const logs = await db.prepare(
      "SELECT action FROM activity_logs WHERE task_occurrence_id = ?1",
    ).bind(occurrenceId).all<{ action: string }>();
    expect(logs.results.map((log) => log.action).sort()).toEqual([
      "assignee_changed",
      "postponed",
    ]);
  });

  it("定例ルールを変更しても現在回の予定は保ち、完了後の次回から新条件を使う", async () => {
    const ruleId = await createCalendarTask(db, memberA, {
      managedItemId: null,
      scheduleDayOfMonth: null,
      scheduleDayOfWeek: 1,
      scheduleKind: "weekly",
      scheduleMonth: null,
      scheduleMonthEnd: false,
      scheduleWeekOfMonth: null,
      title: "毎週の家族会議",
    });
    const occurrenceId = await occurrenceIdForRule(ruleId);
    const before = await readTodo(occurrenceId);

    await updateRecurringTaskRule(db, memberA, occurrenceId, {
      managedItemId: "item-a",
      recurrenceBasis: "calendar",
      scheduleDayOfMonth: 1,
      scheduleDayOfWeek: null,
      scheduleKind: "monthly_day",
      scheduleMonth: null,
      scheduleMonthEnd: false,
      scheduleWeekOfMonth: null,
      title: "月初の家族会議",
    });

    await expect(readTodo(occurrenceId)).resolves.toMatchObject({
      due_at: before?.due_at,
      managed_item_id: "item-a",
      scheduled_for: before?.scheduled_for,
      title: "月初の家族会議",
    });

    const nextId = await completeTask(db, memberA, {
      idempotencyKey: "complete-after-rule-edit",
      occurredAt: "2026-08-31T15:00:00.000Z",
      occurrenceId,
      performedByUserId: null,
    });
    expect(nextId).not.toBeNull();
    await expect(readTodo(nextId as string)).resolves.toMatchObject({
      due_at: "2026-09-30T15:00:00.000Z",
      managed_item_id: "item-a",
      scheduled_for: "2026-09-30T15:00:00.000Z",
      title: "月初の家族会議",
    });
  });

  it("過去の完了回は後からルールを変えても当時の名前・関連先・繰り返し条件を返す", async () => {
    const ruleId = await createCalendarTask(db, memberA, {
      managedItemId: "item-a",
      scheduleDayOfMonth: null,
      scheduleDayOfWeek: 1,
      scheduleKind: "weekly",
      scheduleMonth: null,
      scheduleMonthEnd: false,
      scheduleWeekOfMonth: null,
      title: "毎週の家族会議",
    });
    const completedId = await occurrenceIdForRule(ruleId);
    const nextId = await completeTask(db, memberA, {
      idempotencyKey: "complete-before-rule-edit",
      occurredAt: "2026-08-31T15:00:00.000Z",
      occurrenceId: completedId,
      performedByUserId: null,
    });

    await updateRecurringTaskRule(db, memberA, nextId as string, {
      managedItemId: null,
      recurrenceBasis: "calendar",
      scheduleDayOfMonth: 1,
      scheduleDayOfWeek: null,
      scheduleKind: "monthly_day",
      scheduleMonth: null,
      scheduleMonthEnd: false,
      scheduleWeekOfMonth: null,
      title: "月初の家族会議",
    });

    await expect(loadTodoDetail(db, memberA, completedId)).resolves.toMatchObject({
      managed_item_id: "item-a",
      managed_item_name: "Item A",
      recurrence_basis: "calendar",
      schedule_day_of_month: null,
      schedule_day_of_week: 1,
      schedule_kind: "weekly",
      title: "毎週の家族会議",
    });
    await expect(loadTodoDetail(db, memberA, nextId as string)).resolves.toMatchObject({
      managed_item_id: null,
      schedule_day_of_month: 1,
      schedule_day_of_week: null,
      schedule_kind: "monthly_day",
      title: "月初の家族会議",
    });
    await expect(listRecentActiveCompletions(db, memberA, 10)).resolves.toEqual([
      expect.objectContaining({
        managed_item_id: "item-a",
        managed_item_name: "Item A",
        task_occurrence_id: completedId,
        task_rule_title: "毎週の家族会議",
      }),
    ]);
    const oldItem = await loadManagedItemDetail(db, memberA, "item-a");
    expect(oldItem?.task_rules).toEqual([
      expect.objectContaining({
        id: ruleId,
        task_occurrences: [
          expect.objectContaining({ id: completedId, title_snapshot: "毎週の家族会議" }),
        ],
      }),
    ]);
  });

  it("不正な周期条件ではルール本体・現在回snapshot・変更履歴をまとめてロールバックする", async () => {
    const ruleId = await createCalendarTask(db, memberA, {
      managedItemId: null,
      scheduleDayOfMonth: null,
      scheduleDayOfWeek: 1,
      scheduleKind: "weekly",
      scheduleMonth: null,
      scheduleMonthEnd: false,
      scheduleWeekOfMonth: null,
      title: "毎週の家族会議",
    });
    const occurrenceId = await occurrenceIdForRule(ruleId);
    const beforeRule = await db.prepare(
      "SELECT title, schedule_day_of_week FROM task_rules WHERE id = ?1",
    ).bind(ruleId).first();
    const beforeOccurrence = await db.prepare(
      "SELECT rule_snapshot FROM task_occurrences WHERE id = ?1",
    ).bind(occurrenceId).first();

    await expect(updateRecurringTaskRule(db, memberA, occurrenceId, {
      managedItemId: null,
      recurrenceBasis: "calendar",
      scheduleDayOfMonth: null,
      scheduleDayOfWeek: 8,
      scheduleKind: "weekly",
      scheduleMonth: null,
      scheduleMonthEnd: false,
      scheduleWeekOfMonth: null,
      title: "壊れたルール",
    })).rejects.toThrow();

    await expect(db.prepare(
      "SELECT title, schedule_day_of_week FROM task_rules WHERE id = ?1",
    ).bind(ruleId).first()).resolves.toEqual(beforeRule);
    await expect(db.prepare(
      "SELECT rule_snapshot FROM task_occurrences WHERE id = ?1",
    ).bind(occurrenceId).first()).resolves.toEqual(beforeOccurrence);
    await expect(db.prepare(
      "SELECT count(*) AS count FROM task_rule_changes WHERE task_rule_id = ?1",
    ).bind(ruleId).first()).resolves.toMatchObject({ count: 0 });
  });

});

describe("繰り返しTodo編集の取消・方式・家庭境界(Issue #265)", () => {
  it("完了日基準の新しい目安は現在回を動かさず、完了後の次回へ反映する", async () => {
    const ruleId = await createMaintenanceTask(db, memberA, {
      firstDueAt: "2026-09-28T15:00:00.000Z",
      firstScheduledFor: "2026-09-14T15:00:00.000Z",
      managedItemId: null,
      recommendedStartOffset: 14,
      recommendedUntilOffset: 28,
      title: "フィルター交換",
    });
    const occurrenceId = await occurrenceIdForRule(ruleId);
    const before = await readTodo(occurrenceId);

    await updateRecurringTaskRule(db, memberA, occurrenceId, {
      managedItemId: null,
      recurrenceBasis: "completion",
      recommendedStartOffset: 7,
      recommendedStartValue: 1,
      recommendedUnit: "week",
      recommendedUntilOffset: 14,
      recommendedUntilValue: 2,
      title: "フィルターを交換",
    });
    await expect(readTodo(occurrenceId)).resolves.toMatchObject({
      due_at: before?.due_at,
      scheduled_for: before?.scheduled_for,
    });

    const nextId = await completeTask(db, memberA, {
      idempotencyKey: "complete-after-completion-rule-edit",
      occurredAt: "2026-08-31T15:00:00.000Z",
      occurrenceId,
      performedByUserId: null,
    });
    await expect(readTodo(nextId as string)).resolves.toMatchObject({
      due_at: "2026-09-14T15:00:00.000Z",
      scheduled_for: "2026-09-07T15:00:00.000Z",
      title: "フィルターを交換",
    });
  });

  it("次回のルールを編集した後は、元の完了取消と実施日訂正で変更を失わない", async () => {
    const ruleId = await createMaintenanceTask(db, memberA, {
      firstDueAt: "2026-10-27T15:00:00.000Z",
      firstScheduledFor: "2026-09-29T15:00:00.000Z",
      managedItemId: null,
      recommendedStartOffset: 28,
      recommendedUntilOffset: 56,
      title: "フィルター交換",
    });
    const completedId = await occurrenceIdForRule(ruleId);
    const nextId = await completeTask(db, memberA, {
      idempotencyKey: "complete-before-maintenance-edit",
      occurredAt: "2026-08-01T15:00:00.000Z",
      occurrenceId: completedId,
      performedByUserId: null,
    });

    await updateRecurringTaskRule(db, memberA, nextId as string, {
      managedItemId: null,
      recurrenceBasis: "completion",
      recommendedStartOffset: 14,
      recommendedStartValue: 2,
      recommendedUnit: "week",
      recommendedUntilOffset: 28,
      recommendedUntilValue: 4,
      title: "フィルターを交換",
    });

    await expect(
      undoTaskCompletion(db, memberA, completedId, "undo-after-rule-edit"),
    ).rejects.toThrow("Next occurrence has been modified");
    await expect(
      correctCompletionOccurredAt(
        db,
        memberA,
        completedId,
        "correct-after-rule-edit",
        "2026-07-31T15:00:00.000Z",
      ),
    ).rejects.toThrow("Next occurrence has been modified");
  });

  it("固定間隔の起点と間隔を変更できる", async () => {
    const ruleId = await createIntervalTask(db, memberA, {
      intervalAnchorOn: "2026-09-01",
      intervalCount: 2,
      intervalUnit: "week",
      managedItemId: null,
      title: "隔週の確認",
    });
    const occurrenceId = await occurrenceIdForRule(ruleId);

    await updateRecurringTaskRule(db, memberA, occurrenceId, {
      intervalAnchorOn: "2026-09-05",
      intervalCount: 10,
      intervalUnit: "day",
      managedItemId: null,
      recurrenceBasis: "interval",
      title: "10日ごとの確認",
    });

    await expect(db.prepare(
      `SELECT interval_anchor_on, interval_count, interval_unit
         FROM task_rules WHERE id = ?1`,
    ).bind(ruleId).first()).resolves.toMatchObject({
      interval_anchor_on: "2026-09-05",
      interval_count: 10,
      interval_unit: "day",
    });
  });

  it("他家庭のTodo・管理対象・担当者を現在回やルールへ指定できない", async () => {
    const ruleId = await createCalendarTask(db, memberA, {
      managedItemId: null,
      scheduleDayOfMonth: null,
      scheduleDayOfWeek: 1,
      scheduleKind: "weekly",
      scheduleMonth: null,
      scheduleMonthEnd: false,
      scheduleWeekOfMonth: null,
      title: "毎週の家族会議",
    });
    const occurrenceId = await occurrenceIdForRule(ruleId);

    await expect(updateRecurringOccurrence(db, memberA, occurrenceId, {
      assigneeUserId: "user-b",
      dueAt: "2026-09-20T15:00:00.000Z",
    })).rejects.toThrow("Assignee not found");
    await expect(updateRecurringTaskRule(db, memberA, occurrenceId, {
      managedItemId: "item-b",
      recurrenceBasis: "calendar",
      scheduleDayOfMonth: null,
      scheduleDayOfWeek: 2,
      scheduleKind: "weekly",
      scheduleMonth: null,
      scheduleMonthEnd: false,
      scheduleWeekOfMonth: null,
      title: "書き換え",
    })).rejects.toThrow("Managed item not found");
    await expect(updateRecurringTaskRule(db, memberB, occurrenceId, {
      managedItemId: null,
      recurrenceBasis: "calendar",
      scheduleDayOfMonth: null,
      scheduleDayOfWeek: 2,
      scheduleKind: "weekly",
      scheduleMonth: null,
      scheduleMonthEnd: false,
      scheduleWeekOfMonth: null,
      title: "書き換え",
    })).rejects.toThrow("Occurrence not found");
  });
});
