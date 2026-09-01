"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getD1Context } from "../../../lib/d1/context";
import {
  type RecurringTaskRuleUpdate,
  updateOneTimeTodo,
  updateRecurringOccurrence as updateRecurringOccurrenceInD1,
  updateRecurringTaskRule,
} from "../../../lib/d1/todos";
import type { MaintenanceTodoActionState } from "../../managed-items/[id]/state";
import { getTokyoDayDistance, tokyoDateToUtcIso } from "../../time-zone";

const TASK_TITLE_MAX_LENGTH = 100;
const COMPLETION_UNIT_DAYS = { day: 1, week: 7 } as const;
const MAX_COMPLETION_VALUE = { day: 3650, month: 120, week: 520, year: 10 } as const;
const MAX_INTERVAL_COUNT = { day: 3650, week: 520 } as const;

type ParsedTodoEditForm =
  | {
      assigneeUserId: string | null;
      managedItemId: string | null;
      occurrenceId: string;
      scheduledFor: string | null;
      status: "ok";
      title: string;
    }
  | MaintenanceTodoActionState;

function optionalId(formData: FormData, field: string): string | null {
  const raw = formData.get(field);
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return value.length === 0 ? null : value;
}

// 予定日は空欄を「未定」として受け取る(YDR-030)。日付の解釈はTodo登録・
// 予定日変更と同じくAsia/Tokyoの暦日に揃える。
function parseSchedule(
  formData: FormData,
): { status: "ok"; value: string | null } | MaintenanceTodoActionState {
  const raw = formData.get("plannedDate");
  if (typeof raw !== "string") {
    return { message: "予定日を正しく入力してください。", status: "error" };
  }
  if (raw === "") return { status: "ok", value: null };
  const scheduledFor = tokyoDateToUtcIso(raw);
  if (scheduledFor === null) {
    return { message: "予定日を正しく入力してください。", status: "error" };
  }
  return { status: "ok", value: scheduledFor };
}

function parseTodoEditForm(formData: FormData): ParsedTodoEditForm {
  const occurrenceId = optionalId(formData, "id");
  if (occurrenceId === null) {
    return { message: "対象のTodoを特定できませんでした。", status: "error" };
  }

  const rawTitle = formData.get("title");
  const title = typeof rawTitle === "string" ? rawTitle.trim() : "";
  if (title.length === 0 || Array.from(title).length > TASK_TITLE_MAX_LENGTH) {
    return {
      message: "Todo名は1文字以上100文字以内で入力してください。",
      status: "error",
    };
  }

  const schedule = parseSchedule(formData);
  if (schedule.status !== "ok") return schedule;

  return {
    assigneeUserId: optionalId(formData, "assigneeUserId"),
    managedItemId: optionalId(formData, "managedItemId"),
    occurrenceId,
    scheduledFor: schedule.value,
    status: "ok",
    title,
  };
}

const EDIT_ERROR_RULES: { fragment: string; message: string }[] = [
  {
    fragment: "Assignee not found",
    message: "担当者を指定できませんでした。同じ家庭のメンバーから選び直してください。",
  },
  {
    fragment: "Managed item not found",
    message: "関連する管理対象を指定できませんでした。同じ家庭の管理対象から選び直してください。",
  },
  {
    fragment: "Only one-time tasks can be edited",
    message: "繰り返しTodoの内容はこの画面から変更できません。",
  },
  {
    fragment: "Occurrence already exists for the schedule",
    message: "その予定日には同じTodoの別の予定があります。別の日付を指定してください。",
  },
  {
    fragment: "Occurrence not found",
    message: "対象のTodoが見つかりませんでした。最新の状態を確認してください。",
  },
  {
    fragment: "Occurrence is not pending",
    message: "他の操作で状態が変わりました。最新の状態を確認してください。",
  },
];

function mapEditError(error: unknown): MaintenanceTodoActionState {
  const message = error instanceof Error ? error.message : "";
  const matched = EDIT_ERROR_RULES.find((rule) => message.includes(rule.fragment));
  return matched === undefined
    ? { message: "Todoを更新できませんでした。時間をおいて再度お試しください。", status: "error" }
    : { message: matched.message, status: "error" };
}

