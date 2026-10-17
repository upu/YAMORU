import {
  isCalendarScheduleInputError,
  parseCalendarScheduleInput,
  WEEK_LAST_FIELD_NAME,
  WEEK_POSITIONS_FIELD_NAME,
  WEEKDAYS_FIELD_NAME,
  type CalendarScheduleCondition,
} from "../../../app/todos/calendar-schedule-input";
import {
  completionFirstWindow,
  intervalCondition,
  isCompletionUnit,
  recommendedOffsets,
} from "../../../app/todos/recurrence-input";
import { TASK_NOTE_MAX_LENGTH, TASK_TITLE_MAX_LENGTH } from "../../../app/todos/todo-input-limits";
import { tokyoDateToUtcIso } from "../../../app/time-zone";
import { CommandError, invalidInput } from "./contract";
import { idValue, objectValue } from "./input";

// todo.createのpayloadを検証し、保存の規則が同じWebの登録と同じ値へ正規化する。
// 繰り返し条件はWebと共通の解釈(calendar-schedule-input.ts・recurrence-input.ts)を
// 使い、未指定の初回予定や間隔を創作しない(5節)。

export type CreateRecurrence =
  | { type: "manual" }
  | { scheduled_on: string | null; type: "one_time" }
  | { count: number; start_on: string; type: "interval"; unit: "day" | "week" }
  | {
      first: { mode: "next_window_start" | "previous_completion"; on: string };
      max: number;
      min: number;
      type: "completion";
      unit: "day" | "month" | "week" | "year";
    }
  | {
      day_of_month: number | null;
      day_of_week: number | null;
      days_of_week: number[];
      kind: CalendarScheduleCondition["scheduleKind"];
      month: number | null;
      month_end: boolean;
      type: "calendar";
      week_last: boolean;
      weeks_of_month: number[];
    };

export type CreatePayload = {
  assignee_id: string | null;
  managed_item_id: string | null;
  must_complete_by: string | null;
  note: string | null;
  // 「今日」を基準に初回予定を決める方式(定例日・固定間隔)のための、prepare時刻。
  reference_at: string;
  recurrence: CreateRecurrence;
  title: string;
};

function missing(field: string): CommandError {
  return new CommandError("missing_required", { fieldErrors: { [field]: "required" } });
}

export function titleValue(value: unknown, field = "payload.title"): string {
  if (value === undefined || value === null) throw missing(field);
  const title = typeof value === "string" ? value.trim() : "";
  if (title.length === 0 || Array.from(title).length > TASK_TITLE_MAX_LENGTH) throw invalidInput(field, "invalid_title");
  return title;
}

// Webの登録と同じく、改行をLFへそろえ、空白だけのメモは未設定にする。
export function noteValue(value: unknown, field = "payload.note"): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw invalidInput(field, "string_required");
  const note = value.replaceAll("\r\n", "\n").trim();
  if (note.length === 0) return null;
  if (Array.from(note).length > TASK_NOTE_MAX_LENGTH) throw invalidInput(field, "too_long");
  return note;
}

export function dateValue(value: unknown, field: string): string {
  if (typeof value !== "string" || tokyoDateToUtcIso(value) === null) throw invalidInput(field, "date_required");
  return value;
}

function optionalDate(value: unknown, field: string): string | null {
  return value === undefined || value === null ? null : dateValue(value, field);
}

export function optionalId(value: unknown, field: string): string | null {
  return value === undefined || value === null ? null : idValue(value, field);
}

export function integerValue(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw invalidInput(field, "integer_required");
  return value;
}

function integerList(value: unknown, field: string): number[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw invalidInput(field, "array_required");
  return value.map((item) => integerValue(item, field));
}

function booleanValue(value: unknown, field: string): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw invalidInput(field, "boolean_required");
  return value;
}

export const CALENDAR_KEYS = ["type", "kind", "days_of_week", "day_of_month", "month_end", "month", "day_of_week", "weeks_of_month", "week_last"];

// Webの登録画面と同じ解釈を通すため、入力欄の形に並べ直して共通の解析へ渡す。
function calendarFormData(value: Record<string, unknown>, field: string): FormData {
  const form = new FormData();
  if (typeof value.kind !== "string") throw missing(`${field}.kind`);
  form.set("scheduleKind", value.kind);
  for (const day of integerList(value.days_of_week, `${field}.days_of_week`)) form.append(WEEKDAYS_FIELD_NAME, String(day));
  for (const week of integerList(value.weeks_of_month, `${field}.weeks_of_month`)) form.append(WEEK_POSITIONS_FIELD_NAME, String(week));
  const single: [string, string][] = [["day_of_month", "scheduleDayOfMonth"], ["month", "scheduleMonth"], ["day_of_week", "scheduleDayOfWeek"]];
  for (const [key, name] of single) {
    if (value[key] !== undefined && value[key] !== null) form.set(name, String(integerValue(value[key], `${field}.${key}`)));
  }
  if (booleanValue(value.month_end, `${field}.month_end`)) form.set("scheduleMonthEnd", "1");
  form.set(WEEK_LAST_FIELD_NAME, booleanValue(value.week_last, `${field}.week_last`) ? "1" : "0");
  return form;
}

