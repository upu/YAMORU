import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyAllMigrations } from "./test-support/migrations";
import { completeTask, correctCompletionOccurredAt, createManualTask, createMaintenanceTask, createOneTimeTask, loadTodoDetail, postponeTaskOccurrence, setTaskHardDeadline, undoTaskCompletion } from "./todos";
import { listPendingOccurrences } from "./home";
import { searchAcrossHousehold } from "./cross-search";

const db = env.DB;
const member = { userId: "a", email: "a@example.com" };
const other = { userId: "b", email: "b@example.com" };
async function occurrence(ruleId: string) {
  const found = await db.prepare("SELECT id FROM task_occurrences WHERE task_rule_id=? AND status='pending'").bind(ruleId).first<{ id: string }>();
  if (!found) throw Error("Missing occurrence");
  return found.id;
}
async function deadline(id: string) {
  return (await loadTodoDetail(db, member, id))?.must_complete_by;
}
async function complete(id: string) {
  return completeTask(db, member, { occurrenceId: id, idempotencyKey: crypto.randomUUID(), occurredAt: "2026-01-02T00:00:00.000Z", performedByUserId: null });
}
function requireNext(id: string | null): string {
  if (id === null) throw Error("Missing next occurrence");
  return id;
}

describe("各回の必達日", () => {
  beforeAll(() => applyAllMigrations(db));
  beforeEach(async () => {
    await db.batch([
      db.prepare("DELETE FROM completion_corrections"), db.prepare("DELETE FROM activity_logs"),
      db.prepare("DELETE FROM task_rules"), db.prepare("DELETE FROM household_members"),
      db.prepare("DELETE FROM households"), db.prepare("DELETE FROM users"),
      db.prepare("INSERT INTO users(id,email) VALUES ('a','a@example.com'),('b','b@example.com'),('outsider','out@example.com')"),
      db.prepare("INSERT INTO households(id,name) VALUES ('ha','A'),('hb','B')"),
      db.prepare("INSERT INTO household_members(household_id,user_id) VALUES ('ha','a'),('hb','b')"),
    ]);
  });
  it("予定未定の登録でも保存でき、設定・解除は予定日を変えず履歴を追記する", async () => {
    const id = await occurrence(await createOneTimeTask(db, member, { title: "申請", managedItemId: null, scheduledFor: null, mustCompleteBy: "2026-10-31" }));
    expect(await deadline(id)).toBe("2026-10-31");
    await setTaskHardDeadline(db, member, id, "2026-11-01", "2026-10-31");
    await setTaskHardDeadline(db, member, id, null, "2026-11-01");
    expect(await loadTodoDetail(db, member, id)).toMatchObject({ must_complete_by: null, scheduled_for: null, due_at: null });
    const { results } = await db.prepare("SELECT previous_date,new_date,actor_user_id FROM task_deadline_changes ORDER BY rowid").all();
    expect(results).toEqual([
      { previous_date: "2026-10-31", new_date: "2026-11-01", actor_user_id: "a" },
      { previous_date: "2026-11-01", new_date: null, actor_user_id: "a" },
    ]);
  });
  it("未設定で登録した必要時Todoの完了と取消でも必達日を維持し、次回へコピーしない", async () => {
    const id = await occurrence(await createManualTask(db, member, { title: "清掃", managedItemId: null }));
    await setTaskHardDeadline(db, member, id, "2026-01-03", null);
    const nextId = await complete(id);
    expect(nextId).not.toBeNull();
    expect(await deadline(requireNext(nextId))).toBeNull();
    expect(await deadline(id)).toBe("2026-01-03");
    await expect(setTaskHardDeadline(db, member, id, null, "2026-01-03")).rejects.toMatchObject({ code: "OCCURRENCE_NOT_PENDING" });
    await undoTaskCompletion(db, member, id, "undo");
    expect(await loadTodoDetail(db, member, id)).toMatchObject({ status: "pending", must_complete_by: "2026-01-03" });
  });
  it("別家庭・非所属・未認証と古い表示からの上書きを拒否する", async () => {
    const id = await occurrence(await createManualTask(db, member, { title: "清掃", managedItemId: null }));
    for (const actor of [other, null, { userId: "outsider", email: "out@example.com" }]) {
      await expect(setTaskHardDeadline(db, actor, id, "2026-01-03", null)).rejects.toThrow();
    }
    await setTaskHardDeadline(db, member, id, "2026-01-03", null);
    await expect(setTaskHardDeadline(db, member, id, "2026-01-04", null)).rejects.toMatchObject({ code: "HARD_DEADLINE_CHANGED" });
    expect(await deadline(id)).toBe("2026-01-03");
  });
  it("更新途中のDB失敗は追記履歴ごと戻す", async () => {
    const id = await occurrence(await createManualTask(db, member, { title: "清掃", managedItemId: null }));
    await db.prepare("CREATE TRIGGER reject_deadline BEFORE UPDATE OF must_complete_by ON task_occurrences BEGIN SELECT RAISE(ABORT, 'injected failure'); END").run();
    try {
      await expect(setTaskHardDeadline(db, member, id, "2026-01-03", null)).rejects.toThrow("injected failure");
      expect(await deadline(id)).toBeNull();
      expect(await db.prepare("SELECT count(*) AS count FROM task_deadline_changes").first()).toEqual({ count: 0 });
    } finally { await db.prepare("DROP TRIGGER reject_deadline").run(); }
  });
  it("延期・実施日訂正でも必達日を保ち、ホームと検索には同じ値を返す", async () => {
    const id = await occurrence(await createMaintenanceTask(db, member, { title: "点検", managedItemId: null,
      firstScheduledFor: "2026-01-01T00:00:00.000Z", firstDueAt: "2026-01-04T00:00:00.000Z",
      recommendedStartOffset: 10, recommendedUntilOffset: 20, mustCompleteBy: "2026-01-03" }));
    const later = new Date(Date.now() + 86400000).toISOString();
    await postponeTaskOccurrence(db, member, id, later);
    expect(await loadTodoDetail(db, member, id)).toMatchObject({ scheduled_for: "2026-01-01T00:00:00.000Z", due_at: later, must_complete_by: "2026-01-03" });
    expect(await listPendingOccurrences(db, member)).toMatchObject([{ id, must_complete_by: "2026-01-03" }]);
    expect((await searchAcrossHousehold(db, member, "点検")).todos.items).toMatchObject([{ id, mustCompleteBy: "2026-01-03" }]);
    expect(await listPendingOccurrences(db, other)).toEqual([]);
    const nextId = requireNext(await complete(id));
    await correctCompletionOccurredAt(db, member, id, "correct", "2026-01-03T00:00:00.000Z");
    expect(await deadline(id)).toBe("2026-01-03");
    expect(await deadline(nextId)).toBeNull();
  });
  it("履歴の家庭不一致をDBで拒否し、親削除で履歴を残さない", async () => {
    const id = await occurrence(await createManualTask(db, member, { title: "清掃", managedItemId: null }));
    await expect(db.prepare("INSERT INTO task_deadline_changes(id,household_id,task_occurrence_id,actor_user_id,new_date) VALUES ('foreign','hb',?,'b','2026-01-03')").bind(id).run()).rejects.toThrow();
    await setTaskHardDeadline(db, member, id, "2026-01-03", null);
    await db.prepare("DELETE FROM task_occurrences WHERE id=?").bind(id).run();
    expect(await db.prepare("SELECT count(*) AS count FROM task_deadline_changes").first()).toEqual({ count: 0 });
  });
  it("推奨期間と併存し、変更後解除した次回への取消・再計算を旧SQLでも拒否する", async () => {
    const id = await occurrence(await createMaintenanceTask(db, member, { title: "点検", managedItemId: null,
      firstScheduledFor: "2026-01-01T00:00:00.000Z", firstDueAt: "2026-01-04T00:00:00.000Z",
      recommendedStartOffset: 10, recommendedUntilOffset: 20, mustCompleteBy: "2026-01-03" }));
    expect(await loadTodoDetail(db, member, id)).toMatchObject({ due_at: "2026-01-04T00:00:00.000Z", must_complete_by: "2026-01-03" });
    const nextId = requireNext(await complete(id));
    await setTaskHardDeadline(db, member, nextId, "2026-02-01", null);
    await setTaskHardDeadline(db, member, nextId, null, "2026-02-01");
    await expect(undoTaskCompletion(db, member, id, "undo-modified")).rejects.toMatchObject({ code: "NEXT_OCCURRENCE_MODIFIED" });
    await expect(correctCompletionOccurredAt(db, member, id, "correct-modified", "2026-01-03T00:00:00.000Z")).rejects.toMatchObject({ code: "NEXT_OCCURRENCE_MODIFIED" });
    await expect(db.prepare("INSERT INTO activity_logs(id,household_id,task_occurrence_id,actor_user_id,action,occurred_at) VALUES ('old-undo','ha',?,'a','completion_undone','2026-01-04T00:00:00.000Z')").bind(id).run()).rejects.toThrow();
    await expect(db.prepare(`INSERT INTO completion_corrections(id,household_id,task_occurrence_id,completed_activity_log_id,actor_user_id,idempotency_key,previous_occurred_at,new_occurred_at)
      SELECT 'old-correct','ha',?,id,'a','old-correct','2026-01-02T00:00:00.000Z','2026-01-03T00:00:00.000Z'
      FROM activity_logs WHERE task_occurrence_id=? AND action='completed'`).bind(id, id).run()).rejects.toThrow("NEXT_OCCURRENCE_DEADLINE_MODIFIED");
    expect(await loadTodoDetail(db, member, id)).toMatchObject({ status: "completed" });
    expect(await loadTodoDetail(db, member, nextId)).toMatchObject({ status: "pending" });
  });
});
