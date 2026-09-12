// Issue #325 / YDR-046: 「必要になったら繰り返す」Todoを、登録・完了・完了取消・
// 編集・家庭間分離の観点で確かめる。登録時に予定日未定のOccurrenceを1件だけ持ち、
// 完了すると次の予定日未定Occurrenceが1件だけ生まれ、日付は最後まで持たない。
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyAllMigrations } from "./test-support/migrations";
import {
  completeTask,
  correctCompletionOccurredAt,
  createManualTask,
  postponeTaskOccurrence,
  setOneTimeTaskSchedule,
  setTaskOccurrenceAssignee,
  undoTaskCompletion,
  updateOneTimeTodo,
} from "./todos";

const db = env.DB;
const memberA = { email: "a@example.com", userId: "user-a" };
const memberB = { email: "b@example.com", userId: "user-b" };

function requireOccurrenceId(occurrenceId: string | null): string {
  if (occurrenceId === null) throw new Error("Expected a next occurrence to be generated");
  return occurrenceId;
}

async function pendingOccurrenceId(ruleId: string): Promise<string> {
  const row = await db.prepare(
    "SELECT id FROM task_occurrences WHERE task_rule_id = ?1 AND status = 'pending'",
  ).bind(ruleId).first<{ id: string }>();
  if (row === null) throw new Error("Pending occurrence not found");
  return row.id;
}

async function occurrenceCounts(ruleId: string): Promise<{ pending: number; total: number }> {
  const row = await db.prepare(
    `SELECT count(*) AS total,
            sum(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending
       FROM task_occurrences WHERE task_rule_id = ?1`,
  ).bind(ruleId).first<{ pending: number; total: number }>();
  return { pending: row?.pending ?? -1, total: row?.total ?? -1 };
}

async function resetFixtures(): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM task_rule_changes"),
    db.prepare("DELETE FROM task_rule_consumables"),
    db.prepare("DELETE FROM completion_corrections"),
    db.prepare("DELETE FROM activity_logs"),
    db.prepare("DELETE FROM task_occurrences"),
    db.prepare("DELETE FROM task_rules"),
    db.prepare("DELETE FROM managed_items"),
    db.prepare("DELETE FROM household_members"),
    db.prepare("DELETE FROM households"),
    db.prepare("DELETE FROM users"),
    db.prepare("INSERT INTO users (id, email) VALUES ('user-a', 'a@example.com'), ('user-b', 'b@example.com')"),
    db.prepare("INSERT INTO households (id, name) VALUES ('household-a', 'Household A'), ('household-b', 'Household B')"),
    db.prepare("INSERT INTO household_members (household_id, user_id) VALUES ('household-a', 'user-a'), ('household-b', 'user-b')"),
    db.prepare("INSERT INTO managed_items (id, household_id, name, kind) VALUES ('item-a', 'household-a', 'Coffee machine', 'other'), ('item-b', 'household-b', 'Item B', 'other')"),
  ]);
}

beforeAll(async () => {
  await applyAllMigrations(db);
});

beforeEach(async () => {
  await resetFixtures();
});

function createDescaleTask(managedItemId: string | null = "item-a") {
  return createManualTask(db, memberA, { managedItemId, title: "コーヒーマシーンの石灰除去" });
}

describe("必要になったら繰り返すTodoの登録(createManualTask)", () => {
  it("方式と期限の種類を保存し、予定日未定のOccurrenceを1件だけ作る", async () => {
    const ruleId = await createDescaleTask();

    await expect(db.prepare(
      `SELECT recurrence_basis, deadline_kind, recommended_start_offset,
              recommended_until_offset, recommended_unit, schedule_kind, interval_unit
         FROM task_rules WHERE id = ?1`,
    ).bind(ruleId).first()).resolves.toEqual({
      deadline_kind: "strict",
      interval_unit: null,
      recommended_start_offset: 0,
      recommended_unit: null,
      recommended_until_offset: 0,
      recurrence_basis: "manual",
      schedule_kind: null,
    });
    expect(await occurrenceCounts(ruleId)).toEqual({ pending: 1, total: 1 });
    await expect(db.prepare(
      "SELECT scheduled_for, due_at, status FROM task_occurrences WHERE task_rule_id = ?1",
    ).bind(ruleId).first()).resolves.toEqual({
      due_at: null,
      scheduled_for: null,
      status: "pending",
    });
  });

  it("Occurrenceのスナップショットへ方式を残す(YDR-039)", async () => {
    const ruleId = await createDescaleTask();

    await expect(db.prepare(
      `SELECT json_extract(rule_snapshot, '$.recurrenceBasis') AS basis,
              json_extract(rule_snapshot, '$.managedItemName') AS item
         FROM task_occurrences WHERE task_rule_id = ?1`,
    ).bind(ruleId).first()).resolves.toEqual({
      basis: "manual",
      item: "Coffee machine",
    });
  });

  it("管理対象に紐づけずに登録できる", async () => {
    const ruleId = await createDescaleTask(null);

    expect(await occurrenceCounts(ruleId)).toEqual({ pending: 1, total: 1 });
  });

  it("他家庭の管理対象へは作成できず、他家庭のTaskRuleも作らない", async () => {
    await expect(createManualTask(db, memberA, {
      managedItemId: "item-b",
      title: "Cross-household manual",
    })).rejects.toThrow("Managed item not found");

    await expect(db.prepare(
      "SELECT count(*) AS total FROM task_rules WHERE recurrence_basis = 'manual'",
    ).first<{ total: number }>()).resolves.toEqual({ total: 0 });
  });
});

