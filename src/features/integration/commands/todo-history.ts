import {
  correctionPlanStatements,
  planCorrection,
  planUndo,
  undoPlanStatements,
  type CorrectionPlan,
  type UndoPlan,
} from "../../../lib/d1/todos/command-plans";
import { CommandError, invalidInput, type NormalizedCommand } from "./contract";
import {
  mapD1Error,
  performerNotFound,
  scheduleView,
  todoDetailUrl,
  type CommandContext,
  type CommandHandler,
} from "./handler";
import { completionLogTarget, idValue, objectValue, occurredValue, tokyoDate } from "./input";

// 完了記録への後からの操作。todo.correctは実施日時・実施者を追記型で訂正し、
// todo.undoは次回が誰にも触れられていないときだけ完了を取り消す。

const HISTORY_ERRORS = {
  COMPLETION_LOG_NOT_FOUND: () => new CommandError("not_found"),
  // 取消済み、または取消の後に別の完了で置き換わった記録。
  COMPLETION_NOT_ACTIVE: () => new CommandError("already_resolved"),
  NEXT_OCCURRENCE_MODIFIED: () => new CommandError("unsafe_undo"),
  OCCURRENCE_NOT_FOUND: () => new CommandError("not_found"),
};

function completionView(effective: { completionLogId: string; occurredAt: string; performerId: string | null }) {
  return {
    completion_log_id: effective.completionLogId,
    occurred_at: effective.occurredAt,
    occurred_on: tokyoDate(effective.occurredAt),
    performer_id: effective.performerId,
  };
}

function undoPreview(undo: UndoPlan) {
  const affected = [{ change: "reopen", id: undo.occurrence.id, kind: "todo_occurrence", title: undo.title }];
  if (undo.next !== null) affected.push({ change: "delete", id: undo.next.id, kind: "todo_occurrence", title: undo.title });
  return {
    affected_entities: affected,
    diff: { completion: completionView(undo.effective), status: { from: "completed", to: "pending" } },
    schedule_effect: {
      removed_next_occurrence: undo.next === null ? null : { id: undo.next.id, ...scheduleView(undo.next) },
      reopened_occurrence: scheduleView({ dueAt: undo.occurrence.due_at, scheduledFor: undo.occurrence.scheduled_for }),
    },
  };
}

export const todoUndoHandler: CommandHandler = {
  normalize(_context, request) {
    const payload = objectValue(request.payload, "payload", ["completion_log_id"]);
    const target = completionLogTarget(request.target, payload.completion_log_id);
    return { command: "todo.undo", payload: { completion_log_id: target.id }, target };
  },

  async plan(context, normalized) {
    const undo = await planUndo(context.db, context.householdId, normalized.target.id)
      .catch((error: unknown) => mapD1Error(error, HISTORY_ERRORS));
    return {
      build({ businessKey, recordedAt }) {
        const logId = crypto.randomUUID();
        const business = undoPlanStatements(context.db, undo, {
          actorId: context.userId,
          householdId: context.householdId,
          idempotencyKey: businessKey,
          logId,
        });
        const result = {
          detail_url: todoDetailUrl(undo.occurrence.id),
          occurrence_id: undo.occurrence.id,
          recorded_at: recordedAt,
          removed_next_occurrence_id: undo.next?.id ?? null,
          undo_log_id: logId,
          undone_completion_log_id: undo.effective.completionLogId,
        };
        return { ...business, result, revisionEntity: { id: undo.occurrence.id, kind: "todo_occurrence" as const } };
      },
      preview: undoPreview(undo),
    };
  },
};

type CorrectionChanges = { date_precision?: "day" | "instant"; occurred_at?: string; performer_id?: string };

