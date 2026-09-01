const TOKYO_OFFSET = "+09:00";

type CalendarSchedule = {
  scheduleDayOfMonth: number | null;
  scheduleDayOfWeek: number | null;
  scheduleKind: string;
  scheduleMonth: number | null;
  scheduleWeekOfMonth: number | null;
};

// 形式だけでなく実在する暦日かも確かめる。Date.UTCは2026-02-30のような
// 存在しない日付を黙って繰り上げるため、そのままでは誤った候補日を返す
// (Issue #99のレビュー指摘)。保存側のCHECK制約と同じ判定にそろえる。
function parseDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) throw new Error("Invalid calendar date");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error("Invalid calendar date");
  }
  return parsed;
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

export type CompletionIntervalUnit = "day" | "month" | "week" | "year";

const COMPLETION_INTERVAL_UNITS: readonly CompletionIntervalUnit[] = [
  "day",
  "week",
  "month",
  "year",
];

export function isCompletionIntervalUnit(value: string): value is CompletionIntervalUnit {
  return (COMPLETION_INTERVAL_UNITS as readonly string[]).includes(value);
}

function requireIntervalAmount(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error("Invalid calendar interval amount");
  }
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// Issue #48 / YDR-038: 月・年は固定日数へ換算しない。起点の「日」を保持した
// まま対象年月へ一度に移動し、存在しない場合だけ対象月の月末へ補正する。
// そのため1月31日+2か月は、2月を経由して3月28日になるのではなく3月31日。
export function addTokyoCalendarDate(
  value: string,
  amount: number,
  unit: string,
): string {
  requireIntervalAmount(amount);
  const date = parseDate(value);
  if (unit === "day") return addDays(value, amount);
  if (unit === "week") return addDays(value, amount * 7);
  if (unit === "month") {
    const targetMonthIndex = date.getUTCFullYear() * 12 + date.getUTCMonth() + amount;
    const year = Math.floor(targetMonthIndex / 12);
    const monthIndex = targetMonthIndex % 12;
    const day = Math.min(date.getUTCDate(), daysInMonth(year, monthIndex + 1));
    return formatDate(new Date(Date.UTC(year, monthIndex, day)));
  }
  if (unit === "year") {
    const year = date.getUTCFullYear() + amount;
    const month = date.getUTCMonth() + 1;
    const day = Math.min(date.getUTCDate(), daysInMonth(year, month));
    return formatDate(new Date(Date.UTC(year, month - 1, day)));
  }
  throw new Error("Invalid calendar interval unit");
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

export function addTokyoCalendarInterval(
  value: string,
  amount: number,
  unit: CompletionIntervalUnit,
): string {
  return tokyoDateToIso(addTokyoCalendarDate(tokyoDateFromIso(value), amount, unit));
}

export function addTokyoDays(value: string, days: number): string {
  return tokyoDateToIso(addDays(tokyoDateFromIso(value), days));
}

// Issue #99 / YDR-037: 固定間隔ルール。候補列は起点日を`A`、間隔日数を`D`と
// して暦日`S_k = A + k * D`(k = 0, 1, 2, …)であり、完了日には依存しない。
// N週は常に7 * N日として扱う(Asia/TokyoはDSTを持たないため、7 * N日の暦日
// 加算は必ず同じ曜日に着地する)。
export type IntervalSchedule = {
  intervalAnchorOn: string;
  intervalCount: number | null;
  intervalUnit: string | null;
};

const INTERVAL_UNIT_DAYS: Record<string, number> = { day: 1, week: 7 };

function intervalDays(schedule: IntervalSchedule): number {
  const unitDays = schedule.intervalUnit === null
    ? undefined
    : INTERVAL_UNIT_DAYS[schedule.intervalUnit];
  const count = requireNumber(schedule.intervalCount, "Invalid interval count");
  if (unitDays === undefined) throw new Error("Invalid interval unit");
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new Error("Invalid interval count");
  }
  return count * unitDays;
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (parseDate(to).getTime() - parseDate(from).getTime()) / 86_400_000,
  );
}

// 起点日以降で、指定した暦日以上になる最初の候補。登録直後の初回Occurrenceに
// 使う。起点日が過去でも、飛ばした候補は作らない(YDR-016)。
export function intervalScheduledForOnOrAfter(
  schedule: IntervalSchedule,
  onOrAfter: string,
): string {
  const days = intervalDays(schedule);
  const anchor = schedule.intervalAnchorOn;
  parseDate(anchor);
  const steps = Math.max(0, Math.ceil(daysBetween(anchor, onOrAfter) / days));
  return tokyoDateToIso(addDays(anchor, steps * days));
}

// YDR-013: 直前のscheduled_forと実際の解決日時の両方より後にある最初の候補。
// 候補列は等差数列なので、1件ずつ進めず閉じた式で求める(YDR-037の4)。
// 候補はAsia/Tokyo 00:00の瞬間であるため、解決日時との比較は暦日で判定できる。
export function nextIntervalOccurrence(
  schedule: IntervalSchedule,
  currentScheduledFor: string,
  occurredAt: string,
): string {
  const days = intervalDays(schedule);
  const anchor = schedule.intervalAnchorOn;
  parseDate(anchor);
  const lower = [tokyoDateFromIso(currentScheduledFor), tokyoDateFromIso(occurredAt)]
    .sort()
    .at(-1);
  if (lower === undefined) throw new Error("Invalid next interval date");
  const steps = Math.max(0, Math.floor(daysBetween(anchor, lower) / days) + 1);
  return tokyoDateToIso(addDays(anchor, steps * days));
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
