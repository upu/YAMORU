"use server";

import { revalidatePath } from "next/cache";

import { getD1Context } from "../../../lib/d1/context";
import {
  createCalendarTask,
  createIntervalTask,
  createMaintenanceTask,
  createOneTimeTask,
} from "../../../lib/d1/todos";
import type { MaintenanceTodoActionState } from "../../managed-items/[id]/state";
import {
  addDaysToTokyoDateUtcIso,
  getTokyoDayDistance,
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
// Issue #99 / YDR-037の7: 上限はDBのCHECK制約と同じ値にそろえる。起点日は
// 登録日の前後3650日(約10年)までを受け付ける。
const MAX_INTERVAL_COUNT = { day: 3650, week: 520 } as const;
const MAX_INTERVAL_ANCHOR_DISTANCE_DAYS = 3650;
const INVALID_INTERVAL: MaintenanceTodoActionState = {
  message: "繰り返す間隔と起点日を正しく入力してください。",
  status: "error",
};

type TodoBasics = {
  managedItemId: string | null;
  recurrenceBasis: "calendar" | "completion" | "interval" | "once";
  title: string;
};
type OneTimeTodoInput = TodoBasics & {
  recurrenceBasis: "once";
  scheduledFor: string | null;
};
type CompletionTodoInput = TodoBasics & {
  firstDueAt: string;
  firstScheduledFor: string;
  recurrenceBasis: "completion";
  recommendedStartOffset: number;
  recommendedUntilOffset: number;
};
// Issue #99 / YDR-037: 固定間隔。起点日はAsia/Tokyoの暦日で保存し、候補列は
// 起点日と間隔だけで決まる(完了日に依存しない)。
type IntervalTodoInput = TodoBasics & {
  intervalAnchorOn: string;
  intervalCount: number;
  intervalUnit: "day" | "week";
  recurrenceBasis: "interval";
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
  // Issue #227 / YDR-032: monthly_dayのときだけ、固定日ではなく毎月末を
  // 意味する。日付は常に31を渡す(既存の月末補正規則、YDR-021)。
  scheduleMonthEnd: boolean;
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
    return {
      ...basics,
      recurrenceBasis: "calendar",
      scheduleDayOfWeek: dayOfWeek,
      scheduleKind,
      scheduleMonthEnd: false,
    };
  }
  if (scheduleKind === "monthly_day") {
    const parsed = parseMonthlyDayCalendarTodo(basics, formData, dayOfMonth);
    if (parsed !== null) return parsed;
  }
  if (scheduleKind === "monthly_nth_weekday" && dayOfWeek !== null && weekOfMonth !== null) {
    return {
      ...basics,
      recurrenceBasis: "calendar",
      scheduleDayOfWeek: dayOfWeek,
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
  now: Date,
):
  | CalendarTodoInput
  | CompletionTodoInput
  | IntervalTodoInput
  | OneTimeTodoInput
  | MaintenanceTodoActionState {
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
  _previousState: MaintenanceTodoActionState,
  formData: FormData,
): Promise<MaintenanceTodoActionState> {
  const input = parseTodo(formData, new Date());
  if ("status" in input) return input;

  try {
    const { db, session } = await getD1Context();
    if (input.recurrenceBasis === "once") {
      await createOneTimeTask(db, session, input);
    } else if (input.recurrenceBasis === "completion") {
      await createMaintenanceTask(db, session, input);
    } else if (input.recurrenceBasis === "interval") {
      await createIntervalTask(db, session, input);
    } else {
      await createCalendarTask(db, session, {
        ...input,
        scheduleDayOfMonth: input.scheduleDayOfMonth ?? null,
        scheduleDayOfWeek: input.scheduleDayOfWeek ?? null,
        scheduleMonth: input.scheduleMonth ?? null,
        scheduleWeekOfMonth: input.scheduleWeekOfMonth ?? null,
      });
    }
  } catch {
    return {
      message: "Todoを登録できませんでした。時間をおいて再度お試しください。",
      status: "error",
    };
  }

  revalidateTodoPages(input.managedItemId);
  return { message: "Todoを登録しました。", status: "success" };
}