// 保存後に反映する画面。ホーム(#36)、Todo一覧(#201)、Todo詳細と
// 編集画面、そして関連ManagedItemの詳細を、変更前後の両方について再検証する。
function revalidateTodoEditViews(
  occurrenceId: string,
  managedItemIds: (string | null)[],
): void {
  revalidatePath("/");
  revalidatePath("/todos");
  revalidatePath(`/todos/${encodeURIComponent(occurrenceId)}`);
  revalidatePath(`/todos/${encodeURIComponent(occurrenceId)}/edit`);
  for (const managedItemId of new Set(managedItemIds)) {
    if (managedItemId !== null) {
      revalidatePath(`/managed-items/${encodeURIComponent(managedItemId)}`);
    }
  }
}

// Issue #203: 繰り返しなしTodoの名前・関連ManagedItem・担当者・予定日を保存する。
// 対象のOccurrence IDはフォームの隠しフィールド(id)から受け取る
// (updateManagedItemと同じ、useActionStateのaction型を崩さない方式)。
// 他家庭のTodo・ManagedItem・メンバーはD1側が拒否する。
export async function updateTodo(
  _previousState: MaintenanceTodoActionState,
  formData: FormData,
): Promise<MaintenanceTodoActionState> {
  const parsed = parseTodoEditForm(formData);
  if (parsed.status !== "ok") return parsed;

  let previousManagedItemId: string | null;
  try {
    const { db, session } = await getD1Context();
    ({ previousManagedItemId } = await updateOneTimeTodo(db, session, parsed.occurrenceId, {
      assigneeUserId: parsed.assigneeUserId,
      managedItemId: parsed.managedItemId,
      scheduledFor: parsed.scheduledFor,
      title: parsed.title,
    }));
  } catch (error) {
    return mapEditError(error);
  }

  revalidateTodoEditViews(parsed.occurrenceId, [
    previousManagedItemId,
    parsed.managedItemId,
  ]);
  redirect(`/todos/${encodeURIComponent(parsed.occurrenceId)}`);
}

function parseIntegerField(
  formData: FormData,
  field: string,
  minimum: number,
  maximum: number,
): number | null {
  const raw = formData.get(field);
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : null;
}

function recurringEditError(error: unknown): MaintenanceTodoActionState {
  const message = error instanceof Error ? error.message : "";
  const rules: { fragment: string; message: string }[] = [
    { fragment: "Assignee not found", message: "担当者を指定できませんでした。同じ家庭のメンバーから選び直してください。" },
    { fragment: "Managed item not found", message: "関連する管理対象を指定できませんでした。同じ家庭の管理対象から選び直してください。" },
    { fragment: "Occurrence not found", message: "対象のTodoが見つかりませんでした。最新の状態を確認してください。" },
    { fragment: "Occurrence is not pending", message: "他の操作で状態が変わりました。最新の状態を確認してください。" },
    { fragment: "Recurrence basis cannot be changed", message: "繰り返し方は変更できません。現在の方式の条件を編集してください。" },
    { fragment: "new_due_at must be in the future", message: "現在の期限は今日より後の日付を指定してください。" },
    { fragment: "new_due_at must not be before scheduled_for", message: "現在の期限は本来の予定日以降を指定してください。" },
  ];
  const matched = rules.find((rule) => message.includes(rule.fragment));
  return matched === undefined
    ? { message: "Todoを更新できませんでした。時間をおいて再度お試しください。", status: "error" }
    : { message: matched.message, status: "error" };
}

function recurringBasics(
  formData: FormData,
): {
  managedItemId: string | null;
  occurrenceId: string;
  recurrenceBasis: "calendar" | "completion" | "interval";
  title: string;
} | MaintenanceTodoActionState {
  const occurrenceId = optionalId(formData, "id");
  if (occurrenceId === null) {
    return { message: "対象のTodoを特定できませんでした。", status: "error" };
  }
  const rawTitle = formData.get("title");
  const title = typeof rawTitle === "string" ? rawTitle.trim() : "";
  if (title.length === 0 || Array.from(title).length > TASK_TITLE_MAX_LENGTH) {
    return { message: "Todo名は1文字以上100文字以内で入力してください。", status: "error" };
  }
  const recurrenceBasis = formData.get("recurrenceBasis");
  if (
    recurrenceBasis !== "calendar" && recurrenceBasis !== "completion" &&
    recurrenceBasis !== "interval"
  ) {
    return { message: "繰り返し条件を正しく入力してください。", status: "error" };
  }
  return {
    managedItemId: optionalId(formData, "managedItemId"),
    occurrenceId,
    recurrenceBasis,
    title,
  };
}

