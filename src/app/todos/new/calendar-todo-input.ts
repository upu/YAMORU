import type { MaintenanceTodoActionState } from "../../managed-items/[id]/state";
import type { CalendarTodoInput, TodoBasics } from "./save-todo";
import { EMPTY_WEEKDAYS_MESSAGE, WEEKDAYS_FIELD_NAME } from "../weekday-checkboxes";
import {
  EMPTY_WEEK_POSITIONS_MESSAGE,
  WEEK_LAST_FIELD_NAME,
  WEEK_POSITIONS_FIELD_NAME,
} from "../week-position-checkboxes";

// Issue #101: 定例日基準Todoの登録入力の解釈。方式が毎週・毎月の2方式・毎年の
// 2方式へ増えてactions.tsに収まらなくなったため、編集側(calendar-rule-input.ts)
// と同じ形で定例日の解釈だけを分けた。保存はsave-todo.tsが行う。

const INVALID_CALENDAR_SCHEDULE: MaintenanceTodoActionState = {
  message: "定例日の指定を正しく入力してください。",
  status: "error",
};
// Issue #102 / YDR-040の7: 候補指定が0件のルールは作れない。
const EMPTY_WEEKDAYS: MaintenanceTodoActionState = {
  message: EMPTY_WEEKDAYS_MESSAGE,
  status: "error",
};
const EMPTY_WEEK_POSITIONS: MaintenanceTodoActionState = {
  message: EMPTY_WEEK_POSITIONS_MESSAGE,
  status: "error",
};

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

// Issue #100 / #101: 第Nと最終の選択は、毎月・毎年で同じ入力欄を使う。
function parseWeekPositions(
  formData: FormData,
): { last: boolean; weeks: number[] } | null {
  const rawLast = formData.get(WEEK_LAST_FIELD_NAME);
  if (rawLast !== null && rawLast !== "0" && rawLast !== "1") return null;
  const values = formData.getAll(WEEK_POSITIONS_FIELD_NAME);
  const parsed = values.map((value) => parseBoundedInteger(value, 1, 5));
  if (parsed.some((week) => week === null)) return null;
  return {
    last: rawLast === "1",
    weeks: [...new Set(parsed as number[])].sort((left, right) => left - right),
  };
}

// 毎月は月を持たず、毎年は選んだ月を候補指定へ入れる。それ以外は同じ形。
function parseNthWeekdayCalendarTodo(
  basics: TodoBasics,
  formData: FormData,
  scheduleKind: "monthly_nth_weekday" | "yearly_nth_weekday",
  month?: number,
): CalendarTodoInput | MaintenanceTodoActionState {
  const dayOfWeek = parseBoundedInteger(formData.get("scheduleDayOfWeek"), 1, 7);
  const positions = parseWeekPositions(formData);
  if (dayOfWeek === null || positions === null) return INVALID_CALENDAR_SCHEDULE;
  if (positions.weeks.length === 0 && !positions.last) {
    return EMPTY_WEEK_POSITIONS;
  }
  return {
    ...basics,
    recurrenceBasis: "calendar",
    scheduleDaysOfWeek: [dayOfWeek],
    scheduleKind,
    scheduleMonth: month,
    scheduleMonthEnd: false,
    scheduleWeekLast: positions.last,
    scheduleWeekOfMonth: positions.weeks.at(0) ?? null,
    scheduleWeeksOfMonth: positions.weeks,
  };
}

function parseYearlyWeekdayCalendarTodo(
  basics: TodoBasics,
  formData: FormData,
): CalendarTodoInput | MaintenanceTodoActionState {
  const month = parseBoundedInteger(formData.get("scheduleMonth"), 1, 12);
  if (month === null) return INVALID_CALENDAR_SCHEDULE;
  return parseNthWeekdayCalendarTodo(basics, formData, "yearly_nth_weekday", month);
}

function parseYearlyCalendarTodo(
  basics: TodoBasics,
  formData: FormData,
): CalendarTodoInput | MaintenanceTodoActionState {
  const day = parseBoundedInteger(formData.get("scheduleDayOfMonth"), 1, 31);
  const month = parseBoundedInteger(formData.get("scheduleMonth"), 1, 12);
  if (day === null || month === null || !isValidYearlyDate(month, day)) {
    return INVALID_CALENDAR_SCHEDULE;
  }
  return {
    ...basics,
    recurrenceBasis: "calendar",
    scheduleDayOfMonth: day,
    scheduleKind: "yearly",
    scheduleMonth: month,
    scheduleMonthEnd: false,
  };
}

export function parseCalendarTodo(
  basics: TodoBasics,
  formData: FormData,
): CalendarTodoInput | MaintenanceTodoActionState {
  const scheduleKind = formData.get("scheduleKind");
  if (scheduleKind === "weekly") return parseWeeklyCalendarTodo(basics, formData);
  if (scheduleKind === "monthly_day") {
    const day = parseBoundedInteger(formData.get("scheduleDayOfMonth"), 1, 31);
    return parseMonthlyDayCalendarTodo(basics, formData, day) ?? INVALID_CALENDAR_SCHEDULE;
  }
  if (scheduleKind === "monthly_nth_weekday") {
    return parseNthWeekdayCalendarTodo(basics, formData, "monthly_nth_weekday");
  }
  if (scheduleKind === "yearly") return parseYearlyCalendarTodo(basics, formData);
  if (scheduleKind === "yearly_nth_weekday") {
    return parseYearlyWeekdayCalendarTodo(basics, formData);
  }
  return INVALID_CALENDAR_SCHEDULE;
}
