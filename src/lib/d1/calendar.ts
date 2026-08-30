const TOKYO_OFFSET = "+09:00";

type CalendarSchedule = {
  scheduleDayOfMonth: number | null;
  scheduleDayOfWeek: number | null;
  scheduleKind: string;
  scheduleMonth: number | null;
  scheduleWeekOfMonth: number | null;
};

function parseDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) throw new Error("Invalid calendar date");
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function formatDate(value: Date): string {
  return [
    String(value.getUTCFullYear()).padStart(4, "0"),
    String(value.getUTCMonth() + 1).padStart(2, "0"),
    String(value.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function addDays(value: string, days: number): string {
  const date = parseDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDate(date);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isoDayOfWeek(date: Date): number {
  const day = date.getUTCDay();
  return day === 0 ? 7 : day;
}

function monthlyCandidate(
  year: number,
  month: number,
  requestedDay: number,
): string {
  return formatDate(
    new Date(Date.UTC(year, month - 1, Math.min(requestedDay, daysInMonth(year, month)))),
  );
}

function nthWeekdayCandidate(
  year: number,
  month: number,
  weekday: number,
  week: number,
): string | null {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const day = 1 + ((weekday - isoDayOfWeek(first) + 7) % 7) + (week - 1) * 7;
  if (day > daysInMonth(year, month)) return null;
  return formatDate(new Date(Date.UTC(year, month - 1, day)));
}

function requireNumber(value: number | null, message: string): number {
  if (value === null) throw new Error(message);
  return value;
}

function monthlyOnOrAfter(schedule: CalendarSchedule, onOrAfter: string): string {
  const start = parseDate(onOrAfter);
  let year = start.getUTCFullYear();
  let month = start.getUTCMonth() + 1;
  for (;;) {
    const candidate = schedule.scheduleKind === "monthly_day"
      ? monthlyCandidate(year, month, requireNumber(schedule.scheduleDayOfMonth, "Invalid monthly day"))
      : nthWeekdayCandidate(
          year,
          month,
          requireNumber(schedule.scheduleDayOfWeek, "Invalid weekday"),
          requireNumber(schedule.scheduleWeekOfMonth, "Invalid week"),
        );
    if (candidate !== null && candidate >= onOrAfter) return candidate;
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
  }
}

export function tokyoDateFromIso(value: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Tokyo",
    year: "numeric",
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function tokyoDateToIso(value: string): string {
  parseDate(value);
  return new Date(`${value}T00:00:00${TOKYO_OFFSET}`).toISOString();
}

export function addTokyoDays(value: string, days: number): string {
  return tokyoDateToIso(addDays(tokyoDateFromIso(value), days));
}

export function calendarScheduledForOnOrAfter(
  schedule: CalendarSchedule,
  onOrAfter: string,
): string {
  const start = parseDate(onOrAfter);
  if (schedule.scheduleKind === "weekly") {
    const target = requireNumber(schedule.scheduleDayOfWeek, "Invalid weekday");
    return tokyoDateToIso(addDays(onOrAfter, (target - isoDayOfWeek(start) + 7) % 7));
  }
  if (schedule.scheduleKind === "monthly_day" || schedule.scheduleKind === "monthly_nth_weekday") {
    return tokyoDateToIso(monthlyOnOrAfter(schedule, onOrAfter));
  }
  if (schedule.scheduleKind === "yearly") {
    const month = requireNumber(schedule.scheduleMonth, "Invalid month");
    const day = requireNumber(schedule.scheduleDayOfMonth, "Invalid day");
    let year = start.getUTCFullYear();
    for (;;) {
      const candidate = monthlyCandidate(year, month, day);
      if (candidate >= onOrAfter) return tokyoDateToIso(candidate);
      year += 1;
    }
  }
  throw new Error("Invalid calendar schedule");
}

export function nextCalendarOccurrence(
  schedule: CalendarSchedule,
  currentScheduledFor: string,
  occurredAt: string,
): string {
  const nextDate = [
    addDays(tokyoDateFromIso(currentScheduledFor), 1),
    tokyoDateFromIso(occurredAt),
  ].sort().at(-1);
  if (nextDate === undefined) throw new Error("Invalid next calendar date");
  let candidate = calendarScheduledForOnOrAfter(schedule, nextDate);
  if (candidate <= occurredAt) {
    candidate = calendarScheduledForOnOrAfter(
      schedule,
      addDays(tokyoDateFromIso(candidate), 1),
    );
  }
  return candidate;
}
