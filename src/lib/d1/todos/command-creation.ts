import type { BusinessStatements } from "./command-plans";
import { taskInsertStatements, type TaskInsert } from "./creation";
import { requireHouseholdUser, requireManagedItem } from "./shared";

// 外部command(#437)のtodo.create。保存形(TaskInsert)と文はWebの登録と同じ
// ものを使い、ここでは関連する管理対象・担当の確認と、受付記録と同じbatchへ
// 載せる文の組み立てだけを持つ。

export type TodoCreationPlan = {
  insert: TaskInsert;
  managedItemName: string | null;
};

export async function planTodoCreation(
  db: D1Database,
  householdId: string,
  insert: TaskInsert,
): Promise<TodoCreationPlan> {
  await requireManagedItem(db, householdId, insert.managedItemId);
  if (insert.assigneeUserId) {
    await requireHouseholdUser(db, householdId, insert.assigneeUserId, "ASSIGNEE_NOT_FOUND");
  }
  const item = insert.managedItemId === null
    ? null
    : await db.prepare("SELECT name FROM managed_items WHERE id = ?1 AND household_id = ?2")
      .bind(insert.managedItemId, householdId).first<{ name: string }>();
  return { insert, managedItemName: item?.name ?? null };
}

export function todoCreationStatements(
  db: D1Database,
  householdId: string,
  plan: TodoCreationPlan,
  ids: { occurrenceId: string; taskRuleId: string },
): BusinessStatements {
  return {
    evidence: [{ rowId: ids.occurrenceId, table: "task_occurrences" }],
    statements: taskInsertStatements(db, householdId, plan.insert, ids),
  };
}
