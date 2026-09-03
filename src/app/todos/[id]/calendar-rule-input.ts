import { type RecurringTaskRuleUpdate } from "../../../lib/d1/todos";
import type { MaintenanceTodoActionState } from "../../managed-items/[id]/state";
import {
  EMPTY_MONTHLY_WEEK_POSITIONS_MESSAGE,
  MONTHLY_WEEK_LAST_FIELD_NAME,
  MONTHLY_WEEKS_FIELD_NAME,
} from "../monthly-week-position-checkboxes";
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

function monthlyPositions(
  formData: FormData,
): { last: boolean; weeks: number[] } | null {
  const rawLast = formData.get(MONTHLY_WEEK_LAST_FIELD_NAME);
  if (rawLast !== null && rawLast !== "0" && rawLast !== "1") return null;
  const values = formData.getAll(MONTHLY_WEEKS_FIELD_NAME);
  const weeks = values.map((value) =>
    typeof value === "string" && /^[1-5]$/u.test(value) ? Number(value) : null
  );
  if (weeks.some((week) => week === null)) return null;
  return {
    last: rawLast === "1",
    weeks: [...new Set(weeks as number[])].sort((left, right) => left - right),
  };
}

function monthlyWeekdaySchedule(
  formData: FormData,
): CalendarRuleSchedule | MaintenanceTodoActionState | null {
  const weekday = integerField(formData, "scheduleDayOfWeek", 1, 7);
  const positions = monthlyPositions(formData);
  if (weekday === null || positions === null) return null;
  if (positions.weeks.length === 0 && !positions.last) {
    return { message: EMPTY_MONTHLY_WEEK_POSITIONS_MESSAGE, status: "error" };
  }
  return {
    scheduleDayOfMonth: null,
    scheduleDaysOfWeek: [weekday],
    scheduleKind: "monthly_nth_weekday",
    scheduleMonth: null,
    scheduleMonthEnd: false,
    scheduleWeekLast: positions.last,
    scheduleWeekOfMonth: positions.weeks.at(0) ?? null,
    scheduleWeeksOfMonth: positions.weeks,
  };
}

function yearlySchedule(formData: FormData): CalendarRuleSchedule | null {
  const month = integerField(formData, "scheduleMonth", 1, 12);
  const day = integerField(formData, "scheduleDayOfMonth", 1, 31);
  return month === null || day === null ? null : {
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
    case "monthly_nth_weekday": return monthlyWeekdaySchedule(formData);
    case "yearly": return yearlySchedule(formData);
    default: return null;
  }
}
