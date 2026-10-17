import { D1ConflictError, D1NotFoundError } from "../errors";
import {
  completionStatements,
  loadActiveCompletion,
  resolveEffectiveCompletion,
  undoStatements,
} from "./completion";
import { correctOccurredAtStatements, performerCorrectionStatement } from "./corrections";
import {
  loadOccurrence,
  nextOccurrence,
  requireHouseholdUser,
  type NextOccurrence,
  type OccurrenceWithRule,
} from "./shared";

// 外部command(#437)が、実行前に差分を示すための読み取りと、受付記録と同じ
// D1 batchへ載せる業務更新の文を組み立てる。成否を決める条件付きSQLは既存の
// Web操作(completeTask・undoTaskCompletion・correctCompletion*)と同じ文を
// 使い、複製しない。ここでの事前の読み取りはpreviewのためであり、実行時の
// 正しさは文自体の条件とbatchの原子性で守る。

export type ScheduleSlot = { dueAt: string | null; scheduledFor: string | null };

// batchの後に、業務の記録が実際に書けたかを確かめるための手掛かり。
// 受付記録の成功はこの全件が存在することを条件にする。
export type BusinessEvidence =
  | { idempotencyKey: string; table: "activity_logs" | "completion_corrections" | "notification_settings" | "notification_controls" }
  // 指定した完了記録が、batchの後も対象Occurrenceの最新の完了であること
  // (loadActiveCompletionと同じ順序)。previewの後に取消→再完了されていれば、
  // 取消や訂正が置き換わった別の完了へ作用しないよう、batch全体を取り消す。
  | { activeCompletionLogId: string }
  // 登録で作った行が存在すること。作成の文は条件付きではないが、関連する行
  // (TaskRule)が無ければOccurrenceは作られないため、最後に作る行で確かめる。
  | { rowId: string; table: "managed_items" | "task_occurrences" };

export type BusinessStatements = {
  evidence: BusinessEvidence[];
  statements: D1PreparedStatement[];
};

export type CommandActor = { actorId: string; householdId: string; idempotencyKey: string };

export type EffectiveCompletionState = {
  completionLogId: string;
  occurredAt: string;
  performerId: string | null;
};

async function loadRuleTitle(db: D1Database, householdId: string, taskRuleId: string): Promise<string> {
  const row = await db.prepare("SELECT title FROM task_rules WHERE id = ?1 AND household_id = ?2")
    .bind(taskRuleId, householdId).first<{ title: string }>();
  if (row === null) throw new D1NotFoundError("Occurrence not found", "OCCURRENCE_NOT_FOUND");
  return row.title;
}

// 次回の予定日が、同じルールの別の回(今回や過去の回を含む)と重ならないこと。
// 重なるとtask_occurrencesの一意制約でbatchが失敗し、同じ入力では何度
// 再試行しても通らないため、previewの時点で業務エラーにする。
async function requireFreeSchedule(
  db: D1Database,
  householdId: string,
  input: { exceptOccurrenceId: string | null; scheduledFor: string | null; taskRuleId: string },
): Promise<void> {
  if (input.scheduledFor === null) return;
  const taken = await db.prepare(
    `SELECT 1 FROM task_occurrences
      WHERE task_rule_id = ?1 AND household_id = ?2 AND scheduled_for = ?3
        AND (?4 IS NULL OR id <> ?4)`,
  ).bind(input.taskRuleId, householdId, input.scheduledFor, input.exceptOccurrenceId).first();
  if (taken !== null) {
    throw new D1ConflictError("Next occurrence already exists for the computed schedule", "NEXT_OCCURRENCE_SCHEDULE_TAKEN");
  }
}

