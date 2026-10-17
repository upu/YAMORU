import { D1ConflictError } from "../errors";
import { postponeStatements, requirePostponable } from "./assignment";
import { loadRuleTitle, type BusinessStatements, type CommandActor } from "./command-plans";
import { loadOccurrence, type OccurrenceWithRule } from "./shared";

// 外部command(#437)の編集系。判定と文はWeb操作(postponeTaskOccurrence等)と
// 同じものを使い、ここでは受付記録と同じbatchへ載せる形にまとめるだけを持つ。

export type ReschedulePlan = {
  dueAt: string;
  occurrence: OccurrenceWithRule;
  title: string;
};

// todo.reschedule: 今回の期限(due_at)だけを動かす。本来の予定(scheduled_for)・
// 必達日は変えない(YDR-012)。必要になったら繰り返すTodoは期限を持たない。
export async function planReschedule(
  db: D1Database,
  householdId: string,
  input: { dueAt: string; nowIso: string; occurrenceId: string },
): Promise<ReschedulePlan> {
  const occurrence = await loadOccurrence(db, householdId, input.occurrenceId);
  if (occurrence.status !== "pending") throw new D1ConflictError("Occurrence is not pending", "OCCURRENCE_NOT_PENDING");
  if (occurrence.recurrence_basis === "manual") {
    throw new D1ConflictError("Manual tasks cannot have a schedule", "MANUAL_TODO_HAS_NO_SCHEDULE");
  }
  requirePostponable(occurrence, input.dueAt, input.nowIso);
  return { dueAt: input.dueAt, occurrence, title: await loadRuleTitle(db, householdId, occurrence.task_rule_id) };
}

export function reschedulePlanStatements(
  db: D1Database,
  plan: ReschedulePlan,
  actor: CommandActor & { logId: string; recordedAt: string },
): BusinessStatements {
  return {
    evidence: [{ idempotencyKey: actor.idempotencyKey, table: "activity_logs" }],
    statements: postponeStatements(db, { ...actor, dueAt: plan.dueAt, occurrence: plan.occurrence }),
  };
}
