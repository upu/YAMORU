"use server";

import { revalidatePath } from "next/cache";

import {
  addTokyoCalendarDate,
  type CompletionIntervalUnit,
} from "../../../lib/d1/calendar";
import type { MaintenanceTodoActionState } from "../../managed-items/[id]/state";
import {
  type RegisteredTodoSchedule,
  type TodoRegistrationState,
  summarizeRegisteredTodoSafely,
} from "./registration-feedback";
import {
  type CalendarTodoInput,
  type CompletionTodoInput,
  type IntervalTodoInput,
  type OneTimeTodoInput,
  type ParsedTodoInput,
  type TodoBasics,
  saveTodo,
} from "./save-todo";
import {
  getTokyoDayDistance,
  tokyoDateToUtcIso,
} from "../../time-zone";
import { EMPTY_WEEKDAYS_MESSAGE, WEEKDAYS_FIELD_NAME } from "../weekday-checkboxes";

const TASK_TITLE_MAX_LENGTH = 100;
const INTERVAL_UNIT_DAYS = { day: 1, week: 7 } as const;
const MAX_RECOMMENDED_VALUE: Record<CompletionIntervalUnit, number> = {
  day: 3650,
  month: 120,
  week: 520,
  year: 10,
};
const INVALID_OFFSETS: MaintenanceTodoActionState = {
  message: "次回の目安は0以上の整数で、短い方を長い方以下にしてください。",
  status: "error",
};
const INVALID_WINDOW: MaintenanceTodoActionState = {
  message: "初回の計算に使う有効な日付を入力してください。",
  status: "error",
};
// Issue #99 / YDR-037の7: 上限はDBのCHECK制約と同じ値にそろえる。起点日は
// 登録日の前後3650日(約10年)までを受け付ける。
const MAX_INTERVAL_COUNT = { day: 3650, week: 520 } as const;
const MAX_INTERVAL_ANCHOR_DISTANCE_DAYS = 3650;
const INVALID_INTERVAL: MaintenanceTodoActionState = {
  message: "繰り返す間隔と起点日を正しく入力してください。",
  status: "error",
};

