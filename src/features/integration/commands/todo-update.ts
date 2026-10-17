import { calendarScheduleWithNulls } from "../../../app/todos/calendar-schedule-input";
import { recommendedOffsets } from "../../../app/todos/recurrence-input";
import { tokyoDateToUtcIso } from "../../../app/time-zone";
import {
  loadTodoEditCurrent,
  todoUpdateStatements,
  validateTodoUpdate,
  type TodoEditCurrent,
  type TodoUpdatePlan,
} from "../../../lib/d1/todos/command-edits";
import type { RecurringTaskRuleUpdate, RuleBasicsUpdate } from "../../../lib/d1/todos/recurring-edit";
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
import { todoOccurrenceTarget, tokyoDate } from "./input";
import { calendarCondition } from "./todo-create-input";
import { todoUpdatePayload, type EditScope, type RuleChanges, type TodoUpdatePayload } from "./todo-update-input";

// todo.update: 繰り返し方式に合うedit_scopeで、指定した項目だけを変える。
// 暦を持つ方式(calendar/completion/interval)は今回分(current_occurrence)と
// 次回以降の条件(future_rule)を分け、必要時(manual)・一回限り(one_time)は
// Ruleと今回分を一つの操作で変える。方式そのものは変えない(5節)。
// 保存はWebの編集と同じ文で行い、過去の回は変えない。

const SCOPES_BY_BASIS: Record<string, readonly EditScope[]> = {
  calendar: ["current_occurrence", "future_rule"],
  completion: ["current_occurrence", "future_rule"],
  interval: ["current_occurrence", "future_rule"],
  manual: ["manual_combined"],
  once: ["one_time_combined"],
};

function pick<T>(changes: Record<string, unknown>, key: string, current: T): T {
  return changes[key] === undefined ? current : changes[key] as T;
}

function dateIso(date: string | null): string | null {
  return date === null ? null : tokyoDateToUtcIso(date);
}

function ruleBasics(current: TodoEditCurrent, changes: RuleChanges) {
  return {
    managedItemId: pick(changes, "managed_item_id", current.occurrence.managed_item_id),
    note: pick(changes, "note", current.note),
    title: changes.title ?? current.title,
  };
}

// 同じ方式の中での条件の置き換え。入力の解釈はtodo.create・Webの編集と同じ。
function ruleUpdate(current: TodoEditCurrent, changes: RuleChanges): RecurringTaskRuleUpdate | RuleBasicsUpdate {
  const basis = current.occurrence.recurrence_basis as "calendar" | "completion" | "interval";
  const basics = ruleBasics(current, changes);
  const recurrence = changes.recurrence;
  if (recurrence === undefined) return { ...basics, basicsOnly: true, recurrenceBasis: basis };
  if (recurrence.type !== basis) throw invalidInput("payload.changes.recurrence.type", "recurrence_basis_immutable");
  switch (recurrence.type) {
    case "calendar":
      return { ...basics, recurrenceBasis: "calendar", ...calendarScheduleWithNulls(calendarCondition(recurrence)) };
    case "completion": {
      const offsets = recommendedOffsets(recurrence.unit, recurrence.min, recurrence.max);
      if (offsets === null) throw invalidInput("payload.changes.recurrence", "invalid_range");
      return { ...basics, recurrenceBasis: "completion", ...offsets };
    }
    case "interval":
      return {
        ...basics,
        intervalAnchorOn: recurrence.start_on,
        intervalCount: recurrence.count,
        intervalUnit: recurrence.unit,
        recurrenceBasis: "interval",
      };
  }
}

function updatePlan(current: TodoEditCurrent, payload: TodoUpdatePayload): TodoUpdatePlan {
  const { occurrence } = current;
  const changes = payload.occurrence_changes;
  const assigneeUserId = pick(changes, "assignee_id", occurrence.assignee_user_id);
  const mustCompleteBy = pick(changes, "must_complete_by", current.mustCompleteBy);
  switch (payload.edit_scope) {
    case "current_occurrence":
      return {
        current,
        kind: "occurrence",
        mustCompleteBy,
        occurrence: { assigneeUserId, dueAt: changes.due_on === undefined ? occurrence.due_at as string : dateIso(changes.due_on) as string },
      };
    case "future_rule": return { current, kind: "rule", rule: ruleUpdate(current, payload.rule_changes) };
    default:
      return {
        current,
        input: {
          ...ruleBasics(current, payload.rule_changes),
          assigneeUserId,
          scheduledFor: changes.scheduled_on === undefined ? occurrence.scheduled_for : dateIso(changes.scheduled_on),
        },
        kind: "combined",
        mustCompleteBy,
      };
  }
}

function requireScope(current: TodoEditCurrent, scope: EditScope): void {
  const basis = current.occurrence.recurrence_basis;
  if (!(SCOPES_BY_BASIS[basis] ?? []).includes(scope)) {
    throw invalidInput("payload.edit_scope", `not_for_${recurrenceName(basis)}`);
  }
}

function fieldsOf(scope: EditScope) {
  const combined = scope === "manual_combined" || scope === "one_time_combined";
  return { occurrence: combined ? "payload.occurrence_changes" : "payload.changes", rule: combined ? "payload.rule_changes" : "payload.changes" };
}

