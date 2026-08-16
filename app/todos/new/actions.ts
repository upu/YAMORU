"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "../../../lib/supabase/server";
import type { MaintenanceTodoActionState } from "../../managed-items/[id]/state";
import {
  addDaysToTokyoDateUtcIso,
  tokyoDateToUtcIso,
} from "../../time-zone";

const TASK_TITLE_MAX_LENGTH = 100;
const MAX_RECOMMENDED_OFFSET = 3650;
const INTERVAL_UNIT_DAYS = { day: 1, week: 7 } as const;
const INVALID_OFFSETS: MaintenanceTodoActionState = {
  message: "次回の目安は0以上の整数で、短い方を長い方以下にしてください。",
  status: "error",
};
const INVALID_WINDOW: MaintenanceTodoActionState = {
  message: "初回の計算に使う有効な日付を入力してください。",
  status: "error",
};

type TodoBasics = {
  managedItemId: string | null;
  recurrenceBasis: "calendar" | "completion" | "once";
  title: string;
};
type OneTimeTodoInput = TodoBasics & {
  recurrenceBasis: "once";
  scheduledFor: string;
};
type CompletionTodoInput = TodoBasics & {
  firstDueAt: string;
  firstScheduledFor: string;
  recurrenceBasis: "completion";
  recommendedStartOffset: number;
  recommendedUntilOffset: number;
};
type RecommendedOffsets = {
  recommendedStartOffset: number;
  recommendedUntilOffset: number;
};
type CalendarTodoInput = TodoBasics & {
  recurrenceBasis: "calendar";
  scheduleDayOfMonth?: number;
  scheduleDayOfWeek?: number;
  scheduleKind: "monthly_day" | "monthly_nth_weekday" | "weekly" | "yearly";
  scheduleMonth?: number;
  scheduleWeekOfMonth?: number;
};
const INVALID_CALENDAR_SCHEDULE: MaintenanceTodoActionState = {
  message: "定例日の指定を正しく入力してください。",
  status: "error",
};

function invalidTitle(): MaintenanceTodoActionState {
  return {
    message: "Todo名は1文字以上100文字以内で入力してください。",
    status: "error",
  };
}

function parseTodoBasics(
  formData: FormData,
): TodoBasics | MaintenanceTodoActionState {
  const rawTitle = formData.get("title");
  if (typeof rawTitle !== "string") return invalidTitle();

  const title = rawTitle.trim();
  if (title.length === 0 || Array.from(title).length > TASK_TITLE_MAX_LENGTH) {
    return invalidTitle();
  }

  const recurrenceBasis = formData.get("recurrenceBasis");
  if (
    recurrenceBasis !== "calendar" &&
    recurrenceBasis !== "completion" &&
    recurrenceBasis !== "once"
  ) {
    return { message: "繰り返し方を選択してください。", status: "error" };
  }

  const rawManagedItemId = formData.get("managedItemId");
  const managedItemId = typeof rawManagedItemId === "string"
    ? rawManagedItemId.trim() || null
    : null;
  return { managedItemId, recurrenceBasis, title };
}

function parseBoundedInteger(
  value: FormDataEntryValue | null,
  minimum: number,
  maximum: number,
): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : null;
}

function isValidYearlyDate(month: number, day: number): boolean {
  const candidate = new Date(Date.UTC(2000, month - 1, day));
  return candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day;
}

function parseCalendarTodo(
  basics: TodoBasics,
  formData: FormData,
): CalendarTodoInput | MaintenanceTodoActionState {
  const scheduleKind = formData.get("scheduleKind");
  const dayOfWeek = parseBoundedInteger(formData.get("scheduleDayOfWeek"), 1, 7);
  const dayOfMonth = parseBoundedInteger(formData.get("scheduleDayOfMonth"), 1, 31);
  const weekOfMonth = parseBoundedInteger(formData.get("scheduleWeekOfMonth"), 1, 5);
  const month = parseBoundedInteger(formData.get("scheduleMonth"), 1, 12);

  if (scheduleKind === "weekly" && dayOfWeek !== null) {
    return { ...basics, recurrenceBasis: "calendar", scheduleDayOfWeek: dayOfWeek, scheduleKind };
  }
  if (scheduleKind === "monthly_day" && dayOfMonth !== null) {
    return { ...basics, recurrenceBasis: "calendar", scheduleDayOfMonth: dayOfMonth, scheduleKind };
  }
  if (scheduleKind === "monthly_nth_weekday" && dayOfWeek !== null && weekOfMonth !== null) {
    return {
      ...basics,
      recurrenceBasis: "calendar",
      scheduleDayOfWeek: dayOfWeek,
      scheduleKind,
      scheduleWeekOfMonth: weekOfMonth,
    };
  }
  if (
    scheduleKind === "yearly" && month !== null && dayOfMonth !== null &&
    isValidYearlyDate(month, dayOfMonth)
  ) {
    return {
      ...basics,
      recurrenceBasis: "calendar",
      scheduleDayOfMonth: dayOfMonth,
      scheduleKind,
      scheduleMonth: month,
    };
  }
  return INVALID_CALENDAR_SCHEDULE;
}

function parseOneTimeTodo(
  basics: TodoBasics,
  formData: FormData,
): OneTimeTodoInput | MaintenanceTodoActionState {
  const plannedDate = formData.get("plannedDate");
  const scheduledFor = typeof plannedDate === "string"
    ? tokyoDateToUtcIso(plannedDate)
    : null;
  if (scheduledFor === null) {
    return { message: "予定日を正しく入力してください。", status: "error" };
  }
  return { ...basics, recurrenceBasis: "once", scheduledFor };
}

