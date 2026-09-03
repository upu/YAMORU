import { type RecurringTaskRuleUpdate } from "../../../lib/d1/todos";
import type { MaintenanceTodoActionState } from "../../managed-items/[id]/state";
import {
  EMPTY_WEEK_POSITIONS_MESSAGE,
  WEEK_LAST_FIELD_NAME,
  WEEK_POSITIONS_FIELD_NAME,
} from "../week-position-checkboxes";
import { WEEKDAYS_FIELD_NAME } from "../weekday-checkboxes";

export type CalendarRuleSchedule = Pick<
  Extract<RecurringTaskRuleUpdate, { recurrenceBasis: "calendar" }>,
  | "scheduleDayOfMonth" | "scheduleDaysOfWeek" | "scheduleKind"
  | "scheduleMonth" | "scheduleMonthEnd" | "scheduleWeekLast"
  | "scheduleWeekOfMonth" | "scheduleWeeksOfMonth"
>;

function integerField(
  formData: FormData,
  field: string,
  minimum: number,
  maximum: number,
): number | null {
  const raw = formData.get(field);
  if (typeof raw !== "string" || !/^\d+$/u.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : null;
}

function weeklySchedule(formData: FormData): CalendarRuleSchedule | null {
  const values = formData.getAll(WEEKDAYS_FIELD_NAME);
  const weekdays = values.map((value) =>
    typeof value === "string" && /^[1-7]$/u.test(value) ? Number(value) : null
  );
  if (weekdays.length === 0 || weekdays.some((weekday) => weekday === null)) return null;
  return {
    scheduleDayOfMonth: null,
    scheduleDaysOfWeek: [...new Set(weekdays as number[])].sort((left, right) => left - right),
    scheduleKind: "weekly",
    scheduleMonth: null,
    scheduleMonthEnd: false,
    scheduleWeekOfMonth: null,
  };
}

function monthlyDaySchedule(formData: FormData): CalendarRuleSchedule | null {
  const monthEnd = formData.get("scheduleMonthEnd") === "1";
  const day = monthEnd ? 31 : integerField(formData, "scheduleDayOfMonth", 1, 31);
  return day === null ? null : {
    scheduleDayOfMonth: day,
    scheduleDaysOfWeek: [],
    scheduleKind: "monthly_day",
    scheduleMonth: null,
    scheduleMonthEnd: monthEnd,
    scheduleWeekOfMonth: null,
  };
}

// Issue #100 / #101: 第Nと最終の選択は、毎月・毎年で同じ入力欄を使う。
function weekPositions(
  formData: FormData,
): { last: boolean; weeks: number[] } | null {
  const rawLast = formData.get(WEEK_LAST_FIELD_NAME);
  if (rawLast !== null && rawLast !== "0" && rawLast !== "1") return null;
  const values = formData.getAll(WEEK_POSITIONS_FIELD_NAME);
  const weeks = values.map((value) =>
    typeof value === "string" && /^[1-5]$/u.test(value) ? Number(value) : null
  );
  if (weeks.some((week) => week === null)) return null;
  return {
    last: rawLast === "1",
    weeks: [...new Set(weeks as number[])].sort((left, right) => left - right),
  };
}

// 毎月はmonth = null、毎年は選んだ月を候補指定へ入れる。それ以外は同じ形。
function nthWeekdaySchedule(
  formData: FormData,
  scheduleKind: string,
  month: number | null,
): CalendarRuleSchedule | MaintenanceTodoActionState | null {
  const weekday = integerField(formData, "scheduleDayOfWeek", 1, 7);
  const positions = weekPositions(formData);
  if (weekday === null || positions === null) return null;
  if (positions.weeks.length === 0 && !positions.last) {
    return { message: EMPTY_WEEK_POSITIONS_MESSAGE, status: "error" };
  }
  return {
    scheduleDayOfMonth: null,
    scheduleDaysOfWeek: [weekday],
    scheduleKind,
    scheduleMonth: month,
    scheduleMonthEnd: false,
    scheduleWeekLast: positions.last,
    scheduleWeekOfMonth: positions.weeks.at(0) ?? null,
    scheduleWeeksOfMonth: positions.weeks,
  };
}

function yearlyWeekdaySchedule(
  formData: FormData,
): CalendarRuleSchedule | MaintenanceTodoActionState | null {
  const month = integerField(formData, "scheduleMonth", 1, 12);
  return month === null
    ? null
    : nthWeekdaySchedule(formData, "yearly_nth_weekday", month);
}

function isValidYearlyDate(month: number, day: number): boolean {
  const candidate = new Date(Date.UTC(2000, month - 1, day));
  return candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day;
}

function yearlySchedule(formData: FormData): CalendarRuleSchedule | null {
  const month = integerField(formData, "scheduleMonth", 1, 12);
  const day = integerField(formData, "scheduleDayOfMonth", 1, 31);
  return month === null || day === null || !isValidYearlyDate(month, day) ? null : {
    scheduleDayOfMonth: day,
    scheduleDaysOfWeek: [],
    scheduleKind: "yearly",
    scheduleMonth: month,
    scheduleMonthEnd: false,
    scheduleWeekOfMonth: null,
  };
}

export function parseCalendarRuleSchedule(
  formData: FormData,
  kind: string,
): CalendarRuleSchedule | MaintenanceTodoActionState | null {
  switch (kind) {
    case "weekly": return weeklySchedule(formData);
    case "monthly_day": return monthlyDaySchedule(formData);
    case "monthly_nth_weekday":
      return nthWeekdaySchedule(formData, "monthly_nth_weekday", null);
    case "yearly": return yearlySchedule(formData);
    case "yearly_nth_weekday": return yearlyWeekdaySchedule(formData);
    default: return null;
  }
}
