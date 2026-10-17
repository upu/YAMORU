import { calendarScheduleWithNulls } from "../../../app/todos/calendar-schedule-input";
import { completionFirstWindow, recommendedOffsets } from "../../../app/todos/recurrence-input";
import { tokyoDateToUtcIso } from "../../../app/time-zone";
import {
  addTokyoCalendarDate,
  calendarScheduledForOnOrAfter,
  calendarScheduleFromInput,
  intervalScheduledForOnOrAfter,
  tokyoDateFromIso,
} from "../../../lib/d1/calendar";
import { planTodoCreation, todoCreationStatements, type TodoCreationPlan } from "../../../lib/d1/todos/command-creation";
import {
  calendarTaskInsert,
  intervalTaskInsert,
  maintenanceTaskInsert,
  manualTaskInsert,
  oneTimeTaskInsert,
  type CalendarTaskInput,
  type TaskInsert,
} from "../../../lib/d1/todos/creation";
import { invalidInput, type NormalizedCommand } from "./contract";
import {
  mapD1Error,
  recurrenceName,
  scheduleView,
  todoDetailUrl,
  type CommandContext,
  type CommandHandler,
} from "./handler";
import { calendarCondition, createPayload, type CreatePayload, type CreateRecurrence } from "./todo-create-input";

// todo.create: TaskRuleと最初のOccurrenceを一つのbatchで作る。保存形はWebの
// 登録と同じ関数で作り、previewでは方式ごとの次回の決まり方を示す。
// 「毎週土曜」は暦で次が決まり、「実施から7日後」は実施日で次が決まる。

function invariant<T>(value: T | null, message: string): T {
  if (value === null) throw new Error(message);
  return value;
}

function calendarInput(payload: CreatePayload, recurrence: Extract<CreateRecurrence, { type: "calendar" }>): CalendarTaskInput {
  return { ...basics(payload), ...calendarScheduleWithNulls(calendarCondition(recurrence)) };
}

function basics(payload: CreatePayload) {
  return {
    managedItemId: payload.managed_item_id,
    mustCompleteBy: payload.must_complete_by,
    note: payload.note,
    title: payload.title,
  };
}

function completionInsert(payload: CreatePayload, recurrence: Extract<CreateRecurrence, { type: "completion" }>): TaskInsert {
  const offsets = invariant(recommendedOffsets(recurrence.unit, recurrence.min, recurrence.max), "normalized offsets");
  const window = invariant(completionFirstWindow(offsets, recurrence.first.mode, recurrence.first.on), "normalized window");
  return maintenanceTaskInsert({ ...basics(payload), ...offsets, ...window });
}

// 正規化したpayloadから保存形を作る。「今日」はprepare時刻(reference_at)に
// 固定し、commitで計算し直しても同じ初回予定になる。
export function taskInsert(payload: CreatePayload): TaskInsert {
  const now = new Date(payload.reference_at);
  const recurrence = payload.recurrence;
  const insert = ((): TaskInsert => {
    switch (recurrence.type) {
      case "one_time":
        return oneTimeTaskInsert({
          ...basics(payload),
          scheduledFor: recurrence.scheduled_on === null ? null : tokyoDateToUtcIso(recurrence.scheduled_on),
        });
      case "manual": return manualTaskInsert(basics(payload));
      case "completion": return completionInsert(payload, recurrence);
      case "calendar": return calendarTaskInsert(calendarInput(payload, recurrence), now);
      case "interval":
        return intervalTaskInsert({
          ...basics(payload),
          intervalAnchorOn: recurrence.start_on,
          intervalCount: recurrence.count,
          intervalUnit: recurrence.unit,
        }, now);
    }
  })();
  return { ...insert, assigneeUserId: payload.assignee_id };
}

