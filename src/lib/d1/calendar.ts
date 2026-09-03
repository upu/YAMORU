import { type CalendarSchedule, type CalendarScheduleSpec } from "./calendar-schedule-specs";

export {
  calendarScheduleFromInput,
  calendarScheduleFromSpecs,
  calendarSpecsFromInput,
  parseCalendarScheduleSpecs,
} from "./calendar-schedule-specs";
export type {
  CalendarSchedule,
  CalendarScheduleInput,
  CalendarScheduleSpec,
  StoredCalendarSpec,
} from "./calendar-schedule-specs";

const TOKYO_OFFSET = "+09:00";

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

function lastWeekdayCandidate(
  year: number,
  month: number,
  weekday: number,
): string {
  const lastDay = daysInMonth(year, month);
  const last = new Date(Date.UTC(year, month - 1, lastDay));
  const day = lastDay - ((isoDayOfWeek(last) - weekday + 7) % 7);
  return formatDate(new Date(Date.UTC(year, month - 1, day)));
}

function requireNumber(value: number | null, message: string): number {
  if (value === null) throw new Error(message);
  return value;
}

// 候補指定では0が「未使用」を表すため、計算に使う値は正の数であることまで
// 確かめる。0のまま計算すると、存在しない曜日・週・日付を無限に探し続ける。
function requireSpecValue(value: number, message: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(message);
  return value;
}

function monthlyOnOrAfter(
  scheduleKind: string,
  spec: CalendarScheduleSpec,
  onOrAfter: string,
): string {
  const start = parseDate(onOrAfter);
  let year = start.getUTCFullYear();
  let month = start.getUTCMonth() + 1;
  for (;;) {
    const candidate = monthlyCandidateForSpec(scheduleKind, spec, year, month);
    if (candidate !== null && candidate >= onOrAfter) return candidate;
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
  }
}

// Issue #100 / #101 / YDR-040の4: 第N曜日と最終曜日は別の暦規則で計算する。
// 毎月(monthly_nth_weekday)と毎年(yearly_nth_weekday)で同じ規則を使い、
// 年次側に独自実装を持たない。
function weekdayCandidateForSpec(
  spec: CalendarScheduleSpec,
  year: number,
  month: number,
): string | null {
  const weekday = requireSpecValue(spec.dayOfWeek, "Invalid weekday");
  const week = requireSpecValue(spec.weekOfMonth, "Invalid week");
  if (spec.weekLast && week !== 5) throw new Error("Invalid last weekday");
  return spec.weekLast
    ? lastWeekdayCandidate(year, month, weekday)
    : nthWeekdayCandidate(year, month, weekday, week);
}

function monthlyCandidateForSpec(
  scheduleKind: string,
  spec: CalendarScheduleSpec,
  year: number,
  month: number,
): string | null {
  if (scheduleKind === "monthly_day") {
    return monthlyCandidate(
      year,
      month,
      requireSpecValue(spec.dayOfMonth, "Invalid monthly day"),
    );
  }
  return weekdayCandidateForSpec(spec, year, month);
}

// Issue #101 / YDR-021の5: 毎年の第N曜日は、指定月にその週がない年を飛ばして
// 次に成立する年へ進める。2月の第5曜日のように成立が数十年に一度でも、
// Gregorian暦の400年周期にはすべての年型が現れるため、その範囲で必ず見つかる。
// 上限に達するのは保存値が壊れている場合だけなので、無限ループにせず落とす。
const MAX_YEARLY_SEARCH_YEARS = 400;

function yearlyOnOrAfter(
  spec: CalendarScheduleSpec,
  onOrAfter: string,
  candidateFor: (year: number, month: number) => string | null,
): string {
  const month = requireSpecValue(spec.month, "Invalid month");
  const startYear = parseDate(onOrAfter).getUTCFullYear();
  for (let offset = 0; offset <= MAX_YEARLY_SEARCH_YEARS; offset += 1) {
    const candidate = candidateFor(startYear + offset, month);
    if (candidate !== null && candidate >= onOrAfter) return candidate;
  }
  throw new Error("Invalid yearly calendar schedule");
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

// 候補指定1件が生む、指定した暦日以降の最初の候補(Asia/Tokyoの暦日)。
function specDateOnOrAfter(
  scheduleKind: string,
  spec: CalendarScheduleSpec,
  onOrAfter: string,
): string {
  const start = parseDate(onOrAfter);
  if (scheduleKind === "weekly") {
    const target = requireSpecValue(spec.dayOfWeek, "Invalid weekday");
    return addDays(onOrAfter, (target - isoDayOfWeek(start) + 7) % 7);
  }
  if (scheduleKind === "monthly_day" || scheduleKind === "monthly_nth_weekday") {
    return monthlyOnOrAfter(scheduleKind, spec, onOrAfter);
  }
  if (scheduleKind === "yearly") {
    const day = requireSpecValue(spec.dayOfMonth, "Invalid day");
    return yearlyOnOrAfter(
      spec,
      onOrAfter,
      (year, month) => monthlyCandidate(year, month, day),
    );
  }
  if (scheduleKind === "yearly_nth_weekday") {
    return yearlyOnOrAfter(
      spec,
      onOrAfter,
      (year, month) => weekdayCandidateForSpec(spec, year, month),
    );
  }
  throw new Error("Invalid calendar schedule");
}

// Issue #102 / YDR-040の5: 統合済み候補列の「指定した暦日以降の最初の候補」は、
// 候補指定ごとに最初の候補を求めてその最小値を採る。候補指定の件数に比例した
// 計算で済み、暦日を1日ずつ進める探索をしない。同一暦日を複数の指定が生んでも
// 最小値は1つに定まるため、重複排除は最小値を採ること自体で満たされる。
export function calendarScheduledForOnOrAfter(
  schedule: CalendarSchedule,
  onOrAfter: string,
): string {
  const candidates = schedule.specs.map(
    (spec) => specDateOnOrAfter(schedule.scheduleKind, spec, onOrAfter),
  );
  const earliest = candidates.sort().at(0);
  // 候補指定が0件のルールは「候補なし」を返さずエラーにする(YDR-040の7)。
  if (earliest === undefined) throw new Error("Calendar schedule has no spec");
  return tokyoDateToIso(earliest);
}

// Issue #286: 登録直後の初回Occurrenceの予定日。登録処理(createCalendarTask /
// createIntervalTask)と、登録できたことを返すフィードバック表示の両方が使う。
// 同じ`now`を渡せば同じ値になるため、表示のためだけの候補計算を増やさない。
export function calendarFirstScheduledFor(
  schedule: CalendarSchedule,
  now: Date,
): string {
  return calendarScheduledForOnOrAfter(schedule, tokyoDateFromIso(now.toISOString()));
}

export function intervalFirstScheduledFor(
  schedule: IntervalSchedule,
  now: Date,
): string {
  return intervalScheduledForOnOrAfter(schedule, tokyoDateFromIso(now.toISOString()));
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