describe("必要になったら繰り返すTodoの完了(completeTask)", () => {
  it("完了すると次の予定日未定Occurrenceが1件だけ生まれる", async () => {
    const ruleId = await createDescaleTask();
    const occurrenceId = await pendingOccurrenceId(ruleId);

    const nextId = requireOccurrenceId(await completeTask(db, memberA, {
      idempotencyKey: "descale-1",
      occurredAt: "2026-09-10T02:00:00.000Z",
      occurrenceId,
      performedByUserId: null,
    }));

    expect(nextId).not.toBe(occurrenceId);
    expect(await occurrenceCounts(ruleId)).toEqual({ pending: 1, total: 2 });
    await expect(db.prepare(
      "SELECT scheduled_for, due_at, status FROM task_occurrences WHERE id = ?1",
    ).bind(nextId).first()).resolves.toEqual({
      due_at: null,
      scheduled_for: null,
      status: "pending",
    });
    await expect(db.prepare(
      "SELECT status FROM task_occurrences WHERE id = ?1",
    ).bind(occurrenceId).first()).resolves.toEqual({ status: "completed" });
  });

  it("完了のたびに実施記録が残り、未完了は常に1件に保たれる", async () => {
    const ruleId = await createDescaleTask();

    let occurrenceId = await pendingOccurrenceId(ruleId);
    for (const [index, occurredAt] of [
      "2026-03-10T02:00:00.000Z",
      "2026-05-02T02:00:00.000Z",
      "2026-07-20T02:00:00.000Z",
    ].entries()) {
      occurrenceId = requireOccurrenceId(await completeTask(db, memberA, {
        idempotencyKey: `descale-${String(index)}`,
        occurredAt,
        occurrenceId,
        performedByUserId: null,
      }));
    }

    expect(await occurrenceCounts(ruleId)).toEqual({ pending: 1, total: 4 });
    await expect(db.prepare(
      `SELECT count(*) AS completions FROM activity_logs l
         JOIN task_occurrences o ON o.id = l.task_occurrence_id
        WHERE o.task_rule_id = ?1 AND l.action = 'completed'`,
    ).bind(ruleId).first<{ completions: number }>()).resolves.toEqual({ completions: 3 });
  });

  it("同じ冪等キーの再送は次回Occurrenceを増やさない", async () => {
    const ruleId = await createDescaleTask();
    const occurrenceId = await pendingOccurrenceId(ruleId);
    const input = {
      idempotencyKey: "descale-retry",
      occurredAt: "2026-09-10T02:00:00.000Z",
      occurrenceId,
      performedByUserId: null,
    };

    const first = await completeTask(db, memberA, input);
    const second = await completeTask(db, memberA, input);

    expect(second).toBe(first);
    expect(await occurrenceCounts(ruleId)).toEqual({ pending: 1, total: 2 });
  });

  it("完了取消は次回Occurrenceを取り消し、元のOccurrenceを未完了へ戻す", async () => {
    const ruleId = await createDescaleTask();
    const occurrenceId = await pendingOccurrenceId(ruleId);
    const nextId = requireOccurrenceId(await completeTask(db, memberA, {
      idempotencyKey: "descale-undo",
      occurredAt: "2026-09-10T02:00:00.000Z",
      occurrenceId,
      performedByUserId: null,
    }));

    await undoTaskCompletion(db, memberA, occurrenceId, "descale-undo-key");

    expect(await occurrenceCounts(ruleId)).toEqual({ pending: 1, total: 1 });
    await expect(db.prepare(
      "SELECT status FROM task_occurrences WHERE id = ?1",
    ).bind(occurrenceId).first()).resolves.toEqual({ status: "pending" });
    await expect(db.prepare(
      "SELECT id FROM task_occurrences WHERE id = ?1",
    ).bind(nextId).first()).resolves.toBeNull();
  });

  // Issue #325 / YDR-046 / YDR-015: 完了で生まれた次回Occurrenceを編集した後に
  // 元の完了を取り消すと、編集済みの次回が黙って消える形になってはいけない。
  it("次回Occurrenceを編集した後は、元の完了取消が編集を失わない", async () => {
    const ruleId = await createDescaleTask();
    const occurrenceId = await pendingOccurrenceId(ruleId);
    const nextId = requireOccurrenceId(await completeTask(db, memberA, {
      idempotencyKey: "descale-edit-then-undo",
      occurredAt: "2026-03-10T02:00:00.000Z",
      occurrenceId,
      performedByUserId: null,
    }));

    // 担当は変えずに名前だけを直す(担当を変えたときの履歴に頼らない)。
    await updateOneTimeTodo(db, memberA, nextId, {
      assigneeUserId: null,
      managedItemId: null,
      note: null,
      scheduledFor: null,
      title: "石灰除去(手順を見直した)",
    });

    await expect(undoTaskCompletion(db, memberA, occurrenceId, "descale-undo-after-edit"))
      .rejects.toThrow("Next occurrence has been modified");

    await expect(db.prepare(
      `SELECT status, json_extract(rule_snapshot, '$.title') AS title
         FROM task_occurrences WHERE id = ?1`,
    ).bind(nextId).first()).resolves.toEqual({
      status: "pending",
      title: "石灰除去(手順を見直した)",
    });
    await expect(db.prepare(
      "SELECT status FROM task_occurrences WHERE id = ?1",
    ).bind(occurrenceId).first()).resolves.toEqual({ status: "completed" });
  });

  it("次回Occurrenceを編集していなければ、これまでどおり完了を取り消せる", async () => {
    const ruleId = await createDescaleTask();
    const occurrenceId = await pendingOccurrenceId(ruleId);
    const nextId = requireOccurrenceId(await completeTask(db, memberA, {
      idempotencyKey: "descale-plain-undo",
      occurredAt: "2026-03-10T02:00:00.000Z",
      occurrenceId,
      performedByUserId: null,
    }));

    await undoTaskCompletion(db, memberA, occurrenceId, "descale-plain-undo-key");

    await expect(db.prepare(
      "SELECT id FROM task_occurrences WHERE id = ?1",
    ).bind(nextId).first()).resolves.toBeNull();
    expect(await occurrenceCounts(ruleId)).toEqual({ pending: 1, total: 1 });
  });

  // Issue #325 / YDR-046: manualの次回Occurrenceは日付を持たず、実施日時にも
  // 依存しない。次回に手を付けていても、実施日の訂正は妨げられない。
  it("次回Occurrenceへ担当を決めた後でも、実施日を訂正できる", async () => {
    const ruleId = await createDescaleTask();
    const occurrenceId = await pendingOccurrenceId(ruleId);
    const nextId = requireOccurrenceId(await completeTask(db, memberA, {
      idempotencyKey: "descale-correct",
      occurredAt: "2026-03-10T02:00:00.000Z",
      occurrenceId,
      performedByUserId: null,
    }));
    await setTaskOccurrenceAssignee(db, memberA, nextId, "user-a");

    await correctCompletionOccurredAt(
      db,
      memberA,
      occurrenceId,
      "descale-correct-date",
      "2026-03-08T02:00:00.000Z",
    );

    await expect(db.prepare(
      `SELECT new_occurred_at FROM completion_corrections
        WHERE task_occurrence_id = ?1`,
    ).bind(occurrenceId).first()).resolves.toEqual({
      new_occurred_at: "2026-03-08T02:00:00.000Z",
    });
    // 次回Occurrenceは日付を持たないまま、担当もそのまま残る。
    await expect(db.prepare(
      "SELECT scheduled_for, due_at, assignee_user_id FROM task_occurrences WHERE id = ?1",
    ).bind(nextId).first()).resolves.toEqual({
      assignee_user_id: "user-a",
      due_at: null,
      scheduled_for: null,
    });
  });

  // YDR-039の3: 生成された次回Occurrenceのルールを編集した後の実施日訂正は、
  // 方式によらず拒否する(編集済みの次回を失わないため)。
  it("次回Occurrenceのルールを編集した後は、実施日を訂正できない", async () => {
    const ruleId = await createDescaleTask();
    const occurrenceId = await pendingOccurrenceId(ruleId);
    const nextId = requireOccurrenceId(await completeTask(db, memberA, {
      idempotencyKey: "descale-correct-blocked",
      occurredAt: "2026-03-10T02:00:00.000Z",
      occurrenceId,
      performedByUserId: null,
    }));
    await updateOneTimeTodo(db, memberA, nextId, {
      assigneeUserId: null,
      managedItemId: null,
      note: null,
      scheduledFor: null,
      title: "石灰除去(手順を見直した)",
    });

    await expect(correctCompletionOccurredAt(
      db,
      memberA,
      occurrenceId,
      "descale-correct-blocked-date",
      "2026-03-08T02:00:00.000Z",
    )).rejects.toThrow("Next occurrence has been modified");

    await expect(db.prepare(
      "SELECT count(*) AS total FROM completion_corrections WHERE task_occurrence_id = ?1",
    ).bind(occurrenceId).first<{ total: number }>()).resolves.toEqual({ total: 0 });
  });

  it("他家庭のOccurrenceは完了できない", async () => {
    const ruleId = await createManualTask(db, memberB, {
      managedItemId: "item-b",
      title: "B manual",
    });
    const occurrenceId = await pendingOccurrenceId(ruleId);

    await expect(completeTask(db, memberA, {
      idempotencyKey: "cross-household",
      occurredAt: "2026-09-10T02:00:00.000Z",
      occurrenceId,
      performedByUserId: null,
    })).rejects.toThrow("Occurrence not found");

    expect(await occurrenceCounts(ruleId)).toEqual({ pending: 1, total: 1 });
  });
});

