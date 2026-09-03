import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { listPendingOccurrences } from "./home";
import {
  claimTaskOccurrenceAssignee,
  completeTask,
  correctCompletionOccurredAt,
  correctCompletionPerformer,
  createCalendarTask,
  createMaintenanceTask,
  createOneTimeTask,
  postponeTaskOccurrence,
  setOneTimeTaskSchedule,
  setTaskOccurrenceAssignee,
  undoTaskCompletion,
} from "./todos";
import {
  createHouseholdAMaintenanceTask,
  householdAMember,
  householdBMember,
  occurrenceForRule,
  resetHouseholdFixtures,
} from "./test-support/households";
import { applyAllMigrations } from "./test-support/migrations";

// Todoの作成・完了・取消・延期・担当変更・実施記録の訂正における、原子性と
// 家庭間分離(IDOR耐性)。

const db = env.DB;

beforeAll(async () => {
  await applyAllMigrations(db);
});

beforeEach(async () => {
  await resetHouseholdFixtures(db);
});

describe("D1 undated one-time Todo constraints and authorization", () => {
  it("他家庭の管理対象へ日付未定Todoを作成できず、一覧にも混在しない", async () => {
    await expect(createOneTimeTask(db, householdAMember, {
      managedItemId: "item-b",
      scheduledFor: null,
      title: "Cross-household task",
    })).rejects.toThrow("Managed item not found");

    const bRuleId = await createOneTimeTask(db, householdBMember, {
      managedItemId: null,
      scheduledFor: null,
      title: "B undated task",
    });
    const bOccurrence = await occurrenceForRule(db, bRuleId);

    expect((await listPendingOccurrences(db, householdAMember)).map(({ id }) => id))
      .not.toContain(bOccurrence.id);
    expect((await listPendingOccurrences(db, householdBMember)).map(({ id }) => id))
      .toContain(bOccurrence.id);
  });

  it("日付未定の一回限りTodoを作成し、未定のまま完了して次回を作らない", async () => {
    const ruleId = await createOneTimeTask(db, householdAMember, {
      managedItemId: null,
      scheduledFor: null,
      title: "Undated one-time task",
    });
    const occurrence = await occurrenceForRule(db, ruleId);

    await expect(db.prepare(
      "SELECT scheduled_for, due_at, status FROM task_occurrences WHERE id = ?1",
    ).bind(occurrence.id).first()).resolves.toMatchObject({
      due_at: null,
      scheduled_for: null,
      status: "pending",
    });

    const nextId = await completeTask(db, householdAMember, {
      idempotencyKey: "complete-undated",
      occurredAt: "2026-08-05T00:00:00.000Z",
      occurrenceId: occurrence.id,
      performedByUserId: null,
    });

    expect(nextId).toBeNull();
    await expect(db.prepare(
      "SELECT count(*) AS count FROM task_occurrences WHERE task_rule_id = ?1",
    ).bind(ruleId).first<{ count: number }>()).resolves.toMatchObject({ count: 1 });
    await expect(db.prepare(
      "SELECT action FROM activity_logs WHERE task_occurrence_id = ?1",
    ).bind(occurrence.id).first()).resolves.toMatchObject({ action: "completed" });
  });

  it("片方だけがNULLのOccurrenceと、繰り返しTodoの日付NULLを拒否する", async () => {
    await db.prepare(
      "INSERT INTO task_rules (id, household_id, title, recurrence_basis, deadline_kind) VALUES ('once-null-rule', 'household-a', 'Once', 'once', 'strict')",
    ).run();
    await expect(db.prepare(
      "INSERT INTO task_occurrences (id, household_id, task_rule_id, scheduled_for, due_at) VALUES ('half-null', 'household-a', 'once-null-rule', NULL, '2026-09-01T00:00:00.000Z')",
    ).run()).rejects.toThrow();

    await db.prepare(
      "INSERT INTO task_rules (id, household_id, title, recurrence_basis, deadline_kind, recommended_start_offset, recommended_until_offset) VALUES ('repeat-null-rule', 'household-a', 'Repeat', 'completion', 'maintenance', 1, 2)",
    ).run();
    await expect(db.prepare(
      "INSERT INTO task_occurrences (id, household_id, task_rule_id, scheduled_for, due_at) VALUES ('repeat-null', 'household-a', 'repeat-null-rule', NULL, NULL)",
    ).run()).rejects.toThrow();
  });

  it("一回限りTodoの予定日を設定・未定化し、他家庭からの変更を拒否する", async () => {
    const ruleId = await createOneTimeTask(db, householdAMember, {
      managedItemId: null,
      scheduledFor: null,
      title: "Undated one-time task",
    });
    const occurrence = await occurrenceForRule(db, ruleId);
    await setOneTimeTaskSchedule(
      db, householdAMember, occurrence.id, "2026-09-01T15:00:00.000Z",
    );
    await expect(db.prepare(
      "SELECT scheduled_for, due_at FROM task_occurrences WHERE id = ?1",
    ).bind(occurrence.id).first()).resolves.toMatchObject({
      due_at: "2026-09-01T15:00:00.000Z",
      scheduled_for: "2026-09-01T15:00:00.000Z",
    });

    await expect(setOneTimeTaskSchedule(
      db, householdBMember, occurrence.id, null,
    )).rejects.toThrow("Occurrence not found");
    await setOneTimeTaskSchedule(db, householdAMember, occurrence.id, null);
    await expect(db.prepare(
      "SELECT scheduled_for, due_at FROM task_occurrences WHERE id = ?1",
    ).bind(occurrence.id).first()).resolves.toMatchObject({
      due_at: null,
      scheduled_for: null,
    });
  });
});

