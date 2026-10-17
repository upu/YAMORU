import { D1ConflictError, D1NotFoundError } from "../errors";
import { postponeStatements, requirePostponable } from "./assignment";
import { loadRuleTitle, type BusinessEvidence, type BusinessStatements, type CommandActor } from "./command-plans";
import { oneTimeEditStatements, requireEditableOccurrence, type OneTimeTodoUpdate } from "./edit";
import { hardDeadlineStatements } from "./hard-deadline";
import {
  assertRecurringOccurrence,
  recurringOccurrenceStatements,
  recurringRuleStatements,
  type RecurringOccurrenceUpdate,
  type RecurringTaskRuleUpdate,
  type RuleBasicsUpdate,
} from "./recurring-edit";
import { loadOccurrence, requireHouseholdUser, requireManagedItem, type OccurrenceWithRule } from "./shared";

// 外部command(#437)の編集系。判定と文はWeb操作(postponeTaskOccurrence・
// updateRecurringOccurrence・updateRecurringTaskRule・updateOneTimeTodo・
// setTaskHardDeadline)と同じものを使い、ここでは受付記録と同じbatchへ載せる
// 形にまとめるだけを持つ。

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

// todo.update: 変更前の値。指定しなかった項目はこの値を保つ。
export type TodoEditCurrent = {
  managedItemName: string | null;
  mustCompleteBy: string | null;
  note: string | null;
  occurrence: OccurrenceWithRule;
  title: string;
};

export async function loadTodoEditCurrent(
  db: D1Database,
  householdId: string,
  occurrenceId: string,
): Promise<TodoEditCurrent> {
  const occurrence = await loadOccurrence(db, householdId, occurrenceId);
  if (occurrence.status !== "pending") throw new D1ConflictError("Occurrence is not pending", "OCCURRENCE_NOT_PENDING");
  const row = await db.prepare(
    `SELECT r.title, r.note, o.must_complete_by AS mustCompleteBy, i.name AS managedItemName
       FROM task_occurrences o
       JOIN task_rules r ON r.id = o.task_rule_id AND r.household_id = o.household_id
       LEFT JOIN managed_items i ON i.id = r.managed_item_id AND i.household_id = r.household_id
      WHERE o.id = ?1 AND o.household_id = ?2`,
  ).bind(occurrenceId, householdId).first<Omit<TodoEditCurrent, "occurrence">>();
  if (row === null) throw new D1NotFoundError("Occurrence not found", "OCCURRENCE_NOT_FOUND");
  return { ...row, occurrence };
}

export type TodoUpdatePlan =
  | { current: TodoEditCurrent; kind: "occurrence"; mustCompleteBy: string | null; occurrence: RecurringOccurrenceUpdate }
  | { current: TodoEditCurrent; kind: "rule"; rule: RecurringTaskRuleUpdate | RuleBasicsUpdate }
  | { current: TodoEditCurrent; kind: "combined"; input: OneTimeTodoUpdate; mustCompleteBy: string | null };

async function requireAssignee(db: D1Database, householdId: string, before: string | null, after: string | null): Promise<void> {
  if (after !== null && after !== before) await requireHouseholdUser(db, householdId, after, "ASSIGNEE_NOT_FOUND");
}

// 変更後の値がWebの編集と同じ規則を満たすかを確かめる。期限は変えたときだけ確かめ、
// 期限を過ぎた回の担当だけを変える操作を拒否しない。
export async function validateTodoUpdate(db: D1Database, householdId: string, plan: TodoUpdatePlan, nowIso: string): Promise<void> {
  const { occurrence } = plan.current;
  if (plan.kind === "occurrence") {
    await requireAssignee(db, householdId, occurrence.assignee_user_id, plan.occurrence.assigneeUserId);
    if (plan.occurrence.dueAt !== occurrence.due_at) assertRecurringOccurrence(occurrence, plan.occurrence, nowIso);
    return;
  }
  if (plan.kind === "rule") {
    await requireManagedItem(db, householdId, plan.rule.managedItemId);
    return;
  }
  await requireAssignee(db, householdId, occurrence.assignee_user_id, plan.input.assigneeUserId);
  await requireManagedItem(db, householdId, plan.input.managedItemId);
  requireEditableOccurrence(occurrence, plan.input);
}

function deadlineStatements(
  db: D1Database,
  current: TodoEditCurrent,
  mustCompleteBy: string | null,
  actor: { actorId: string; householdId: string; idempotencyKey: string },
): D1PreparedStatement[] {
  if (mustCompleteBy === current.mustCompleteBy) return [];
  return hardDeadlineStatements(db, {
    ...actor, changeId: crypto.randomUUID(), expected: current.mustCompleteBy, mustCompleteBy, occurrenceId: current.occurrence.id,
  });
}

function occurrenceEvidence(id: string, values: Record<string, string | null>): BusinessEvidence {
  return { rowId: id, table: "task_occurrences", values: { status: "pending", ...values } };
}

// 文と、batchの後に対象が変更後の値を持つことの証跡。条件付きの文が0件だった
// まま受付記録が成功にならないよう、変えた項目と現在回がpendingであることを照合する。
export function todoUpdateStatements(
  db: D1Database,
  plan: TodoUpdatePlan,
  actor: { actorId: string; householdId: string; idempotencyKey: string; recordedAt: string },
): BusinessStatements {
  const { current } = plan;
  const id = current.occurrence.id;
  const base = { householdId: actor.householdId, occurrence: current.occurrence };
  if (plan.kind === "occurrence") {
    return {
      evidence: [occurrenceEvidence(id, {
        assignee_user_id: plan.occurrence.assigneeUserId, due_at: plan.occurrence.dueAt, must_complete_by: plan.mustCompleteBy,
      })],
      statements: [
        ...recurringOccurrenceStatements(db, {
          ...base, at: actor.recordedAt, idempotencyKey: actor.idempotencyKey, input: plan.occurrence, userId: actor.actorId,
        }),
        ...deadlineStatements(db, current, plan.mustCompleteBy, actor),
      ],
    };
  }
  const rule = plan.kind === "rule" ? plan.rule : plan.input;
  const ruleEvidence: BusinessEvidence = {
    rowId: current.occurrence.task_rule_id,
    table: "task_rules",
    values: { managed_item_id: rule.managedItemId, note: rule.note, title: rule.title },
  };
  if (plan.kind === "rule") {
    return {
      evidence: [ruleEvidence, occurrenceEvidence(id, {})],
      statements: recurringRuleStatements(db, {
        ...base, changeId: crypto.randomUUID(), idempotencyKey: actor.idempotencyKey, input: plan.rule, occurrenceId: id,
        userId: actor.actorId,
      }).statements,
    };
  }
  return {
    evidence: [ruleEvidence, occurrenceEvidence(id, {
      assignee_user_id: plan.input.assigneeUserId, must_complete_by: plan.mustCompleteBy, scheduled_for: plan.input.scheduledFor,
    })],
    statements: [
      ...oneTimeEditStatements(db, {
        ...base, actorId: actor.actorId, at: actor.recordedAt, idempotencyKey: actor.idempotencyKey, input: plan.input,
      }),
      ...deadlineStatements(db, current, plan.mustCompleteBy, actor),
    ],
  };
}

