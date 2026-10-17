import { tokyoDateToUtcIso } from "../../../app/time-zone";
import { planReschedule, reschedulePlanStatements } from "../../../lib/d1/todos/command-edits";
import { CommandError, invalidInput, type NormalizedCommand } from "./contract";
import {
  mapD1Error,
  recurrenceName,
  scheduleView,
  targetOf,
  todoDetailUrl,
  type CommandContext,
  type CommandHandler,
} from "./handler";
import { objectValue, todoOccurrenceTarget } from "./input";

// todo.reschedule: 今回の期限を変える(Webの延期と同じ)。本来の予定日・必達日・
// 次回以降の条件は変えない。「今日より後」はprepare時とcommit時の両方で確かめる。

type ReschedulePayload = { new_due_on: string };

function normalize(_context: CommandContext, request: { payload: unknown; target: unknown }): NormalizedCommand {
  const target = todoOccurrenceTarget(request.target);
  const payload = objectValue(request.payload ?? {}, "payload", ["new_due_on"]);
  if (payload.new_due_on === undefined || payload.new_due_on === null) {
    throw new CommandError("missing_required", { fieldErrors: { "payload.new_due_on": "required" } });
  }
  if (typeof payload.new_due_on !== "string" || tokyoDateToUtcIso(payload.new_due_on) === null) {
    throw invalidInput("payload.new_due_on", "date_required");
  }
  const normalized: ReschedulePayload = { new_due_on: payload.new_due_on };
  return { command: "todo.reschedule", payload: normalized, target };
}

async function plan(context: CommandContext, normalized: NormalizedCommand) {
  const payload = normalized.payload as ReschedulePayload;
  const occurrenceId = targetOf(normalized).id;
  const dueAt = tokyoDateToUtcIso(payload.new_due_on) as string;
  const reschedule = await planReschedule(context.db, context.householdId, {
    dueAt,
    nowIso: context.now.toISOString(),
    occurrenceId,
  }).catch((error: unknown) => mapD1Error(error, {
    DUE_AT_BEFORE_SCHEDULED_FOR: () => invalidInput("payload.new_due_on", "before_scheduled_on"),
    DUE_AT_NOT_IN_FUTURE: () => invalidInput("payload.new_due_on", "must_be_after_today"),
    MANUAL_TODO_HAS_NO_SCHEDULE: () => invalidInput("target", "manual_todo_has_no_due"),
    OCCURRENCE_NOT_FOUND: () => new CommandError("not_found"),
    OCCURRENCE_NOT_PENDING: () => new CommandError("already_resolved", {
      currentState: { occurrence_id: occurrenceId, status: "not_pending" },
    }),
    UNDATED_OCCURRENCE_NOT_POSTPONABLE: () => invalidInput("target", "undated_occurrence"),
  }));
  const { occurrence } = reschedule;
  const before = scheduleView({ dueAt: occurrence.due_at, scheduledFor: occurrence.scheduled_for });
  const after = scheduleView({ dueAt, scheduledFor: occurrence.scheduled_for });
  return {
    build({ businessKey, recordedAt }: { businessKey: string; recordedAt: string }) {
      const logId = crypto.randomUUID();
      const business = reschedulePlanStatements(context.db, reschedule, {
        actorId: context.userId,
        householdId: context.householdId,
        idempotencyKey: businessKey,
        logId,
        recordedAt,
      });
      const result = {
        ...after,
        detail_url: todoDetailUrl(occurrenceId),
        history_id: logId,
        occurrence_id: occurrenceId,
        recorded_at: recordedAt,
      };
      return { ...business, result, revisionEntity: { id: occurrenceId, kind: "todo_occurrence" as const } };
    },
    preview: {
      affected_entities: [{ change: "reschedule", id: occurrenceId, kind: "todo_occurrence", title: reschedule.title }],
      diff: { due_on: { from: before.due_on, to: after.due_on } },
      // 次回以降の予定・必達日は変わらない。
      schedule_effect: {
        current_occurrence: after,
        previous: before,
        recurrence: recurrenceName(occurrence.recurrence_basis),
      },
    },
  };
}

export const todoRescheduleHandler: CommandHandler = { normalize, plan };