async function planned(context: CommandContext, occurrenceId: string, payload: TodoUpdatePayload): Promise<TodoUpdatePlan> {
  const fields = fieldsOf(payload.edit_scope);
  const alreadyResolved = () => new CommandError("already_resolved", { currentState: { occurrence_id: occurrenceId, status: "not_pending" } });
  const current = await loadTodoEditCurrent(context.db, context.householdId, occurrenceId)
    .catch((error: unknown) => mapD1Error(error, {
      OCCURRENCE_NOT_FOUND: () => new CommandError("not_found"),
      OCCURRENCE_NOT_PENDING: alreadyResolved,
    }));
  requireScope(current, payload.edit_scope);
  const plan = updatePlan(current, payload);
  await validateTodoUpdate(context.db, context.householdId, plan, context.now.toISOString())
    .catch((error: unknown) => mapD1Error(error, {
      ASSIGNEE_NOT_FOUND: () => invalidInput(`${fields.occurrence}.assignee_id`, "not_in_household"),
      DUE_AT_BEFORE_SCHEDULED_FOR: () => invalidInput(`${fields.occurrence}.due_on`, "before_scheduled_on"),
      DUE_AT_NOT_IN_FUTURE: () => invalidInput(`${fields.occurrence}.due_on`, "must_be_after_today"),
      MANAGED_ITEM_NOT_FOUND: () => invalidInput(`${fields.rule}.managed_item_id`, "not_found"),
      OCCURRENCE_NOT_PENDING: alreadyResolved,
    }));
  return plan;
}

// 変更前後の値。外部の項目名で、実際に変わる項目だけを示す。
function diff(plan: TodoUpdatePlan, payload: TodoUpdatePayload): Record<string, unknown> {
  const { current } = plan;
  const { occurrence } = current;
  const pairs: [string, unknown, unknown][] = [];
  if (plan.kind === "occurrence") {
    pairs.push(["assignee_id", occurrence.assignee_user_id, plan.occurrence.assigneeUserId]);
    pairs.push(["due_on", tokyoDate(occurrence.due_at), tokyoDate(plan.occurrence.dueAt)]);
    pairs.push(["must_complete_by", current.mustCompleteBy, plan.mustCompleteBy]);
  } else {
    const rule = plan.kind === "rule" ? plan.rule : plan.input;
    pairs.push(["title", current.title, rule.title], ["managed_item_id", occurrence.managed_item_id, rule.managedItemId], ["note", current.note, rule.note]);
  }
  if (plan.kind === "combined") {
    pairs.push(["assignee_id", occurrence.assignee_user_id, plan.input.assigneeUserId]);
    pairs.push(["scheduled_on", tokyoDate(occurrence.scheduled_for), tokyoDate(plan.input.scheduledFor)]);
    pairs.push(["must_complete_by", current.mustCompleteBy, plan.mustCompleteBy]);
  }
  const result: Record<string, unknown> = Object.fromEntries(pairs
    .filter(([, from, to]) => from !== to)
    .map(([name, from, to]) => [name, { from, to }]));
  // 条件の置き換えは、変更後の条件を示す(次回以降の予定から適用)。
  if (payload.rule_changes.recurrence !== undefined) result.recurrence = { to: payload.rule_changes.recurrence };
  return result;
}

function after(plan: TodoUpdatePlan) {
  const { occurrence } = plan.current;
  if (plan.kind === "occurrence") return scheduleView({ dueAt: plan.occurrence.dueAt, scheduledFor: occurrence.scheduled_for });
  if (plan.kind === "combined" && plan.input.scheduledFor !== occurrence.scheduled_for) {
    // 一回限りの予定日を変えると、Webと同じく期限も同じ日にそろえる。
    return scheduleView({ dueAt: plan.input.scheduledFor, scheduledFor: plan.input.scheduledFor });
  }
  return scheduleView({ dueAt: occurrence.due_at, scheduledFor: occurrence.scheduled_for });
}

async function plan(context: CommandContext, normalized: NormalizedCommand) {
  const payload = normalized.payload as TodoUpdatePayload;
  const occurrenceId = targetOf(normalized).id;
  const update = await planned(context, occurrenceId, payload);
  const { current } = update;
  const view = after(update);
  return {
    build({ businessKey, recordedAt }: { businessKey: string; recordedAt: string }) {
      const business = todoUpdateStatements(context.db, update, {
        actorId: context.userId, householdId: context.householdId, idempotencyKey: businessKey, recordedAt,
      });
      const result = {
        ...view,
        detail_url: todoDetailUrl(occurrenceId),
        edit_scope: payload.edit_scope,
        occurrence_id: occurrenceId,
        recorded_at: recordedAt,
        todo_rule_id: current.occurrence.task_rule_id,
      };
      return { ...business, result, revisionEntity: { id: occurrenceId, kind: "todo_occurrence" as const } };
    },
    preview: {
      affected_entities: [
        { change: "update", id: occurrenceId, kind: "todo_occurrence", title: current.title },
        ...(payload.edit_scope === "current_occurrence"
          ? []
          : [{ change: "update", id: current.occurrence.task_rule_id, kind: "todo_rule", title: current.title }]),
      ],
      diff: diff(update, payload),
      // future_ruleは今回分の予定を変えず、次回以降の予定に効く。
      schedule_effect: {
        applies_to: payload.edit_scope === "future_rule" ? "future_occurrences" : "current_occurrence",
        current_occurrence: view,
        recurrence: recurrenceName(current.occurrence.recurrence_basis),
      },
    },
  };
}

export const todoUpdateHandler: CommandHandler = {
  normalize(context, request) {
    const target = todoOccurrenceTarget(request.target);
    return { command: "todo.update", payload: todoUpdatePayload(request.payload, context.now), target };
  },
  plan,
};
