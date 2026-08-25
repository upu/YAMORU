import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import schemaSql from "../../../d1/migrations/0001_init.sql?raw";
import authSchemaSql from "../../../d1/migrations/0002_auth_invitation_claims.sql?raw";
import migrationAuditSql from "../../../d1/migrations/0003_preserve_supabase_audit_fields.sql?raw";
import completionCorrectionsSql from "../../../d1/migrations/0004_completion_corrections.sql?raw";
import classificationSql from "../../../d1/migrations/0005_managed_item_classification.sql?raw";
import propertyTaxSql from "../../../d1/migrations/0006_property_tax_item_type.sql?raw";
import kindLabelsSql from "../../../d1/migrations/0007_managed_item_kind_labels.sql?raw";
import optionalAttributesSql from "../../../d1/migrations/0008_managed_item_optional_attributes.sql?raw";
import undatedTodosSql from "../../../d1/migrations/0009_undated_one_time_todos.sql?raw";
import {
  completeTask,
  correctCompletionOccurredAt,
  correctCompletionPerformer,
  createCalendarTask,
  createOneTimeTask,
  loadTodoDetail,
  postponeTaskOccurrence,
  undoTaskCompletion,
  updateOneTimeTodo,
} from "./todos";

const db = env.DB;
const memberA = { email: "a@example.com", userId: "user-a" };
const memberB = { email: "b@example.com", userId: "user-b" };