// 他の家族がすでに完了させていた場合に、現在の状態として返す有効な完了記録。
export async function loadCurrentCompletion(
  db: D1Database,
  householdId: string,
  occurrenceId: string,
): Promise<EffectiveCompletionState | null> {
  const occurrence = await loadOccurrence(db, householdId, occurrenceId);
  if (occurrence.status !== "completed") return null;
  const completion = await loadActiveCompletion(db, householdId, occurrenceId);
  const effective = await resolveEffectiveCompletion(db, householdId, completion.id);
  return {
    completionLogId: completion.id,
    occurredAt: effective.occurredAt,
    performerId: effective.performedByUserId,
  };
}

export type CompletionPlan = {
  next: NextOccurrence | null;
  occurredAt: string;
  occurrence: OccurrenceWithRule;
  performerId: string;
  title: string;
};

export async function planCompletion(
  db: D1Database,
  householdId: string,
  input: { occurredAt: string; occurrenceId: string; performerId: string },
): Promise<CompletionPlan> {
  const occurrence = await loadOccurrence(db, householdId, input.occurrenceId);
  if (occurrence.status !== "pending") throw new D1ConflictError("Occurrence is not pending", "OCCURRENCE_NOT_PENDING");
  await requireHouseholdUser(db, householdId, input.performerId, "PERFORMER_NOT_FOUND");
  const next = nextOccurrence(occurrence, input.occurredAt);
  await requireFreeSchedule(db, householdId, {
    exceptOccurrenceId: null,
    scheduledFor: next?.scheduledFor ?? null,
    taskRuleId: occurrence.task_rule_id,
  });
  return {
    next,
    occurredAt: input.occurredAt,
    occurrence,
    performerId: input.performerId,
    title: await loadRuleTitle(db, householdId, occurrence.task_rule_id),
  };
}

export function completionPlanStatements(
  db: D1Database,
  plan: CompletionPlan,
  actor: CommandActor & { logId: string },
): BusinessStatements {
  return {
    evidence: [{ idempotencyKey: actor.idempotencyKey, table: "activity_logs" }],
    statements: completionStatements(db, {
      ...actor,
      next: plan.next,
      occurredAt: plan.occurredAt,
      occurrence: plan.occurrence,
      performerId: plan.performerId,
    }),
  };
}

type ActiveCompletionLog = {
  effective: EffectiveCompletionState;
  nextOccurrenceId: string | null;
  occurrence: OccurrenceWithRule;
  title: string;
};

// 指定された完了記録が、対象Occurrenceの現在有効な完了であることを確かめる。
// 取消済み、または取消後に別の完了で置き換わった記録は対象にしない。
async function loadActiveCompletionLog(
  db: D1Database,
  householdId: string,
  completionLogId: string,
): Promise<ActiveCompletionLog> {
  const log = await db.prepare(
    `SELECT task_occurrence_id, next_task_occurrence_id FROM activity_logs
      WHERE id = ?1 AND household_id = ?2 AND action = 'completed'`,
  ).bind(completionLogId, householdId)
    .first<{ next_task_occurrence_id: string | null; task_occurrence_id: string }>();
  if (log === null) throw new D1NotFoundError("Completion log not found", "COMPLETION_LOG_NOT_FOUND");
  const occurrence = await loadOccurrence(db, householdId, log.task_occurrence_id);
  const active = occurrence.status === "completed"
    ? await loadActiveCompletion(db, householdId, occurrence.id)
    : null;
  if (active?.id !== completionLogId) {
    throw new D1ConflictError("Completion log is no longer active", "COMPLETION_NOT_ACTIVE");
  }
  const effective = await resolveEffectiveCompletion(db, householdId, completionLogId);
  return {
    effective: { completionLogId, occurredAt: effective.occurredAt, performerId: effective.performedByUserId },
    nextOccurrenceId: log.next_task_occurrence_id,
    occurrence,
    title: await loadRuleTitle(db, householdId, occurrence.task_rule_id),
  };
}

type NextOccurrenceState = ScheduleSlot & {
  hasActivity: boolean;
  hasDeadlineChanges: boolean;
  hasRuleChanges: boolean;
  id: string;
  pending: boolean;
};