type CalendarSchedule = Pick<
  Extract<RecurringTaskRuleUpdate, { recurrenceBasis: "calendar" }>,
  | "scheduleDayOfMonth" | "scheduleDayOfWeek" | "scheduleKind"
  | "scheduleMonth" | "scheduleMonthEnd" | "scheduleWeekOfMonth"
>;

function weeklySchedule(formData: FormData): CalendarSchedule | null {
  const weekday = parseIntegerField(formData, "scheduleDayOfWeek", 1, 7);
  return weekday === null ? null : {
    scheduleDayOfMonth: null, scheduleDayOfWeek: weekday, scheduleKind: "weekly",
    scheduleMonth: null, scheduleMonthEnd: false, scheduleWeekOfMonth: null,
  };
}

function monthlyDaySchedule(formData: FormData): CalendarSchedule | null {
  const monthEnd = formData.get("scheduleMonthEnd") === "1";
  const day = monthEnd ? 31 : parseIntegerField(formData, "scheduleDayOfMonth", 1, 31);
  return day === null ? null : {
    scheduleDayOfMonth: day, scheduleDayOfWeek: null, scheduleKind: "monthly_day",
    scheduleMonth: null, scheduleMonthEnd: monthEnd, scheduleWeekOfMonth: null,
  };
}

function monthlyWeekdaySchedule(formData: FormData): CalendarSchedule | null {
  const weekday = parseIntegerField(formData, "scheduleDayOfWeek", 1, 7);
  const week = parseIntegerField(formData, "scheduleWeekOfMonth", 1, 5);
  return weekday === null || week === null ? null : {
    scheduleDayOfMonth: null, scheduleDayOfWeek: weekday,
    scheduleKind: "monthly_nth_weekday", scheduleMonth: null,
    scheduleMonthEnd: false, scheduleWeekOfMonth: week,
  };
}

function yearlySchedule(formData: FormData): CalendarSchedule | null {
  const month = parseIntegerField(formData, "scheduleMonth", 1, 12);
  const day = parseIntegerField(formData, "scheduleDayOfMonth", 1, 31);
  return month === null || day === null ? null : {
    scheduleDayOfMonth: day, scheduleDayOfWeek: null, scheduleKind: "yearly",
    scheduleMonth: month, scheduleMonthEnd: false, scheduleWeekOfMonth: null,
  };
}

function calendarSchedule(formData: FormData, kind: string): CalendarSchedule | null {
  switch (kind) {
    case "weekly": return weeklySchedule(formData);
    case "monthly_day": return monthlyDaySchedule(formData);
    case "monthly_nth_weekday": return monthlyWeekdaySchedule(formData);
    case "yearly": return yearlySchedule(formData);
    default: return null;
  }
}

function calendarRuleInput(
  formData: FormData,
  basics: Exclude<ReturnType<typeof recurringBasics>, MaintenanceTodoActionState>,
): RecurringTaskRuleUpdate | MaintenanceTodoActionState {
  const rawKind = formData.get("scheduleKind");
  const schedule = typeof rawKind === "string" ? calendarSchedule(formData, rawKind) : null;
  if (schedule === null) {
    return { message: "定例パターンを正しく入力してください。", status: "error" };
  }
  return {
    managedItemId: basics.managedItemId,
    recurrenceBasis: "calendar",
    ...schedule,
    title: basics.title,
  };
}

