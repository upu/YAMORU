import {
  completionPlanStatements,
  loadCurrentCompletion,
  planCompletion,
  type CompletionPlan,
} from "../../../lib/d1/todos/command-plans";
import { CommandError, invalidInput, type NormalizedCommand } from "./contract";
import {
  mapD1Error,
  performerNotFound,
  recurrenceName,
  scheduleView,
  todoDetailUrl,
  type CommandContext,
  type CommandHandler,
} from "./handler";
import { idValue, objectValue, occurredValue, todoOccurrenceTarget, tokyoDate } from "./input";

// todo.complete: 今回分を完了にし、方式に応じて次回を作る。実施日時を省略
// した場合は「今」をprepare時刻へ固定し、previewとcommitで同じ値を使う。

type CompletePayload = {
  date_precision: "day" | "instant";
  occurred_at: string;
  // 実施日時を利用者が指定したか、省略してprepare時刻を使ったか。
  occurred_source: "prepared_at" | "specified";
  performer_id: string;
};

function normalize(context: CommandContext, request: { payload: unknown; target: unknown }): NormalizedCommand {
  const target = todoOccurrenceTarget(request.target);
  const payload = objectValue(request.payload ?? {}, "payload", ["occurred_on", "occurred_at", "performer_id"]);
  const occurred = occurredValue(payload, "payload", context.now);
  const performerId = payload.performer_id === undefined || payload.performer_id === null
    ? context.userId
    : idValue(payload.performer_id, "payload.performer_id");
  const normalized: CompletePayload = {
    date_precision: occurred?.datePrecision ?? "instant",
    occurred_at: occurred?.occurredAt ?? context.now.toISOString(),
    occurred_source: occurred === null ? "prepared_at" : "specified",
    performer_id: performerId,
  };
  return { command: "todo.complete", payload: normalized, target };
}

async function alreadyResolved(context: CommandContext, occurrenceId: string): Promise<CommandError> {
  const current = await loadCurrentCompletion(context.db, context.householdId, occurrenceId);
  return new CommandError("already_resolved", {
    currentState: current === null
      ? { occurrence_id: occurrenceId, status: "not_pending" }
      : {
          completion_log_id: current.completionLogId,
          occurred_at: current.occurredAt,
          occurred_on: tokyoDate(current.occurredAt),
          occurrence_id: occurrenceId,
          performer_id: current.performerId,
          status: "completed",
        },
  });
}

function preview(plan: CompletionPlan, payload: CompletePayload) {
  return {
    affected_entities: [
      { change: "complete", id: plan.occurrence.id, kind: "todo_occurrence", title: plan.title },
    ],
    diff: {
      date_precision: payload.date_precision,
      occurred_at: payload.occurred_at,
      occurred_on: tokyoDate(payload.occurred_at),
      occurred_source: payload.occurred_source,
      performer_id: payload.performer_id,
      status: { from: "pending", to: "completed" },
    },
    schedule_effect: {
      current_occurrence: scheduleView({ dueAt: plan.occurrence.due_at, scheduledFor: plan.occurrence.scheduled_for }),
      next_occurrence: plan.next === null ? null : scheduleView(plan.next),
      recurrence: recurrenceName(plan.occurrence.recurrence_basis),
    },
  };
}

async function plan(context: CommandContext, normalized: NormalizedCommand) {
  const payload = normalized.payload as CompletePayload;
  const occurrenceId = normalized.target.id;
  const completion = await planCompletion(context.db, context.householdId, {
    occurredAt: payload.occurred_at,
    occurrenceId,
    performerId: payload.performer_id,
  }).catch((error: unknown) => mapD1Error(error, {
    OCCURRENCE_NOT_FOUND: () => new CommandError("not_found"),
    NEXT_OCCURRENCE_SCHEDULE_TAKEN: () => invalidInput("payload", "next_schedule_taken"),
    OCCURRENCE_NOT_PENDING: () => alreadyResolved(context, occurrenceId),
    PERFORMER_NOT_FOUND: () => performerNotFound("payload.performer_id"),
  }));
  return {
    build({ businessKey, recordedAt }: { businessKey: string; recordedAt: string }) {
      const logId = crypto.randomUUID();
      const business = completionPlanStatements(context.db, completion, {
        actorId: context.userId,
        householdId: context.householdId,
        idempotencyKey: businessKey,
        logId,
      });
      const result = {
        completion_log_id: logId,
        date_precision: payload.date_precision,
        detail_url: todoDetailUrl(occurrenceId),
        next_occurrence: completion.next === null
          ? null
          : { detail_url: todoDetailUrl(completion.next.id), id: completion.next.id, ...scheduleView(completion.next) },
        occurred_at: payload.occurred_at,
        occurred_on: tokyoDate(payload.occurred_at),
        occurrence_id: occurrenceId,
        performer_id: payload.performer_id,
        recorded_at: recordedAt,
        // 完了直後の次回は誰も触れていないため取り消せる。後から次回が
        // 変更されると、todo.undoはunsafe_undoで拒否する。
        undo_available: true,
      };
      return { ...business, result, revisionEntity: { id: occurrenceId, kind: "todo_occurrence" as const } };
    },
    preview: preview(completion, payload),
  };
}

export const todoCompleteHandler: CommandHandler = { normalize, plan };