async function loadNextOccurrenceState(
  db: D1Database,
  householdId: string,
  occurrenceId: string,
): Promise<NextOccurrenceState | null> {
  const row = await db.prepare(
    `SELECT n.id, n.scheduled_for, n.due_at, n.status = 'pending' AS pending,
       EXISTS (SELECT 1 FROM activity_logs a
                WHERE a.task_occurrence_id = n.id AND a.household_id = n.household_id) AS has_activity,
       EXISTS (SELECT 1 FROM task_rule_changes c
                WHERE c.task_occurrence_id = n.id AND c.household_id = n.household_id) AS has_rule_changes,
       EXISTS (SELECT 1 FROM task_deadline_changes d
                WHERE d.task_occurrence_id = n.id AND d.household_id = n.household_id) AS has_deadline_changes
     FROM task_occurrences n WHERE n.id = ?1 AND n.household_id = ?2`,
  ).bind(occurrenceId, householdId).first<{
    due_at: string | null;
    has_activity: number;
    has_deadline_changes: number;
    has_rule_changes: number;
    id: string;
    pending: number;
    scheduled_for: string | null;
  }>();
  if (row === null) return null;
  return {
    dueAt: row.due_at,
    hasActivity: row.has_activity === 1,
    hasDeadlineChanges: row.has_deadline_changes === 1,
    hasRuleChanges: row.has_rule_changes === 1,
    id: row.id,
    pending: row.pending === 1,
    scheduledFor: row.scheduled_for,
  };
}

// 自動生成された後、誰も触れていない次回Occurrenceか(undoStatementsの条件)。
function isUntouched(state: NextOccurrenceState | null): state is NextOccurrenceState {
  return state !== null && state.pending && !state.hasActivity && !state.hasDeadlineChanges && !state.hasRuleChanges;
}

function nextOccurrenceModified(): D1ConflictError {
  return new D1ConflictError("Next occurrence has been modified", "NEXT_OCCURRENCE_MODIFIED");
}

export type UndoPlan = {
  effective: EffectiveCompletionState;
  // 取消で削除される、自動生成された次回Occurrence。
  next: (ScheduleSlot & { id: string }) | null;
  occurrence: OccurrenceWithRule;
  title: string;
};

export async function planUndo(
  db: D1Database,
  householdId: string,
  completionLogId: string,
): Promise<UndoPlan> {
  const log = await loadActiveCompletionLog(db, householdId, completionLogId);
  let next: UndoPlan["next"] = null;
  if (log.nextOccurrenceId !== null) {
    const state = await loadNextOccurrenceState(db, householdId, log.nextOccurrenceId);
    if (!isUntouched(state)) throw nextOccurrenceModified();
    next = { dueAt: state.dueAt, id: state.id, scheduledFor: state.scheduledFor };
  }
  return { effective: log.effective, next, occurrence: log.occurrence, title: log.title };
}

export function undoPlanStatements(
  db: D1Database,
  plan: UndoPlan,
  actor: CommandActor & { logId: string },
): BusinessStatements {
  return {
    evidence: [
      { idempotencyKey: actor.idempotencyKey, table: "activity_logs" },
      { activeCompletionLogId: plan.effective.completionLogId },
    ],
    statements: undoStatements(db, {
      ...actor,
      nextOccurrenceId: plan.next?.id ?? null,
      occurrenceId: plan.occurrence.id,
    }),
  };
}

export type CorrectionPlan = {
  effective: EffectiveCompletionState;
  newOccurredAt: string | null;
  newPerformerId: string | null;
  // 実施日時の訂正で次回Occurrenceの予定を計算し直す場合の前後。
  next: { current: ScheduleSlot & { id: string }; recalculated: NextOccurrence | null } | null;
  nextOccurrenceId: string | null;
  occurrence: OccurrenceWithRule;
  title: string;
};