function completionRuleInput(
  formData: FormData,
  basics: Exclude<ReturnType<typeof recurringBasics>, MaintenanceTodoActionState>,
): RecurringTaskRuleUpdate | MaintenanceTodoActionState {
  const unit = formData.get("intervalUnit");
  if (unit !== "day" && unit !== "week" && unit !== "month" && unit !== "year") {
    return { message: "次回の目安を正しく入力してください。", status: "error" };
  }
  const minimum = parseIntegerField(formData, "intervalMin", 0, MAX_COMPLETION_VALUE[unit]);
  const maximum = parseIntegerField(formData, "intervalMax", 0, MAX_COMPLETION_VALUE[unit]);
  if (minimum === null || maximum === null || minimum > maximum) {
    return { message: "次回の目安は0以上の整数で、短い方を長い方以下にしてください。", status: "error" };
  }
  const dayMultiplier = unit === "day" || unit === "week" ? COMPLETION_UNIT_DAYS[unit] : 0;
  return {
    managedItemId: basics.managedItemId,
    recurrenceBasis: "completion",
    recommendedStartOffset: minimum * dayMultiplier,
    recommendedStartValue: minimum,
    recommendedUnit: unit,
    recommendedUntilOffset: maximum * dayMultiplier,
    recommendedUntilValue: maximum,
    title: basics.title,
  };
}

function intervalRuleInput(
  formData: FormData,
  basics: Exclude<ReturnType<typeof recurringBasics>, MaintenanceTodoActionState>,
): RecurringTaskRuleUpdate | MaintenanceTodoActionState {
  const unit = formData.get("fixedIntervalUnit");
  const anchor = formData.get("fixedIntervalAnchorDate");
  if (unit !== "day" && unit !== "week") {
    return { message: "繰り返す間隔と起点日を正しく入力してください。", status: "error" };
  }
  const count = parseIntegerField(formData, "fixedIntervalCount", 1, MAX_INTERVAL_COUNT[unit]);
  const anchorIso = typeof anchor === "string" ? tokyoDateToUtcIso(anchor) : null;
  if (
    count === null || anchorIso === null ||
    Math.abs(getTokyoDayDistance(new Date().toISOString(), anchorIso)) > 3650
  ) {
    return { message: "繰り返す間隔と起点日を正しく入力してください。", status: "error" };
  }
  return {
    intervalAnchorOn: anchor as string,
    intervalCount: count,
    intervalUnit: unit,
    managedItemId: basics.managedItemId,
    recurrenceBasis: "interval",
    title: basics.title,
  };
}

function parseRecurringRule(
  formData: FormData,
): { input: RecurringTaskRuleUpdate; occurrenceId: string; status: "ok" } | MaintenanceTodoActionState {
  const basics = recurringBasics(formData);
  if ("status" in basics) return basics;
  const input = basics.recurrenceBasis === "calendar"
    ? calendarRuleInput(formData, basics)
    : basics.recurrenceBasis === "completion"
      ? completionRuleInput(formData, basics)
      : intervalRuleInput(formData, basics);
  return "status" in input ? input : { input, occurrenceId: basics.occurrenceId, status: "ok" };
}

export async function updateRecurringOccurrence(
  _previousState: MaintenanceTodoActionState,
  formData: FormData,
): Promise<MaintenanceTodoActionState> {
  const occurrenceId = optionalId(formData, "id");
  const rawDueDate = formData.get("dueDate");
  const dueAt = typeof rawDueDate === "string" ? tokyoDateToUtcIso(rawDueDate) : null;
  if (occurrenceId === null || dueAt === null) {
    return { message: "現在の期限を正しく入力してください。", status: "error" };
  }
  let managedItemId: string | null;
  try {
    const { db, session } = await getD1Context();
    ({ managedItemId } = await updateRecurringOccurrenceInD1(db, session, occurrenceId, {
      assigneeUserId: optionalId(formData, "assigneeUserId"),
      dueAt,
    }));
  } catch (error) {
    return recurringEditError(error);
  }
  revalidateTodoEditViews(occurrenceId, [managedItemId]);
  redirect(`/todos/${encodeURIComponent(occurrenceId)}`);
}

export async function updateRecurringRule(
  _previousState: MaintenanceTodoActionState,
  formData: FormData,
): Promise<MaintenanceTodoActionState> {
  const parsed = parseRecurringRule(formData);
  if (parsed.status !== "ok") return parsed;
  let previousManagedItemId: string | null;
  try {
    const { db, session } = await getD1Context();
    ({ previousManagedItemId } = await updateRecurringTaskRule(
      db,
      session,
      parsed.occurrenceId,
      parsed.input,
    ));
  } catch (error) {
    return recurringEditError(error);
  }
  revalidateTodoEditViews(parsed.occurrenceId, [
    previousManagedItemId,
    parsed.input.managedItemId,
  ]);
  redirect(`/todos/${encodeURIComponent(parsed.occurrenceId)}`);
}
