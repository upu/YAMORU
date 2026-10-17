import { isCompletionUnit, recommendedOffsets } from "../../../app/todos/recurrence-input";
import { CommandError, invalidInput } from "./contract";
import { objectValue } from "./input";
import {
  CALENDAR_KEYS,
  calendarRecurrence,
  dateValue,
  integerValue,
  intervalRecurrence,
  noteValue,
  optionalId,
  titleValue,
  type CreateRecurrence,
} from "./todo-create-input";

// todo.updateのpayloadを検証する。edit_scopeは対象の繰り返し方式に合うものだけを
// 受け付け(planで確認)、指定した項目だけを持つ変更へ正規化する。nullは未設定へ
// 戻すことを表す。値の規則はtodo.create・Webの編集と同じものを使う(5節)。

export type EditScope = "current_occurrence" | "future_rule" | "manual_combined" | "one_time_combined";

export type RuleRecurrence =
  | Extract<CreateRecurrence, { type: "calendar" | "interval" }>
  | { max: number; min: number; type: "completion"; unit: "day" | "month" | "week" | "year" };

export type RuleChanges = {
  managed_item_id?: string | null;
  note?: string | null;
  recurrence?: RuleRecurrence;
  title?: string;
};

export type OccurrenceChanges = {
  assignee_id?: string | null;
  due_on?: string;
  must_complete_by?: string | null;
  scheduled_on?: string | null;
};

export type TodoUpdatePayload = {
  edit_scope: EditScope;
  occurrence_changes: OccurrenceChanges;
  rule_changes: RuleChanges;
};

const SCOPES: readonly EditScope[] = ["current_occurrence", "future_rule", "manual_combined", "one_time_combined"];

function has(value: Record<string, unknown>, key: string): boolean {
  return value[key] !== undefined;
}

function nullableDate(value: unknown, field: string): string | null {
  return value === null ? null : dateValue(value, field);
}

function completionRecurrence(value: Record<string, unknown>, field: string): RuleRecurrence {
  objectValue(value, field, ["type", "unit", "min", "max"]);
  if (!isCompletionUnit(value.unit)) throw invalidInput(`${field}.unit`, "day_week_month_or_year");
  const offsets = recommendedOffsets(value.unit, integerValue(value.min, `${field}.min`), integerValue(value.max, `${field}.max`));
  if (offsets === null) throw invalidInput(field, "invalid_range");
  return { max: offsets.recommendedUntilValue, min: offsets.recommendedStartValue, type: "completion", unit: value.unit };
}

// 繰り返し条件の変更は、同じ方式の中での条件の置き換えだけ。方式の変更はplanで拒否する。
function ruleRecurrence(value: unknown, field: string, now: Date): RuleRecurrence {
  const recurrence = objectValue(value, field, CALENDAR_KEYS.concat(["unit", "min", "max", "count", "start_on"]));
  switch (recurrence.type) {
    case "calendar": return calendarRecurrence(recurrence, field) as Extract<CreateRecurrence, { type: "calendar" }>;
    case "completion": return completionRecurrence(recurrence, field);
    case "interval": return intervalRecurrence(recurrence, field, now) as Extract<CreateRecurrence, { type: "interval" }>;
    default: throw invalidInput(`${field}.type`, "calendar_completion_or_interval");
  }
}

function ruleChanges(value: unknown, field: string, keys: string[], now: Date): RuleChanges {
  const changes = objectValue(value, field, keys);
  const result: RuleChanges = {};
  if (has(changes, "title")) result.title = titleValue(changes.title, `${field}.title`);
  if (has(changes, "managed_item_id")) result.managed_item_id = optionalId(changes.managed_item_id, `${field}.managed_item_id`);
  if (has(changes, "note")) result.note = noteValue(changes.note, `${field}.note`);
  if (has(changes, "recurrence")) result.recurrence = ruleRecurrence(changes.recurrence, `${field}.recurrence`, now);
  return result;
}

function occurrenceChanges(value: unknown, field: string, keys: string[]): OccurrenceChanges {
  const changes = objectValue(value, field, keys);
  const result: OccurrenceChanges = {};
  if (has(changes, "assignee_id")) result.assignee_id = optionalId(changes.assignee_id, `${field}.assignee_id`);
  if (has(changes, "due_on")) result.due_on = dateValue(changes.due_on, `${field}.due_on`);
  if (has(changes, "must_complete_by")) result.must_complete_by = nullableDate(changes.must_complete_by, `${field}.must_complete_by`);
  if (has(changes, "scheduled_on")) result.scheduled_on = nullableDate(changes.scheduled_on, `${field}.scheduled_on`);
  return result;
}

function scopeValue(value: unknown): EditScope {
  if (value === undefined || value === null) {
    throw new CommandError("missing_required", { fieldErrors: { "payload.edit_scope": "required" } });
  }
  if (!SCOPES.includes(value as EditScope)) throw invalidInput("payload.edit_scope", "unknown_scope");
  return value as EditScope;
}

function changesOf(scope: EditScope, value: Record<string, unknown>, now: Date) {
  switch (scope) {
    case "current_occurrence":
      objectValue(value, "payload", ["edit_scope", "changes"]);
      return {
        occurrence_changes: occurrenceChanges(value.changes ?? {}, "payload.changes", ["assignee_id", "due_on", "must_complete_by"]),
        rule_changes: {},
      };
    case "future_rule":
      objectValue(value, "payload", ["edit_scope", "changes"]);
      return {
        occurrence_changes: {},
        rule_changes: ruleChanges(value.changes ?? {}, "payload.changes", ["title", "managed_item_id", "note", "recurrence"], now),
      };
    default: {
      objectValue(value, "payload", ["edit_scope", "rule_changes", "occurrence_changes"]);
      // 一回限りだけが予定日(具体日または未定)を持つ。必要時Todoへ日付を設定しない。
      const occurrenceKeys = scope === "one_time_combined"
        ? ["assignee_id", "must_complete_by", "scheduled_on"]
        : ["assignee_id", "must_complete_by"];
      return {
        occurrence_changes: occurrenceChanges(value.occurrence_changes ?? {}, "payload.occurrence_changes", occurrenceKeys),
        rule_changes: ruleChanges(value.rule_changes ?? {}, "payload.rule_changes", ["title", "managed_item_id", "note"], now),
      };
    }
  }
}

export function todoUpdatePayload(payload: unknown, now: Date): TodoUpdatePayload {
  const value = objectValue(payload ?? {}, "payload", ["edit_scope", "changes", "rule_changes", "occurrence_changes"]);
  const scope = scopeValue(value.edit_scope);
  const changes = changesOf(scope, value, now);
  if (Object.keys(changes.occurrence_changes).length + Object.keys(changes.rule_changes).length === 0) {
    const field = scope === "current_occurrence" || scope === "future_rule" ? "payload.changes" : "payload";
    throw new CommandError("missing_required", { fieldErrors: { [field]: "at_least_one_change" } });
  }
  return { edit_scope: scope, ...changes };
}