// correctCompletionOccurredAtと同じ判断で、次回Occurrenceへの影響を求める。
// 日付を持つ次回だけ再計算し、その場合は次回が無操作であることを求める。
// 次回のルールが編集されていれば、再計算の有無によらず訂正しない(YDR-039)。
async function correctionNextEffect(
  db: D1Database,
  householdId: string,
  occurrence: OccurrenceWithRule,
  nextOccurrenceId: string,
  newOccurredAt: string,
): Promise<CorrectionPlan["next"]> {
  const recalculated = nextOccurrence(occurrence, newOccurredAt);
  const dated = recalculated !== null && recalculated.scheduledFor !== null ? recalculated : null;
  const state = await loadNextOccurrenceState(db, householdId, nextOccurrenceId);
  if (state === null) {
    if (dated !== null) throw nextOccurrenceModified();
    return null;
  }
  if (state.hasRuleChanges || (dated !== null && !isUntouched(state))) throw nextOccurrenceModified();
  await requireFreeSchedule(db, householdId, {
    exceptOccurrenceId: state.id,
    scheduledFor: dated?.scheduledFor ?? null,
    taskRuleId: occurrence.task_rule_id,
  });
  return {
    current: { dueAt: state.dueAt, id: state.id, scheduledFor: state.scheduledFor },
    recalculated: dated,
  };
}

export async function planCorrection(
  db: D1Database,
  householdId: string,
  input: { completionLogId: string; occurredAt: string | null; performerId: string | null },
): Promise<CorrectionPlan> {
  const log = await loadActiveCompletionLog(db, householdId, input.completionLogId);
  if (input.performerId !== null) {
    await requireHouseholdUser(db, householdId, input.performerId, "PERFORMER_NOT_FOUND");
  }
  const next = input.occurredAt === null || log.nextOccurrenceId === null
    ? null
    : await correctionNextEffect(db, householdId, log.occurrence, log.nextOccurrenceId, input.occurredAt);
  return {
    effective: log.effective,
    newOccurredAt: input.occurredAt,
    newPerformerId: input.performerId,
    next,
    nextOccurrenceId: log.nextOccurrenceId,
    occurrence: log.occurrence,
    title: log.title,
  };
}

// 実施日時と実施者の訂正を、一つのbatchに載せる文として組み立てる。訂正行は
// 項目ごとに分かれる(completion_correctionsの制約)が、受付記録の成功条件に
// 両方の行を含めるため、片方だけが残ることはない。
export function correctionPlanStatements(
  db: D1Database,
  plan: CorrectionPlan,
  actor: CommandActor,
): BusinessStatements {
  const result: BusinessStatements = {
    evidence: [{ activeCompletionLogId: plan.effective.completionLogId }],
    statements: [],
  };
  const base = {
    actorId: actor.actorId,
    completedActivityLogId: plan.effective.completionLogId,
    householdId: actor.householdId,
    occurrenceId: plan.occurrence.id,
    previousOccurredAt: plan.effective.occurredAt,
  };
  if (plan.newOccurredAt !== null) {
    const idempotencyKey = `${actor.idempotencyKey}:occurred_at`;
    result.statements.push(...correctOccurredAtStatements(db, {
      ...base,
      correctionId: crypto.randomUUID(),
      idempotencyKey,
      newOccurredAt: plan.newOccurredAt,
      next: plan.next?.recalculated ?? null,
      nextOccurrenceId: plan.nextOccurrenceId,
    }));
    result.evidence.push({ idempotencyKey, table: "completion_corrections" });
  }
  if (plan.newPerformerId !== null) {
    const idempotencyKey = `${actor.idempotencyKey}:performer`;
    result.statements.push(performerCorrectionStatement(db, {
      ...base,
      correctionId: crypto.randomUUID(),
      idempotencyKey,
      newPerformerId: plan.newPerformerId,
      previousPerformerId: plan.effective.performerId,
    }));
    result.evidence.push({ idempotencyKey, table: "completion_corrections" });
  }
  return result;
}