export function calendarCondition(recurrence: Extract<CreateRecurrence, { type: "calendar" }>): CalendarScheduleCondition {
  const condition = parseCalendarScheduleInput(calendarFormData({ ...recurrence }, "payload.recurrence"));
  if (isCalendarScheduleInputError(condition)) throw invalidInput("payload.recurrence", condition);
  return condition;
}

export function calendarRecurrence(value: Record<string, unknown>, field: string): CreateRecurrence {
  objectValue(value, field, CALENDAR_KEYS);
  const condition = parseCalendarScheduleInput(calendarFormData(value, field));
  if (isCalendarScheduleInputError(condition)) throw invalidInput(field, condition);
  const nthWeekday = condition.scheduleKind === "monthly_nth_weekday" || condition.scheduleKind === "yearly_nth_weekday";
  return {
    day_of_month: condition.scheduleDayOfMonth ?? null,
    day_of_week: nthWeekday ? condition.scheduleDaysOfWeek?.at(0) ?? null : null,
    days_of_week: nthWeekday ? [] : condition.scheduleDaysOfWeek ?? [],
    kind: condition.scheduleKind,
    month: condition.scheduleMonth ?? null,
    month_end: condition.scheduleMonthEnd,
    type: "calendar",
    week_last: condition.scheduleWeekLast ?? false,
    weeks_of_month: condition.scheduleWeeksOfMonth ?? [],
  };
}

// 前回の実施日(last_completed_on)か、最初の目安の始まり(first_scheduled_on)の
// どちらか一方を必須にする。どちらも無いときに今日などを仮定しない。
function completionRecurrence(value: Record<string, unknown>, field: string): CreateRecurrence {
  objectValue(value, field, ["type", "unit", "min", "max", "last_completed_on", "first_scheduled_on"]);
  if (!isCompletionUnit(value.unit)) throw invalidInput(`${field}.unit`, "day_week_month_or_year");
  const offsets = recommendedOffsets(value.unit, integerValue(value.min, `${field}.min`), integerValue(value.max, `${field}.max`));
  if (offsets === null) throw invalidInput(field, "invalid_range");
  const hasLast = value.last_completed_on !== undefined;
  const hasFirst = value.first_scheduled_on !== undefined;
  if (hasLast === hasFirst) {
    throw hasLast ? invalidInput(field, "last_completed_on_or_first_scheduled_on") : missing(`${field}.first_scheduled_on`);
  }
  const first = hasLast
    ? { mode: "previous_completion" as const, on: dateValue(value.last_completed_on, `${field}.last_completed_on`) }
    : { mode: "next_window_start" as const, on: dateValue(value.first_scheduled_on, `${field}.first_scheduled_on`) };
  if (completionFirstWindow(offsets, first.mode, first.on) === null) throw invalidInput(field, "invalid_first_window");
  return { first, max: offsets.recommendedUntilValue, min: offsets.recommendedStartValue, type: "completion", unit: value.unit };
}

export function intervalRecurrence(value: Record<string, unknown>, field: string, now: Date): CreateRecurrence {
  objectValue(value, field, ["type", "unit", "count", "start_on"]);
  if (value.start_on === undefined) throw missing(`${field}.start_on`);
  const startOn = dateValue(value.start_on, `${field}.start_on`);
  const condition = intervalCondition(value.unit, integerValue(value.count, `${field}.count`), startOn, now);
  if (condition === null) throw invalidInput(field, "invalid_interval");
  return { count: condition.intervalCount, start_on: startOn, type: "interval", unit: condition.intervalUnit };
}

function recurrenceValue(value: unknown, now: Date): CreateRecurrence {
  const field = "payload.recurrence";
  if (value === undefined || value === null) throw missing(field);
  const recurrence = objectValue(value, field, CALENDAR_KEYS.concat(["scheduled_on", "unit", "min", "max", "last_completed_on", "first_scheduled_on", "count", "start_on"]));
  switch (recurrence.type) {
    case "manual":
      objectValue(recurrence, field, ["type"]);
      return { type: "manual" };
    case "one_time":
      objectValue(recurrence, field, ["type", "scheduled_on"]);
      return { scheduled_on: optionalDate(recurrence.scheduled_on, `${field}.scheduled_on`), type: "one_time" };
    case "completion": return completionRecurrence(recurrence, field);
    case "calendar": return calendarRecurrence(recurrence, field);
    case "interval": return intervalRecurrence(recurrence, field, now);
    default: throw invalidInput(`${field}.type`, "one_time_manual_completion_calendar_or_interval");
  }
}

export function createPayload(payload: unknown, now: Date): CreatePayload {
  const value = objectValue(payload ?? {}, "payload", [
    "title", "recurrence", "managed_item_id", "note", "assignee_id", "must_complete_by",
  ]);
  return {
    assignee_id: optionalId(value.assignee_id, "payload.assignee_id"),
    managed_item_id: optionalId(value.managed_item_id, "payload.managed_item_id"),
    must_complete_by: optionalDate(value.must_complete_by, "payload.must_complete_by"),
    note: noteValue(value.note),
    recurrence: recurrenceValue(value.recurrence, now),
    reference_at: now.toISOString(),
    title: titleValue(value.title),
  };
}