function normalizeCorrection(context: CommandContext, request: { payload: unknown; target: unknown }): NormalizedCommand {
  const payload = objectValue(request.payload, "payload", ["completion_log_id", "changes"]);
  const target = completionLogTarget(request.target, payload.completion_log_id);
  const changes = objectValue(payload.changes, "payload.changes", ["occurred_on", "occurred_at", "performer_id"]);
  const occurred = occurredValue(changes, "payload.changes", context.now);
  const normalized: CorrectionChanges = {};
  if (occurred !== null) {
    normalized.occurred_at = occurred.occurredAt;
    normalized.date_precision = occurred.datePrecision;
  }
  if (changes.performer_id !== undefined) normalized.performer_id = idValue(changes.performer_id, "payload.changes.performer_id");
  if (Object.keys(normalized).length === 0) throw invalidInput("payload.changes", "empty_changes");
  return { command: "todo.correct", payload: { changes: normalized, completion_log_id: target.id }, target };
}

// 現在の値と同じ項目は訂正履歴を増やすだけなので、黙って捨てずに拒否する。
function rejectUnchanged(correction: CorrectionPlan): void {
  if (correction.newOccurredAt === correction.effective.occurredAt) {
    throw invalidInput("payload.changes.occurred_at", "unchanged");
  }
  if (correction.newPerformerId !== null && correction.newPerformerId === correction.effective.performerId) {
    throw invalidInput("payload.changes.performer_id", "unchanged");
  }
}

function correctionDiff(correction: CorrectionPlan, changes: CorrectionChanges) {
  const before = completionView(correction.effective);
  return {
    ...(changes.occurred_at === undefined ? {} : {
      date_precision: changes.date_precision,
      occurred_at: { from: before.occurred_at, to: changes.occurred_at },
      occurred_on: { from: before.occurred_on, to: tokyoDate(changes.occurred_at) },
    }),
    ...(changes.performer_id === undefined ? {} : {
      performer_id: { from: before.performer_id, to: changes.performer_id },
    }),
  };
}

function correctionScheduleEffect(correction: CorrectionPlan) {
  const next = correction.next;
  if (next === null) return { next_occurrence: null };
  return {
    next_occurrence: {
      from: scheduleView(next.current),
      id: next.current.id,
      // 日付を持たない次回(manual)は再計算せず、そのまま残す。
      to: next.recalculated === null ? scheduleView(next.current) : scheduleView(next.recalculated),
    },
  };
}

export const todoCorrectHandler: CommandHandler = {
  normalize: normalizeCorrection,

  async plan(context, normalized) {
    const changes = (normalized.payload as { changes: CorrectionChanges }).changes;
    const correction = await planCorrection(context.db, context.householdId, {
      completionLogId: normalized.target.id,
      occurredAt: changes.occurred_at ?? null,
      performerId: changes.performer_id ?? null,
    }).catch((error: unknown) => mapD1Error(error, {
      ...HISTORY_ERRORS,
      PERFORMER_NOT_FOUND: () => performerNotFound("payload.changes.performer_id"),
    }));
    rejectUnchanged(correction);
    return {
      build({ businessKey, recordedAt }) {
        const business = correctionPlanStatements(context.db, correction, {
          actorId: context.userId,
          householdId: context.householdId,
          idempotencyKey: businessKey,
        });
        const effect = correctionScheduleEffect(correction);
        const result = {
          ...(changes.date_precision === undefined ? {} : { date_precision: changes.date_precision }),
          completion_log_id: correction.effective.completionLogId,
          detail_url: todoDetailUrl(correction.occurrence.id),
          next_occurrence: effect.next_occurrence === null ? null : { id: effect.next_occurrence.id, ...effect.next_occurrence.to },
          occurred_at: changes.occurred_at ?? correction.effective.occurredAt,
          occurred_on: tokyoDate(changes.occurred_at ?? correction.effective.occurredAt),
          occurrence_id: correction.occurrence.id,
          performer_id: changes.performer_id ?? correction.effective.performerId,
          recorded_at: recordedAt,
        };
        return { ...business, result, revisionEntity: { id: correction.occurrence.id, kind: "todo_occurrence" as const } };
      },
      preview: {
        affected_entities: [
          { change: "correct", id: correction.effective.completionLogId, kind: "completion_log", title: correction.title },
          // 現在の実施日・実施者として表示される対象。読み取りのrevisionで照合できる。
          { change: "correct_history", id: correction.occurrence.id, kind: "todo_occurrence", title: correction.title },
        ],
        diff: correctionDiff(correction, changes),
        schedule_effect: correctionScheduleEffect(correction),
      },
    };
  },
};
