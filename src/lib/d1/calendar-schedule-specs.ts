// Issue #100 / #101 / YDR-040: 定例日基準Todoの候補指定を、保存・入力・計算で
// 共有する。未使用値はtask_rule_schedulesと同じ0で表し、同一種類の1〜7件へ
// 正規化する。

export type CalendarScheduleSpec = {
  dayOfMonth: number;
  dayOfWeek: number;
  month: number;
  weekLast: boolean;
  weekOfMonth: number;
};

export type CalendarSchedule = {
  scheduleKind: string;
  specs: readonly CalendarScheduleSpec[];
};

export type StoredCalendarSpec = CalendarScheduleSpec & {
  kind: string;
  monthEnd: boolean;
};

function toSpecNumber(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function toSpecFlag(value: unknown): boolean {
  return value === 1 || value === true;
}

function toStoredCalendarSpec(value: unknown): StoredCalendarSpec | null {
  if (typeof value !== "object" || value === null) return null;
  const spec = value as Record<string, unknown>;
  if (typeof spec.kind !== "string" || spec.kind === "") return null;
  return {
    dayOfMonth: toSpecNumber(spec.dayOfMonth),
    dayOfWeek: toSpecNumber(spec.dayOfWeek),
    kind: spec.kind,
    month: toSpecNumber(spec.month),
    monthEnd: toSpecFlag(spec.monthEnd),
    weekLast: toSpecFlag(spec.weekLast),
    weekOfMonth: toSpecNumber(spec.weekOfMonth),
  };
}

function compareStoredCalendarSpecs(
  left: StoredCalendarSpec,
  right: StoredCalendarSpec,
): number {
  return left.month - right.month ||
    left.dayOfMonth - right.dayOfMonth ||
    left.weekOfMonth - right.weekOfMonth ||
    Number(left.weekLast) - Number(right.weekLast) ||
    left.dayOfWeek - right.dayOfWeek;
}

export function parseCalendarScheduleSpecs(value: string | null): StoredCalendarSpec[] {
  if (value === null || value === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const specs = parsed.map(toStoredCalendarSpec);
  if (specs.some((spec) => spec === null)) return [];
  return (specs as StoredCalendarSpec[]).sort(compareStoredCalendarSpecs);
}

export function calendarScheduleFromSpecs(
  specs: readonly StoredCalendarSpec[],
): CalendarSchedule {
  const scheduleKind = specs.at(0)?.kind;
  if (scheduleKind === undefined) throw new Error("Calendar schedule has no spec");
  if (specs.some((spec) => spec.kind !== scheduleKind)) {
    throw new Error("Calendar schedule mixes spec kinds");
  }
  return { scheduleKind, specs };
}

export type CalendarScheduleInput = {
  scheduleDayOfMonth: number | null;
  scheduleDaysOfWeek: readonly number[];
  scheduleKind: string;
  scheduleMonth: number | null;
  scheduleMonthEnd: boolean;
  scheduleWeekLast?: boolean;
  scheduleWeekOfMonth: number | null;
  scheduleWeeksOfMonth?: readonly number[];
};

const MAX_CALENDAR_SPECS = 7;

function isIntegerInRange(value: number, minimum: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function weeklySpecs(kind: string, weekdays: number[]): StoredCalendarSpec[] {
  if (
    weekdays.length === 0 || weekdays.length > MAX_CALENDAR_SPECS ||
    weekdays.some((weekday) => !isIntegerInRange(weekday, 1, 7))
  ) {
    throw new Error("Weekly schedule requires 1 to 7 weekdays");
  }
  return weekdays.map((dayOfWeek) => ({
    dayOfMonth: 0,
    dayOfWeek,
    kind,
    month: 0,
    monthEnd: false,
    weekLast: false,
    weekOfMonth: 0,
  }));
}

// Issue #100 / #101 / YDR-040の3: 第N曜日・最終曜日の候補指定は、毎月
// (monthly_nth_weekday)と毎年(yearly_nth_weekday)で同じ形を持つ。違いは
// monthが0か1〜12かだけなので、正規化も一つの関数で行う。
function nthWeekdaySpecs(
  input: CalendarScheduleInput,
  weekdays: number[],
  month: number,
): StoredCalendarSpec[] {
  const sourceWeeks = input.scheduleWeeksOfMonth ??
    (input.scheduleWeekOfMonth === null ? [] : [input.scheduleWeekOfMonth]);
  const weeks = [...new Set(sourceWeeks)].sort((left, right) => left - right);
  const hasLast = input.scheduleWeekLast === true;
  const positionCount = weeks.length + Number(hasLast);
  if (
    weekdays.length !== 1 || !isIntegerInRange(weekdays[0], 1, 7) ||
    weeks.some((week) => !isIntegerInRange(week, 1, 5)) ||
    positionCount < 1 || positionCount > MAX_CALENDAR_SPECS
  ) {
    throw new Error("Nth weekday schedule requires a weekday and 1 to 6 positions");
  }
  const dayOfWeek = weekdays[0];
  const specs = weeks.map((weekOfMonth) => ({
    dayOfMonth: 0,
    dayOfWeek,
    kind: input.scheduleKind,
    month,
    monthEnd: false,
    weekLast: false,
    weekOfMonth,
  }));
  if (hasLast) {
    specs.push({
      dayOfMonth: 0,
      dayOfWeek,
      kind: input.scheduleKind,
      month,
      monthEnd: false,
      weekLast: true,
      weekOfMonth: 5,
    });
  }
  return specs;
}

// 毎年の第N曜日は月も候補指定の一部になる。一つのルールで選べる月は1つだけと
// するため(Issue #101の「このIssueでは行わないこと」)、すべての候補指定へ
// 同じ月を入れる。
function yearlyWeekdaySpecs(
  input: CalendarScheduleInput,
  weekdays: number[],
): StoredCalendarSpec[] {
  const month = input.scheduleMonth;
  if (month === null || !isIntegerInRange(month, 1, 12)) {
    throw new Error("Yearly weekday schedule requires a month");
  }
  return nthWeekdaySpecs(input, weekdays, month);
}

function singleSpec(
  input: CalendarScheduleInput,
  weekdays: number[],
): StoredCalendarSpec[] {
  if (weekdays.length > 1) throw new Error("Only weekly schedules can have multiple weekdays");
  return [{
    dayOfMonth: input.scheduleDayOfMonth ?? 0,
    dayOfWeek: weekdays.at(0) ?? 0,
    kind: input.scheduleKind,
    month: input.scheduleMonth ?? 0,
    monthEnd: input.scheduleMonthEnd,
    weekLast: false,
    weekOfMonth: input.scheduleWeekOfMonth ?? 0,
  }];
}

export function calendarSpecsFromInput(
  input: CalendarScheduleInput,
): StoredCalendarSpec[] {
  const weekdays = [...new Set(input.scheduleDaysOfWeek)].sort((left, right) => left - right);
  if (input.scheduleKind === "weekly") return weeklySpecs(input.scheduleKind, weekdays);
  if (input.scheduleKind === "monthly_nth_weekday") {
    return nthWeekdaySpecs(input, weekdays, 0);
  }
  if (input.scheduleKind === "yearly_nth_weekday") {
    return yearlyWeekdaySpecs(input, weekdays);
  }
  return singleSpec(input, weekdays);
}

export function calendarScheduleFromInput(input: CalendarScheduleInput): CalendarSchedule {
  return calendarScheduleFromSpecs(calendarSpecsFromInput(input));
}