describe("D1 Todo atomicity and IDOR resistance", () => {
  it("creates unlinked one-time and calendar tasks in the session household", async () => {
    await createOneTimeTask(db, householdAMember, {
      managedItemId: null,
      scheduledFor: "2026-09-01T15:00:00.000Z",
      title: "A one-time task",
    });
    await createCalendarTask(db, householdBMember, {
      managedItemId: null,
      scheduleDayOfMonth: null,
      scheduleDaysOfWeek: [1],
      scheduleKind: "weekly",
      scheduleMonth: null,
      scheduleMonthEnd: false,
      scheduleWeekOfMonth: null,
      title: "B calendar task",
    }, new Date("2026-08-20T00:00:00.000Z"));
    const rows = await db.prepare(
      "SELECT household_id, title FROM task_rules ORDER BY household_id",
    ).all<{ household_id: string; title: string }>();
    expect(rows.results).toEqual([
      { household_id: "household-a", title: "A one-time task" },
      { household_id: "household-b", title: "B calendar task" },
    ]);
  });

  it("completion atomically records the log and next occurrence, then undo restores it", async () => {
    const { occurrenceId, ruleId } = await createHouseholdAMaintenanceTask(db);
    const nextId = await completeTask(db, householdAMember, {
      idempotencyKey: "complete-success",
      occurredAt: "2026-08-05T00:00:00.000Z",
      occurrenceId,
      performedByUserId: null,
    });
    expect(nextId).not.toBeNull();
    await expect(db.prepare(
      "SELECT status FROM task_occurrences WHERE id = ?1 AND household_id = 'household-a'",
    ).bind(occurrenceId).first()).resolves.toMatchObject({ status: "completed" });
    await expect(db.prepare(
      "SELECT status FROM task_occurrences WHERE id = ?1 AND task_rule_id = ?2",
    ).bind(nextId, ruleId).first()).resolves.toMatchObject({ status: "pending" });

    await undoTaskCompletion(db, householdAMember, occurrenceId, "undo-success");
    await expect(db.prepare(
      "SELECT status FROM task_occurrences WHERE id = ?1",
    ).bind(occurrenceId).first()).resolves.toMatchObject({ status: "pending" });
    await expect(db.prepare(
      "SELECT id FROM task_occurrences WHERE id = ?1",
    ).bind(nextId).first()).resolves.toBeNull();
  });

  it("a next-occurrence constraint failure rolls back completion and its log", async () => {
    const { occurrenceId, ruleId } = await createHouseholdAMaintenanceTask(db);
    await db.prepare(
      `INSERT INTO task_occurrences (
        id, household_id, task_rule_id, scheduled_for, due_at, status
      ) VALUES ('collision', 'household-a', ?1, '2026-08-05T15:00:00.000Z', '2026-08-06T15:00:00.000Z', 'skipped')`,
    ).bind(ruleId).run();

    await expect(completeTask(db, householdAMember, {
      idempotencyKey: "complete-collision",
      occurredAt: "2026-08-05T00:00:00.000Z",
      occurrenceId,
      performedByUserId: null,
    })).rejects.toThrow("already exists for the computed schedule");
    await expect(db.prepare(
      "SELECT status FROM task_occurrences WHERE id = ?1",
    ).bind(occurrenceId).first()).resolves.toMatchObject({ status: "pending" });
    await expect(db.prepare(
      "SELECT count(*) AS count FROM activity_logs WHERE idempotency_key = 'complete-collision'",
    ).first<{ count: number }>()).resolves.toMatchObject({ count: 0 });
  });

  it("modified next occurrence makes undo fail without partial deletion", async () => {
    const { occurrenceId } = await createHouseholdAMaintenanceTask(db);
    const nextId = await completeTask(db, householdAMember, {
      idempotencyKey: "complete-before-modified-undo",
      occurredAt: "2026-08-05T00:00:00.000Z",
      occurrenceId,
      performedByUserId: null,
    });
    if (nextId === null) throw new Error("Expected a next occurrence");
    await setTaskOccurrenceAssignee(db, householdAMember, nextId, "user-a");

    await expect(undoTaskCompletion(
      db, householdAMember, occurrenceId, "undo-modified",
    )).rejects.toThrow("Next occurrence has been modified");
    await expect(db.prepare(
      "SELECT status FROM task_occurrences WHERE id = ?1",
    ).bind(occurrenceId).first()).resolves.toMatchObject({ status: "completed" });
    await expect(db.prepare(
      "SELECT status FROM task_occurrences WHERE id = ?1",
    ).bind(nextId).first()).resolves.toMatchObject({ status: "pending" });
  });

  it("担当変更と延期の前後値を追記型履歴へ保持する", async () => {
    const { occurrenceId } = await createHouseholdAMaintenanceTask(db);
    await setTaskOccurrenceAssignee(db, householdAMember, occurrenceId, "user-a");
    await postponeTaskOccurrence(
      db,
      householdAMember,
      occurrenceId,
      "2027-01-01T00:00:00.000Z",
    );

    await expect(db.prepare(
      `SELECT assignee_user_id, previous_assignee_user_id, new_assignee_user_id
         FROM activity_logs WHERE task_occurrence_id = ?1 AND action = 'assignee_changed'`,
    ).bind(occurrenceId).first()).resolves.toMatchObject({
      assignee_user_id: "user-a",
      new_assignee_user_id: "user-a",
      previous_assignee_user_id: null,
    });
    await expect(db.prepare(
      `SELECT previous_due_at, new_due_at
         FROM activity_logs WHERE task_occurrence_id = ?1 AND action = 'postponed'`,
    ).bind(occurrenceId).first()).resolves.toMatchObject({
      new_due_at: "2027-01-01T00:00:00.000Z",
      previous_due_at: "2026-08-10T15:00:00.000Z",
    });
  });

  it("「やるよ」は未担当のOccurrenceを操作主体自身の担当にし、追記型履歴を残す(Issue #77)", async () => {
    const { occurrenceId } = await createHouseholdAMaintenanceTask(db);

    await claimTaskOccurrenceAssignee(db, householdAMember, occurrenceId);

    await expect(db.prepare(
      "SELECT assignee_user_id FROM task_occurrences WHERE id = ?1",
    ).bind(occurrenceId).first()).resolves.toMatchObject({ assignee_user_id: "user-a" });
    await expect(db.prepare(
      `SELECT actor_user_id, assignee_user_id, previous_assignee_user_id, new_assignee_user_id
         FROM activity_logs WHERE task_occurrence_id = ?1 AND action = 'assignee_changed'`,
    ).bind(occurrenceId).first()).resolves.toMatchObject({
      actor_user_id: "user-a",
      assignee_user_id: "user-a",
      new_assignee_user_id: "user-a",
      previous_assignee_user_id: null,
    });
  });

  it("既に担当者がいれば「やるよ」は黙って上書きせず、後着だけ失敗する(同時操作の安全性、Issue #77)", async () => {
    await db.batch([
      db.prepare("INSERT INTO users (id, email) VALUES ('user-a2','a2@example.com')"),
      db.prepare("INSERT INTO household_members (household_id, user_id) VALUES ('household-a','user-a2')"),
    ]);
    const { occurrenceId } = await createHouseholdAMaintenanceTask(db);
    const secondMember = { email: "a2@example.com", userId: "user-a2" };

    await claimTaskOccurrenceAssignee(db, householdAMember, occurrenceId);
    await expect(claimTaskOccurrenceAssignee(db, secondMember, occurrenceId))
      .rejects.toThrow("Occurrence already has an assignee");

    await expect(db.prepare(
      "SELECT assignee_user_id FROM task_occurrences WHERE id = ?1",
    ).bind(occurrenceId).first()).resolves.toMatchObject({ assignee_user_id: "user-a" });
    await expect(db.prepare(
      "SELECT count(*) AS count FROM activity_logs WHERE task_occurrence_id = ?1 AND action = 'assignee_changed'",
    ).bind(occurrenceId).first<{ count: number }>()).resolves.toMatchObject({ count: 1 });
  });

  it("A session cannot complete, assign, or postpone a B occurrence by ID", async () => {
    const bRuleId = await createMaintenanceTask(db, householdBMember, {
      firstDueAt: "2026-09-10T15:00:00.000Z",
      firstScheduledFor: "2026-09-01T15:00:00.000Z",
      managedItemId: "item-b",
      recommendedStartOffset: 1,
      recommendedUntilOffset: 2,
      title: "B maintenance",
    });
    const bOccurrence = await occurrenceForRule(db, bRuleId);
    await expect(completeTask(db, householdAMember, {
      idempotencyKey: "idor-complete",
      occurredAt: "2026-08-05T00:00:00.000Z",
      occurrenceId: bOccurrence.id,
      performedByUserId: null,
    })).rejects.toThrow("Occurrence not found");
    await expect(setTaskOccurrenceAssignee(
      db, householdAMember, bOccurrence.id, "user-a",
    )).rejects.toThrow("Occurrence not found");
    await expect(claimTaskOccurrenceAssignee(
      db, householdAMember, bOccurrence.id,
    )).rejects.toThrow("Occurrence not found");
    await expect(postponeTaskOccurrence(
      db, householdAMember, bOccurrence.id, "2027-01-01T00:00:00.000Z",
    )).rejects.toThrow("Occurrence not found");
    await expect(correctCompletionOccurredAt(
      db, householdAMember, bOccurrence.id, "idor-correct-occurred-at", "2026-08-05T00:00:00.000Z",
    )).rejects.toThrow("Occurrence not found");
    await expect(correctCompletionPerformer(
      db, householdAMember, bOccurrence.id, "idor-correct-performer", "user-a",
    )).rejects.toThrow("Occurrence not found");
    await expect(db.prepare(
      "SELECT status, assignee_user_id FROM task_occurrences WHERE id = ?1",
    ).bind(bOccurrence.id).first()).resolves.toMatchObject({
      assignee_user_id: null,
      status: "pending",
    });
  });
});

