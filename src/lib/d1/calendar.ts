const TOKYO_OFFSET = "+09:00";

// Issue #102 / YDR-040: 定例日基準ルールは1件以上の「候補指定」を持つ。
// 候補列は各指定が生む暦日の和集合を昇順に並べ、同一暦日を1件へ畳んだもの。
// 未使用の項目は0で表す(task_rule_schedulesの保存形式と同じ)。
export type CalendarScheduleSpec = {
  dayOfMonth: number;
  dayOfWeek: number;
  month: number;
  weekOfMonth: number;
};

export type CalendarSchedule = {
  scheduleKind: string;
  specs: readonly CalendarScheduleSpec[];
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
    const candidate = scheduleKind === "monthly_day"
      ? monthlyCandidate(year, month, requireSpecValue(spec.dayOfMonth, "Invalid monthly day"))
      : nthWeekdayCandidate(
          year,
          month,
          requireSpecValue(spec.dayOfWeek, "Invalid weekday"),
          requireSpecValue(spec.weekOfMonth, "Invalid week"),
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
    const month = requireSpecValue(spec.month, "Invalid month");
    const day = requireSpecValue(spec.dayOfMonth, "Invalid day");
    let year = start.getUTCFullYear();
    for (;;) {
      const candidate = monthlyCandidate(year, month, day);
      if (candidate >= onOrAfter) return candidate;
      year += 1;
    }
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

// Issue #102 / YDR-040: 保存された候補指定(task_rule_schedules、および
// YDR-039のrule_snapshot内のscheduleSpecs)を読む形。候補計算に使う項目に
// 加えて、表示だけが使う種類・月末・最終曜日も持つ。
export type StoredCalendarSpec = {
  dayOfMonth: number;
  dayOfWeek: number;
  kind: string;
  month: number;
  monthEnd: boolean;
  weekLast: boolean;
  weekOfMonth: number;
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

// 候補指定は暦上の昇順で扱い、保存順・入力順に依存しない(YDR-040の7)。
// 壊れた行を黙って捨てると候補が静かにずれるため、形が違う要素は落とさず
// 空配列として扱い、呼び出し側でエラーにする。
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

function compareStoredCalendarSpecs(
  left: StoredCalendarSpec,
  right: StoredCalendarSpec,
): number {
  return left.month - right.month ||
    left.dayOfMonth - right.dayOfMonth ||
    left.weekOfMonth - right.weekOfMonth ||
    left.dayOfWeek - right.dayOfWeek;
}

// 保存された候補指定から候補計算用のスケジュールを組み立てる。一つのルールの
// 候補指定はすべて同じ種類である(YDR-040の3)。
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

// 登録・編集フォームが渡す定例日の指定。毎週だけ複数の曜日を持てる
// (Issue #102 / YDR-040の3)。
export type CalendarScheduleInput = {
  scheduleDayOfMonth: number | null;
  scheduleDaysOfWeek: readonly number[];
  scheduleKind: string;
  scheduleMonth: number | null;
  scheduleMonthEnd: boolean;
  scheduleWeekOfMonth: number | null;
};

const MAX_CALENDAR_SPECS = 7;

// 入力を保存形式の候補指定へ変換する。曜日は昇順に並べ、同じ曜日は1件へ畳む
// (YDR-040の7)。毎週以外は候補指定を1件だけ持つ。
export function calendarSpecsFromInput(
  input: CalendarScheduleInput,
): StoredCalendarSpec[] {
  const weekdays = [...new Set(input.scheduleDaysOfWeek)].sort((left, right) => left - right);
  if (input.scheduleKind === "weekly") {
    if (weekdays.length === 0 || weekdays.length > MAX_CALENDAR_SPECS) {
      throw new Error("Weekly schedule requires 1 to 7 weekdays");
    }
    return weekdays.map((dayOfWeek) => ({
      dayOfMonth: 0,
      dayOfWeek,
      kind: input.scheduleKind,
      month: 0,
      monthEnd: false,
      weekLast: false,
      weekOfMonth: 0,
    }));
  }
  if (weekdays.length > 1) {
    throw new Error("Only weekly schedules can have multiple weekdays");
  }
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

export function calendarScheduleFromInput(input: CalendarScheduleInput): CalendarSchedule {
  return calendarScheduleFromSpecs(calendarSpecsFromInput(input));
}