describe("必要になったら繰り返すTodoの予定日と編集", () => {
  it("予定日の設定も延期も提供しない", async () => {
    const ruleId = await createDescaleTask();
    const occurrenceId = await pendingOccurrenceId(ruleId);

    await expect(setOneTimeTaskSchedule(db, memberA, occurrenceId, "2026-09-20T00:00:00.000Z"))
      .rejects.toThrow("Only one-time tasks can have an undated schedule");
    await expect(postponeTaskOccurrence(db, memberA, occurrenceId, "2099-09-20T00:00:00.000Z"))
      .rejects.toThrow("Cannot postpone an undated occurrence");
  });

  it("Todo名・担当・関連する管理対象は編集できる", async () => {
    const ruleId = await createDescaleTask();
    const occurrenceId = await pendingOccurrenceId(ruleId);

    await updateOneTimeTodo(db, memberA, occurrenceId, {
      assigneeUserId: "user-a",
      managedItemId: null,
      scheduledFor: null,
      title: "石灰除去(手順を見ながら)",
    });

    await expect(db.prepare(
      "SELECT title, managed_item_id FROM task_rules WHERE id = ?1",
    ).bind(ruleId).first()).resolves.toEqual({
      managed_item_id: null,
      title: "石灰除去(手順を見ながら)",
    });
    await expect(db.prepare(
      "SELECT assignee_user_id, scheduled_for FROM task_occurrences WHERE id = ?1",
    ).bind(occurrenceId).first()).resolves.toEqual({
      assignee_user_id: "user-a",
      scheduled_for: null,
    });
  });

  it("編集で予定日を与えようとすると拒否する", async () => {
    const ruleId = await createDescaleTask();
    const occurrenceId = await pendingOccurrenceId(ruleId);

    await expect(updateOneTimeTodo(db, memberA, occurrenceId, {
      assigneeUserId: null,
      managedItemId: null,
      scheduledFor: "2026-09-20T00:00:00.000Z",
      title: "石灰除去",
    })).rejects.toThrow("Manual tasks cannot have a schedule");

    await expect(db.prepare(
      "SELECT scheduled_for FROM task_occurrences WHERE id = ?1",
    ).bind(occurrenceId).first()).resolves.toEqual({ scheduled_for: null });
  });

  it("他家庭のメンバーは編集できない", async () => {
    const ruleId = await createDescaleTask();
    const occurrenceId = await pendingOccurrenceId(ruleId);

    await expect(updateOneTimeTodo(db, memberB, occurrenceId, {
      assigneeUserId: null,
      managedItemId: null,
      scheduledFor: null,
      title: "Hijacked",
    })).rejects.toThrow("Occurrence not found");

    await expect(db.prepare(
      "SELECT title FROM task_rules WHERE id = ?1",
    ).bind(ruleId).first()).resolves.toEqual({ title: "コーヒーマシーンの石灰除去" });
  });
});