function parseOffset(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const offset = Number(value);
  return Number.isSafeInteger(offset) ? offset : null;
}

function parseRecommendedOffsets(
  formData: FormData,
): RecommendedOffsets | MaintenanceTodoActionState {
  const intervalMin = parseOffset(formData.get("intervalMin"));
  const intervalMax = parseOffset(formData.get("intervalMax"));
  const rawUnit = formData.get("intervalUnit");
  if (
    intervalMin === null ||
    intervalMax === null ||
    (rawUnit !== "day" && rawUnit !== "week")
  ) {
    return INVALID_OFFSETS;
  }

  const multiplier = INTERVAL_UNIT_DAYS[rawUnit];
  const recommendedStartOffset = intervalMin * multiplier;
  const recommendedUntilOffset = intervalMax * multiplier;
  if (
    recommendedStartOffset > recommendedUntilOffset ||
    recommendedUntilOffset > MAX_RECOMMENDED_OFFSET
  ) {
    return INVALID_OFFSETS;
  }
  return { recommendedStartOffset, recommendedUntilOffset };
}

function parseCompletionTodo(
  basics: TodoBasics,
  formData: FormData,
): CompletionTodoInput | MaintenanceTodoActionState {
  const offsets = parseRecommendedOffsets(formData);
  if ("status" in offsets) return offsets;

  const mode = formData.get("initialDateMode");
  if (mode !== "previous_completion" && mode !== "next_window_start") {
    return { message: "初回の決め方を選択してください。", status: "error" };
  }

  const anchorDate = formData.get("anchorDate");
  if (typeof anchorDate !== "string") return INVALID_WINDOW;
  const startDays = mode === "previous_completion"
    ? offsets.recommendedStartOffset
    : 0;
  const dueDays = mode === "previous_completion"
    ? offsets.recommendedUntilOffset
    : offsets.recommendedUntilOffset - offsets.recommendedStartOffset;
  const firstScheduledFor = addDaysToTokyoDateUtcIso(anchorDate, startDays);
  const firstDueAt = addDaysToTokyoDateUtcIso(anchorDate, dueDays);
  if (firstScheduledFor === null || firstDueAt === null) return INVALID_WINDOW;

  return {
    ...basics,
    ...offsets,
    firstDueAt,
    firstScheduledFor,
    recurrenceBasis: "completion",
  };
}

function parseTodo(
  formData: FormData,
): CalendarTodoInput | CompletionTodoInput | OneTimeTodoInput | MaintenanceTodoActionState {
  const basics = parseTodoBasics(formData);
  if ("status" in basics) return basics;
  if (basics.recurrenceBasis === "once") return parseOneTimeTodo(basics, formData);
  if (basics.recurrenceBasis === "completion") {
    return parseCompletionTodo(basics, formData);
  }
  return parseCalendarTodo(basics, formData);
}

function calendarRpcArguments(input: CalendarTodoInput) {
  switch (input.scheduleKind) {
    case "weekly":
      return { schedule_day_of_week: input.scheduleDayOfWeek, schedule_kind: input.scheduleKind };
    case "monthly_day":
      return { schedule_day_of_month: input.scheduleDayOfMonth, schedule_kind: input.scheduleKind };
    case "monthly_nth_weekday":
      return {
        schedule_day_of_week: input.scheduleDayOfWeek,
        schedule_kind: input.scheduleKind,
        schedule_week_of_month: input.scheduleWeekOfMonth,
      };
    case "yearly":
      return {
        schedule_day_of_month: input.scheduleDayOfMonth,
        schedule_kind: input.scheduleKind,
        schedule_month: input.scheduleMonth,
      };
  }
}

function revalidateTodoPages(managedItemId: string | null): void {
  revalidatePath("/");
  revalidatePath("/todos/new");
  if (managedItemId !== null) {
    revalidatePath(`/managed-items/${encodeURIComponent(managedItemId)}`);
  }
}

export async function createTodo(
  _previousState: MaintenanceTodoActionState,
  formData: FormData,
): Promise<MaintenanceTodoActionState> {
  const input = parseTodo(formData);
  if ("status" in input) return input;

  const supabase = await createClient();
  const itemArgument = input.managedItemId === null
    ? {}
    : { item_id: input.managedItemId };
  let response;
  if (input.recurrenceBasis === "once") {
    response = await supabase.rpc("create_one_time_task", {
        ...itemArgument,
        scheduled_for: input.scheduledFor,
        task_title: input.title,
      });
  } else if (input.recurrenceBasis === "completion") {
    response = await supabase.rpc("create_maintenance_task", {
        ...itemArgument,
        first_due_at: input.firstDueAt,
        first_scheduled_for: input.firstScheduledFor,
        recommended_start_offset: input.recommendedStartOffset,
        recommended_until_offset: input.recommendedUntilOffset,
        task_title: input.title,
      });
  } else {
    response = await supabase.rpc("create_calendar_task", {
      ...itemArgument,
      ...calendarRpcArguments(input),
      task_title: input.title,
    });
  }

  const data: unknown = response.data;
  const error: unknown = response.error;
  if (error !== null || typeof data !== "string") {
    return {
      message: "Todoを登録できませんでした。時間をおいて再度お試しください。",
      status: "error",
    };
  }

  revalidateTodoPages(input.managedItemId);
  return { message: "Todoを登録しました。", status: "success" };
}