type RecommendedOffsets = {
  recommendedStartOffset: number;
  recommendedStartValue: number;
  recommendedUnit: CompletionIntervalUnit;
  recommendedUntilOffset: number;
  recommendedUntilValue: number;
};
const INVALID_CALENDAR_SCHEDULE: MaintenanceTodoActionState = {
  message: "定例日の指定を正しく入力してください。",
  status: "error",
};
// Issue #102 / YDR-040の7: 候補指定が0件のルールは作れない。
const EMPTY_WEEKDAYS: MaintenanceTodoActionState = {
  message: EMPTY_WEEKDAYS_MESSAGE,
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
    recurrenceBasis !== "interval" &&
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

// Issue #227 / YDR-032: 「毎月末」は日付入力を求めず、常に31日として保存する
// (既存の月末補正規則、YDR-021)。
function parseMonthlyDayCalendarTodo(
  basics: TodoBasics,
  formData: FormData,
  dayOfMonth: number | null,
): CalendarTodoInput | null {
  if (formData.get("scheduleMonthEnd") === "1") {
    return {
      ...basics,
      recurrenceBasis: "calendar",
      scheduleDayOfMonth: 31,
      scheduleKind: "monthly_day",
      scheduleMonthEnd: true,
    };
  }
  if (dayOfMonth === null) return null;
  return {
    ...basics,
    recurrenceBasis: "calendar",
    scheduleDayOfMonth: dayOfMonth,
    scheduleKind: "monthly_day",
    scheduleMonthEnd: false,
  };
}

// 毎週の曜日は複数選べる(Issue #102)。同じ曜日の重複は畳み、昇順に並べてから
// 保存側へ渡す(YDR-040の7)。1つでも不正な値があれば、黙って捨てずに拒否する。
function parseWeekdays(formData: FormData): number[] | null {
  const values = formData.getAll(WEEKDAYS_FIELD_NAME);
  const weekdays = values.map((value) => parseBoundedInteger(value, 1, 7));
  if (weekdays.some((weekday) => weekday === null)) return null;
  return [...new Set(weekdays as number[])].sort((left, right) => left - right);
}

function parseWeeklyCalendarTodo(
  basics: TodoBasics,
  formData: FormData,
): CalendarTodoInput | MaintenanceTodoActionState {
  const weekdays = parseWeekdays(formData);
  if (weekdays === null) return INVALID_CALENDAR_SCHEDULE;
  if (weekdays.length === 0) return EMPTY_WEEKDAYS;
  return {
    ...basics,
    recurrenceBasis: "calendar",
    scheduleDaysOfWeek: weekdays,
    scheduleKind: "weekly",
    scheduleMonthEnd: false,
  };
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

  if (scheduleKind === "weekly") return parseWeeklyCalendarTodo(basics, formData);
  if (scheduleKind === "monthly_day") {
    const parsed = parseMonthlyDayCalendarTodo(basics, formData, dayOfMonth);
    if (parsed !== null) return parsed;
  }
  if (scheduleKind === "monthly_nth_weekday" && dayOfWeek !== null && weekOfMonth !== null) {
    return {
      ...basics,
      recurrenceBasis: "calendar",
      scheduleDaysOfWeek: [dayOfWeek],
      scheduleKind,
      scheduleMonthEnd: false,
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
      scheduleMonthEnd: false,
    };
  }
  return INVALID_CALENDAR_SCHEDULE;
}

function parseIntervalTodo(
  basics: TodoBasics,
  formData: FormData,
  now: Date,
): IntervalTodoInput | MaintenanceTodoActionState {
  const unit = formData.get("fixedIntervalUnit");
  if (unit !== "day" && unit !== "week") return INVALID_INTERVAL;

  const count = parseBoundedInteger(
    formData.get("fixedIntervalCount"),
    1,
    MAX_INTERVAL_COUNT[unit],
  );
  if (count === null) return INVALID_INTERVAL;

  const anchorOn = formData.get("fixedIntervalAnchorDate");
  if (typeof anchorOn !== "string") return INVALID_INTERVAL;
  const anchorIso = tokyoDateToUtcIso(anchorOn);
  if (anchorIso === null) return INVALID_INTERVAL;
  const distance = getTokyoDayDistance(now.toISOString(), anchorIso);
  if (Math.abs(distance) > MAX_INTERVAL_ANCHOR_DISTANCE_DAYS) {
    return INVALID_INTERVAL;
  }

  return {
    ...basics,
    intervalAnchorOn: anchorOn,
    intervalCount: count,
    intervalUnit: unit,
    recurrenceBasis: "interval",
  };
}

function parseOneTimeTodo(
  basics: TodoBasics,
  formData: FormData,
): OneTimeTodoInput | MaintenanceTodoActionState {
  const plannedDate = formData.get("plannedDate");
  const scheduledFor = typeof plannedDate === "string" && plannedDate !== ""
    ? tokyoDateToUtcIso(plannedDate)
    : null;
  if (typeof plannedDate !== "string" || (plannedDate !== "" && scheduledFor === null)) {
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
    (rawUnit !== "day" && rawUnit !== "week" && rawUnit !== "month" && rawUnit !== "year")
  ) {
    return INVALID_OFFSETS;
  }

  const maximum = MAX_RECOMMENDED_VALUE[rawUnit];
  if (
    intervalMin > intervalMax ||
    intervalMax > maximum
  ) {
    return INVALID_OFFSETS;
  }
  // 旧日数列は既存Workerとの互換性のため残す。日・週は従来値を保存できるが、
  // 月・年は固定日数へ換算しないため0を互換用の番兵値とし、新しい値・単位列を正にする。
  const multiplier = rawUnit === "day" || rawUnit === "week"
    ? INTERVAL_UNIT_DAYS[rawUnit]
    : 0;
  return {
    recommendedStartOffset: intervalMin * multiplier,
    recommendedStartValue: intervalMin,
    recommendedUnit: rawUnit,
    recommendedUntilOffset: intervalMax * multiplier,
    recommendedUntilValue: intervalMax,
  };
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
  const startValue = mode === "previous_completion"
    ? offsets.recommendedStartValue
    : 0;
  const dueValue = mode === "previous_completion"
    ? offsets.recommendedUntilValue
    : offsets.recommendedUntilValue - offsets.recommendedStartValue;
  let firstScheduledFor: string | null = null;
  let firstDueAt: string | null = null;
  try {
    firstScheduledFor = tokyoDateToUtcIso(
      addTokyoCalendarDate(anchorDate, startValue, offsets.recommendedUnit),
    );
    firstDueAt = tokyoDateToUtcIso(
      addTokyoCalendarDate(anchorDate, dueValue, offsets.recommendedUnit),
    );
  } catch {
    return INVALID_WINDOW;
  }
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
  now: Date,
): ParsedTodoInput | MaintenanceTodoActionState {
  const basics = parseTodoBasics(formData);
  if ("status" in basics) return basics;
  if (basics.recurrenceBasis === "once") return parseOneTimeTodo(basics, formData);
  if (basics.recurrenceBasis === "completion") {
    return parseCompletionTodo(basics, formData);
  }
  if (basics.recurrenceBasis === "interval") {
    return parseIntervalTodo(basics, formData, now);
  }
  return parseCalendarTodo(basics, formData);
}

function revalidateTodoPages(managedItemId: string | null): void {
  revalidatePath("/");
  // 追加したTodoは、ホームに載らない予定(7日より先など)でも
  // Todo一覧には必ず載る(Issue #201)。
  revalidatePath("/todos");
  revalidatePath("/todos/new");
  if (managedItemId !== null) {
    revalidatePath(`/managed-items/${encodeURIComponent(managedItemId)}`);
  }
}

export async function createTodo(
  _previousState: TodoRegistrationState,
  formData: FormData,
): Promise<TodoRegistrationState> {
  const now = new Date();
  const input = parseTodo(formData, now);
  if ("status" in input) return input;

  let saved: RegisteredTodoSchedule;
  try {
    saved = await saveTodo(input, now);
  } catch {
    return {
      message: "Todoを登録できませんでした。時間をおいて再度お試しください。",
      status: "error",
    };
  }

  revalidateTodoPages(input.managedItemId);
  // 登録できたことに加えて、次回の予定と、ホームにまだ出ない場合の確認先を
  // その場で返す(Issue #286)。
  return {
    message: "Todoを登録しました。",
    registered: summarizeRegisteredTodoSafely(saved, now.toISOString()),
    status: "success",
  };
}