function migrationStatements(): string[] {
  return [
    schemaSql,
    authSchemaSql,
    migrationAuditSql,
    completionCorrectionsSql,
    classificationSql,
    propertyTaxSql,
    kindLabelsSql,
    optionalAttributesSql,
  ].join("\n")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function triggerAwareStatements(sql) {
  const cleaned = sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  const triggers = [...cleaned.matchAll(/CREATE TRIGGER[\s\S]*?END;/g)]
    .map(([statement]) => statement.trim());
  const regular = cleaned
    .replaceAll(/CREATE TRIGGER[\s\S]*?END;/g, "")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
  return [...regular, ...triggers];
}

async function occurrenceIdForRule(ruleId) {
  const row = await db.prepare(
    "SELECT id FROM task_occurrences WHERE task_rule_id = ?1 ORDER BY created_at LIMIT 1",
  ).bind(ruleId).first();
  if (row === null) throw new Error("Test occurrence not found");
  return row.id;
}

async function createHouseholdATodo(overrides = {}) {
  const ruleId = await createOneTimeTask(db, memberA, {
    managedItemId: null,
    scheduledFor: "2026-09-01T15:00:00.000Z",
    title: "申請する",
    ...overrides,
  });
  return { occurrenceId: await occurrenceIdForRule(ruleId), ruleId };
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
  await db.batch(migrationStatements().map((statement) => db.prepare(statement)));
  await db.batch(triggerAwareStatements(undatedTodosSql).map((statement) => db.prepare(statement)));
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

describe("繰り返しなしTodoの編集(updateOneTimeTodo)", () => {
  it("名前・関連ManagedItem・担当・予定日をまとめて更新する", async () => {
    const { occurrenceId } = await createHouseholdATodo();

    await expect(updateOneTimeTodo(db, memberA, occurrenceId, {
      assigneeUserId: "user-a2",
      managedItemId: "item-a",
      scheduledFor: "2026-10-01T15:00:00.000Z",
      title: "申請書を出す",
    })).resolves.toEqual({ previousManagedItemId: null });

    await expect(readTodo(occurrenceId)).resolves.toMatchObject({
      assignee_user_id: "user-a2",
      due_at: "2026-10-01T15:00:00.000Z",
      managed_item_id: "item-a",
      scheduled_for: "2026-10-01T15:00:00.000Z",
      title: "申請書を出す",
    });
  });

  it("具体日と予定日未定を往復できる", async () => {
    const { occurrenceId } = await createHouseholdATodo();

    await updateOneTimeTodo(db, memberA, occurrenceId, {
      assigneeUserId: null,
      managedItemId: null,
      scheduledFor: null,
      title: "申請する",
    });
    await expect(readTodo(occurrenceId)).resolves.toMatchObject({
      due_at: null,
      scheduled_for: null,
    });

    await updateOneTimeTodo(db, memberA, occurrenceId, {
      assigneeUserId: null,
      managedItemId: null,
      scheduledFor: "2026-11-01T15:00:00.000Z",
      title: "申請する",
    });
    await expect(readTodo(occurrenceId)).resolves.toMatchObject({
      due_at: "2026-11-01T15:00:00.000Z",
      scheduled_for: "2026-11-01T15:00:00.000Z",
    });
  });

  it("予定日を変えない編集では、延期した期限を巻き戻さない", async () => {
    const { occurrenceId } = await createHouseholdATodo();
    await postponeTaskOccurrence(db, memberA, occurrenceId, "2026-09-20T15:00:00.000Z");

    await updateOneTimeTodo(db, memberA, occurrenceId, {
      assigneeUserId: null,
      managedItemId: null,
      scheduledFor: "2026-09-01T15:00:00.000Z",
      title: "名前だけ変える",
    });

    await expect(readTodo(occurrenceId)).resolves.toMatchObject({
      due_at: "2026-09-20T15:00:00.000Z",
      scheduled_for: "2026-09-01T15:00:00.000Z",
      title: "名前だけ変える",
    });
  });

  it("担当を変えたときだけassignee_changedを履歴へ残す", async () => {
    const { occurrenceId } = await createHouseholdATodo();

    await updateOneTimeTodo(db, memberA, occurrenceId, {
      assigneeUserId: null,
      managedItemId: null,
      scheduledFor: "2026-09-01T15:00:00.000Z",
      title: "名前だけ変える",
    });
    await expect(db.prepare(
      "SELECT count(*) AS total FROM activity_logs WHERE task_occurrence_id = ?1",
    ).bind(occurrenceId).first()).resolves.toMatchObject({ total: 0 });

    await updateOneTimeTodo(db, memberA, occurrenceId, {
      assigneeUserId: "user-a2",
      managedItemId: null,
      scheduledFor: "2026-09-01T15:00:00.000Z",
      title: "名前だけ変える",
    });
    await expect(db.prepare(
      `SELECT action, previous_assignee_user_id, new_assignee_user_id
         FROM activity_logs WHERE task_occurrence_id = ?1`,
    ).bind(occurrenceId).first()).resolves.toMatchObject({
      action: "assignee_changed",
      new_assignee_user_id: "user-a2",
      previous_assignee_user_id: null,
    });
  });
});

describe("Todo編集の家庭間分離と原子性", () => {
  it("家庭BのTodoは家庭Aのセッションから編集できない", async () => {
    const ruleId = await createOneTimeTask(db, memberB, {
      managedItemId: null,
      scheduledFor: "2026-09-01T15:00:00.000Z",
      title: "B household todo",
    });
    const occurrenceId = await occurrenceIdForRule(ruleId);

    await expect(updateOneTimeTodo(db, memberA, occurrenceId, {
      assigneeUserId: null,
      managedItemId: null,
      scheduledFor: null,
      title: "Hacked",
    })).rejects.toThrow("Occurrence not found");
    await expect(readTodo(occurrenceId)).resolves.toMatchObject({
      scheduled_for: "2026-09-01T15:00:00.000Z",
      title: "B household todo",
    });
    await expect(loadTodoDetail(db, memberA, occurrenceId)).resolves.toBeNull();
  });

  it("家庭BのManagedItemを指定した編集は、名前も予定日も変えずに失敗する", async () => {
    const { occurrenceId } = await createHouseholdATodo();

    await expect(updateOneTimeTodo(db, memberA, occurrenceId, {
      assigneeUserId: null,
      managedItemId: "item-b",
      scheduledFor: "2026-12-01T15:00:00.000Z",
      title: "書き換えた名前",
    })).rejects.toThrow("Managed item not found");

    await expect(readTodo(occurrenceId)).resolves.toMatchObject({
      managed_item_id: null,
      scheduled_for: "2026-09-01T15:00:00.000Z",
      title: "申請する",
    });
  });

  it("家庭Bのメンバーを担当に指定した編集は、名前も予定日も変えずに失敗する", async () => {
    const { occurrenceId } = await createHouseholdATodo();

    await expect(updateOneTimeTodo(db, memberA, occurrenceId, {
      assigneeUserId: "user-b",
      managedItemId: "item-a",
      scheduledFor: "2026-12-01T15:00:00.000Z",
      title: "書き換えた名前",
    })).rejects.toThrow("Assignee not found");

    await expect(readTodo(occurrenceId)).resolves.toMatchObject({
      assignee_user_id: null,
      managed_item_id: null,
      scheduled_for: "2026-09-01T15:00:00.000Z",
      title: "申請する",
    });
  });

  it("繰り返しTodoの内容は編集できず、名前も変わらない", async () => {
    const ruleId = await createCalendarTask(db, memberA, {
      managedItemId: null,
      scheduleDayOfMonth: null,
      scheduleDayOfWeek: 1,
      scheduleKind: "weekly",
      scheduleMonth: null,
      scheduleWeekOfMonth: null,
      title: "毎週の家族会議",
    });
    const occurrenceId = await occurrenceIdForRule(ruleId);

    await expect(updateOneTimeTodo(db, memberA, occurrenceId, {
      assigneeUserId: null,
      managedItemId: null,
      scheduledFor: null,
      title: "書き換えた名前",
    })).rejects.toThrow("Only one-time tasks can be edited");
    await expect(readTodo(occurrenceId)).resolves.toMatchObject({
      title: "毎週の家族会議",
    });
  });

  it("完了済みTodoは編集できない", async () => {
    const { occurrenceId } = await createHouseholdATodo();
    await completeTask(db, memberA, {
      idempotencyKey: "complete-once",
      occurredAt: null,
      occurrenceId,
      performedByUserId: null,
    });

    await expect(updateOneTimeTodo(db, memberA, occurrenceId, {
      assigneeUserId: null,
      managedItemId: "item-a",
      scheduledFor: null,
      title: "書き換えた名前",
    })).rejects.toThrow("Occurrence is not pending");
    await expect(readTodo(occurrenceId)).resolves.toMatchObject({
      managed_item_id: null,
      status: "completed",
      title: "申請する",
    });
  });
});

describe("Todo詳細の取得(loadTodoDetail)", () => {
  it("現在の家庭のpending Todoを、関連ManagedItemとともに返す", async () => {
    const { occurrenceId } = await createHouseholdATodo({ managedItemId: "item-a" });

    await expect(loadTodoDetail(db, memberA, occurrenceId)).resolves.toMatchObject({
      assignee_user_id: null,
      completed_activity_log_id: null,
      deadline_kind: "strict",
      due_at: "2026-09-01T15:00:00.000Z",
      id: occurrenceId,
      managed_item_id: "item-a",
      managed_item_name: "Item A",
      occurred_at: null,
      performed_by_user_id: null,
      recurrence_basis: "once",
      scheduled_for: "2026-09-01T15:00:00.000Z",
      status: "pending",
      title: "申請する",
    });
    await expect(loadTodoDetail(db, memberB, occurrenceId)).resolves.toBeNull();
  });

  it("完了したTodoを実施日時・実施者つきで返す(Issue #205)", async () => {
    const { occurrenceId } = await createHouseholdATodo();
    await completeTask(db, memberA, {
      idempotencyKey: "complete-detail",
      occurredAt: "2026-08-20T15:00:00.000Z",
      occurrenceId,
      performedByUserId: "user-a2",
    });

    await expect(loadTodoDetail(db, memberA, occurrenceId)).resolves.toMatchObject({
      occurred_at: "2026-08-20T15:00:00.000Z",
      performed_by_user_id: "user-a2",
      status: "completed",
    });
    await expect(loadTodoDetail(db, memberB, occurrenceId)).resolves.toBeNull();
  });

  it("訂正済みの完了は、訂正後の実施日時・実施者を返す(YDR-026)", async () => {
    const { occurrenceId } = await createHouseholdATodo();
    await completeTask(db, memberA, {
      idempotencyKey: "complete-corrected",
      occurredAt: "2026-08-20T15:00:00.000Z",
      occurrenceId,
      performedByUserId: "user-a2",
    });
    await correctCompletionOccurredAt(
      db, memberA, occurrenceId, "correct-date", "2026-08-18T15:00:00.000Z",
    );
    await correctCompletionPerformer(db, memberA, occurrenceId, "correct-performer", "user-a");

    await expect(loadTodoDetail(db, memberA, occurrenceId)).resolves.toMatchObject({
      occurred_at: "2026-08-18T15:00:00.000Z",
      performed_by_user_id: "user-a",
      status: "completed",
    });
  });

  it("完了取消の後は未完了として返す", async () => {
    const { occurrenceId } = await createHouseholdATodo();
    await completeTask(db, memberA, {
      idempotencyKey: "complete-undo-detail",
      occurredAt: null,
      occurrenceId,
      performedByUserId: null,
    });
    await undoTaskCompletion(db, memberA, occurrenceId, "undo-detail");

    await expect(loadTodoDetail(db, memberA, occurrenceId)).resolves.toMatchObject({
      status: "pending",
    });
  });
});