describe("D1 completion correction atomicity and household isolation (Issue #148)", () => {
  it("実施日時の訂正は未変更の次回Occurrenceを原子的に再計算し、追記型で履歴を残す(Issue #148)", async () => {
    const { occurrenceId } = await createHouseholdAMaintenanceTask(db);
    const nextId = await completeTask(db, householdAMember, {
      idempotencyKey: "correct-recalc-complete",
      occurredAt: "2026-08-05T00:00:00.000Z",
      occurrenceId,
      performedByUserId: null,
    });
    if (nextId === null) throw new Error("Expected a next occurrence");
    const before = await db.prepare(
      "SELECT scheduled_for, due_at FROM task_occurrences WHERE id = ?1",
    ).bind(nextId).first<{ due_at: string; scheduled_for: string }>();

    await correctCompletionOccurredAt(
      db, householdAMember, occurrenceId, "correct-recalc", "2026-08-09T00:00:00.000Z",
    );

    const after = await db.prepare(
      "SELECT scheduled_for, due_at FROM task_occurrences WHERE id = ?1",
    ).bind(nextId).first<{ due_at: string; scheduled_for: string }>();
    expect(after?.scheduled_for).not.toBe(before?.scheduled_for);
    expect(after?.due_at).not.toBe(before?.due_at);
    await expect(db.prepare(
      `SELECT previous_occurred_at, new_occurred_at, new_performed_by_user_id
         FROM completion_corrections WHERE task_occurrence_id = ?1`,
    ).bind(occurrenceId).first()).resolves.toMatchObject({
      new_occurred_at: "2026-08-09T00:00:00.000Z",
      new_performed_by_user_id: null,
      previous_occurred_at: "2026-08-05T00:00:00.000Z",
    });
    // 元のcompletedログ自体は書き換えない。
    await expect(db.prepare(
      "SELECT occurred_at FROM activity_logs WHERE task_occurrence_id = ?1 AND action = 'completed'",
    ).bind(occurrenceId).first()).resolves.toMatchObject({
      occurred_at: "2026-08-05T00:00:00.000Z",
    });
  });

  it("次回Occurrenceが変更済みなら実施日時の訂正を拒否し、データを変更しない", async () => {
    const { occurrenceId } = await createHouseholdAMaintenanceTask(db);
    const nextId = await completeTask(db, householdAMember, {
      idempotencyKey: "correct-modified-complete",
      occurredAt: "2026-08-05T00:00:00.000Z",
      occurrenceId,
      performedByUserId: null,
    });
    if (nextId === null) throw new Error("Expected a next occurrence");
    await setTaskOccurrenceAssignee(db, householdAMember, nextId, "user-a");

    await expect(correctCompletionOccurredAt(
      db, householdAMember, occurrenceId, "correct-modified", "2026-08-09T00:00:00.000Z",
    )).rejects.toThrow("Next occurrence has been modified");

    await expect(db.prepare(
      "SELECT count(*) AS count FROM completion_corrections WHERE task_occurrence_id = ?1",
    ).bind(occurrenceId).first<{ count: number }>()).resolves.toMatchObject({ count: 0 });
    await expect(db.prepare(
      "SELECT occurred_at FROM activity_logs WHERE task_occurrence_id = ?1 AND action = 'completed'",
    ).bind(occurrenceId).first()).resolves.toMatchObject({
      occurred_at: "2026-08-05T00:00:00.000Z",
    });
  });

  it("実施者の訂正は同じ家庭のメンバーだけを許可し、元のcompletedログを書き換えない", async () => {
    await db.batch([
      db.prepare("INSERT INTO users (id, email) VALUES ('user-a2','a2@example.com')"),
      db.prepare("INSERT INTO household_members (household_id, user_id) VALUES ('household-a','user-a2')"),
    ]);
    const { occurrenceId } = await createHouseholdAMaintenanceTask(db);
    await completeTask(db, householdAMember, {
      idempotencyKey: "correct-performer-complete",
      occurredAt: "2026-08-05T00:00:00.000Z",
      occurrenceId,
      performedByUserId: null,
    });

    await expect(correctCompletionPerformer(
      db, householdAMember, occurrenceId, "correct-performer-outsider", "user-b",
    )).rejects.toThrow("Performer not found");

    await correctCompletionPerformer(db, householdAMember, occurrenceId, "correct-performer", "user-a2");

    await expect(db.prepare(
      "SELECT performed_by_user_id FROM activity_logs WHERE task_occurrence_id = ?1 AND action = 'completed'",
    ).bind(occurrenceId).first()).resolves.toMatchObject({ performed_by_user_id: "user-a" });
    await expect(db.prepare(
      `SELECT previous_performed_by_user_id, new_performed_by_user_id
         FROM completion_corrections WHERE task_occurrence_id = ?1`,
    ).bind(occurrenceId).first()).resolves.toMatchObject({
      new_performed_by_user_id: "user-a2",
      previous_performed_by_user_id: "user-a",
    });
  });

  it("同じidempotency_keyの再送は訂正を重複させず、別Occurrenceへの使い回しは拒否する", async () => {
    const first = await createHouseholdAMaintenanceTask(db);
    await completeTask(db, householdAMember, {
      idempotencyKey: "correct-idem-complete-1",
      occurredAt: "2026-08-05T00:00:00.000Z",
      occurrenceId: first.occurrenceId,
      performedByUserId: null,
    });

    await correctCompletionOccurredAt(
      db, householdAMember, first.occurrenceId, "correct-idem", "2026-08-06T00:00:00.000Z",
    );
    await correctCompletionOccurredAt(
      db, householdAMember, first.occurrenceId, "correct-idem", "2026-08-06T00:00:00.000Z",
    );
    await expect(db.prepare(
      "SELECT count(*) AS count FROM completion_corrections WHERE idempotency_key = 'correct-idem'",
    ).first<{ count: number }>()).resolves.toMatchObject({ count: 1 });

    const second = await createHouseholdAMaintenanceTask(db);
    await completeTask(db, householdAMember, {
      idempotencyKey: "correct-idem-complete-2",
      occurredAt: "2026-08-05T00:00:00.000Z",
      occurrenceId: second.occurrenceId,
      performedByUserId: null,
    });
    await expect(correctCompletionOccurredAt(
      db, householdAMember, second.occurrenceId, "correct-idem", "2026-08-06T00:00:00.000Z",
    )).rejects.toThrow("Idempotency key was already used for a different occurrence");
  });
});