// 予定どおりに進んだ場合の2回目の予定。暦で決まる方式だけが持ち、実施日で
// 決まる方式(completion)や予定を持たない方式は持たない。
function followingScheduledFor(payload: CreatePayload, insert: TaskInsert): string | null {
  if (insert.scheduledFor === null) return null;
  const dayAfter = addTokyoCalendarDate(tokyoDateFromIso(insert.scheduledFor), 1, "day");
  const recurrence = payload.recurrence;
  if (recurrence.type === "calendar") {
    return calendarScheduledForOnOrAfter(calendarScheduleFromInput(calendarInput(payload, recurrence)), dayAfter);
  }
  if (recurrence.type === "interval") {
    return intervalScheduledForOnOrAfter({
      intervalAnchorOn: recurrence.start_on,
      intervalCount: recurrence.count,
      intervalUnit: recurrence.unit,
    }, dayAfter);
  }
  return null;
}

export function scheduleEffect(payload: CreatePayload, insert: TaskInsert) {
  const following = followingScheduledFor(payload, insert);
  const recurrence = payload.recurrence;
  return {
    first_occurrence: scheduleView(insert),
    following_occurrence: following === null ? null : scheduleView({ dueAt: following, scheduledFor: following }),
    next_after_completion: recurrence.type === "completion"
      ? { max: recurrence.max, min: recurrence.min, unit: recurrence.unit }
      : null,
    recurrence: recurrenceName(insert.recurrenceBasis),
  };
}

export function todoDiff(payload: CreatePayload) {
  return {
    assignee_id: payload.assignee_id,
    managed_item_id: payload.managed_item_id,
    must_complete_by: payload.must_complete_by,
    note: payload.note,
    recurrence: payload.recurrence,
    title: payload.title,
  };
}

function preview(payload: CreatePayload, creation: TodoCreationPlan) {
  const affected: Record<string, unknown>[] = [{ change: "create", id: null, kind: "todo_rule", title: payload.title }];
  if (payload.managed_item_id !== null) {
    affected.push({ change: "link", id: payload.managed_item_id, kind: "managed_item", title: creation.managedItemName });
  }
  return {
    affected_entities: affected,
    diff: todoDiff(payload),
    schedule_effect: scheduleEffect(payload, creation.insert),
  };
}

// 登録の文と結果。managed_item_with_todo.createも、作る管理対象へ関連付けた
// creationで同じものを使う。
export function buildTodoCreation(context: CommandContext, payload: CreatePayload, creation: TodoCreationPlan) {
  const ids = { occurrenceId: crypto.randomUUID(), taskRuleId: crypto.randomUUID() };
  return {
    ...todoCreationStatements(context.db, context.householdId, creation, ids),
    occurrenceId: ids.occurrenceId,
    result: {
      detail_url: todoDetailUrl(ids.occurrenceId),
      first_occurrence: { id: ids.occurrenceId, ...scheduleView(creation.insert) },
      recurrence: recurrenceName(creation.insert.recurrenceBasis),
      title: payload.title,
      todo_rule_id: ids.taskRuleId,
    },
  };
}

export async function planTodo(context: CommandContext, payload: CreatePayload): Promise<TodoCreationPlan> {
  return planTodoCreation(context.db, context.householdId, taskInsert(payload))
    .catch((error: unknown) => mapD1Error(error, {
      ASSIGNEE_NOT_FOUND: () => invalidInput("payload.assignee_id", "not_in_household"),
      MANAGED_ITEM_NOT_FOUND: () => invalidInput("payload.managed_item_id", "not_found"),
    }));
}

async function plan(context: CommandContext, normalized: NormalizedCommand) {
  const payload = normalized.payload as CreatePayload;
  const creation = await planTodo(context, payload);
  return {
    build({ recordedAt }: { recordedAt: string }) {
      const { evidence, occurrenceId, result, statements } = buildTodoCreation(context, payload, creation);
      return {
        evidence,
        result: { ...result, recorded_at: recordedAt },
        revisionEntity: { id: occurrenceId, kind: "todo_occurrence" as const },
        statements,
      };
    },
    preview: preview(payload, creation),
  };
}

export const todoCreateHandler: CommandHandler = {
  normalize(context, request) {
    // 新しく作る対象は、まだIDを持たない(5節)。
    if (request.target !== undefined) throw invalidInput("target", "not_allowed_for_create");
    return { command: "todo.create", payload: createPayload(request.payload, context.now), target: null };
  },
  plan,
};
