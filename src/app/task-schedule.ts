// YDR-017: 厳密な期限とメンテナンスの推奨期間を区別する
//
// scheduled_for/due_atの意味はYDR-012に従う。maintenanceでは
// scheduled_forを推奨期間の開始、due_atを推奨期間の上限として使う。
// strictではscheduled_forとdue_atを同日として扱い、期限切れ表示を維持する。

export const MAINTENANCE_RECOMMENDED_START_DAYS = 28; // 4週間
export const MAINTENANCE_RECOMMENDED_UPPER_DAYS = 56; // 8週間

// Issue #52: 推奨開始日から推奨上限日までの経過割合がこの値以上になったら
// 「そろそろ」と案内する。利用者ごとの設定化はせず、まず固定のプロダクト
// 規則とする(design memo)。
export const MAINTENANCE_REMINDER_THRESHOLD_RATIO = 0.8;

export type TodoTone =
  | "urgent"
  | "today"
  | "upcoming"
  | "done"
  | "reminder"
  | "caution";

export type MaintenanceWindow = { scheduledFor: Date; dueAt: Date };

// Issue #243: コンパクトなリスト表示(todo-list-row.tsx)専用の予定情報。
// カード向けのitem.meta文章("8月28日から推奨期間です"等)は表示済みの
// 日本語文なので解析せず、pending-todo.tsがここで組み立てた構造化データを
// TodoListRowが短い表記(「8/28〜」等)へ変換する(issue本文の設計メモ案1)。
// バッジ(今日/予定/期限切れ/そろそろ/要確認/未定)がすでに状態語を示すため、
// ここでは日付だけを最小限に持つ。
export type TodoListSchedule =
  // 厳密な期限(1回限り・定例日基準)の期日。
  | { iso: string; kind: "due" }
  // 完了日基準Todoの推奨期間の開始(before-window)。
  | { iso: string; kind: "from" }
  // 完了日基準Todoの推奨期間の上限(in-window・past-window)。
  | { iso: string; kind: "until" }
  // 予定日未定。バッジの「未定」と重複させないため日付を持たない。
  | { kind: "undated" };

export type MaintenanceDisplayState =
  | "before-window"
  | "in-window"
  | "past-window";

export type StrictDisplayState = "upcoming" | "due-today" | "overdue";

// task_rulesの方式列はCHECK制約付きのtextであり、生成された型では`string`に
// なる。DB制約とのズレを黙って通さず、未知の値はその場で失敗させる。
export const DEADLINE_KINDS = ["maintenance", "strict"] as const;

export type DeadlineKind = (typeof DEADLINE_KINDS)[number];

export function isDeadlineKind(value: string): value is DeadlineKind {
  return DEADLINE_KINDS.some((kind) => kind === value);
}

export function toDeadlineKind(value: string): DeadlineKind {
  if (!isDeadlineKind(value)) {
    throw new Error(`未知のdeadline_kindです: ${value}`);
  }

  return value;
}

export const RECURRENCE_BASES = ["calendar", "completion", "once"] as const;

export type RecurrenceBasis = (typeof RECURRENCE_BASES)[number];

export function isRecurrenceBasis(value: string): value is RecurrenceBasis {
  return RECURRENCE_BASES.some((basis) => basis === value);
}

export function toRecurrenceBasis(value: string): RecurrenceBasis {
  if (!isRecurrenceBasis(value)) {
    throw new Error(`未知のrecurrence_basisです: ${value}`);
  }

  return value;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);

  // 日付境界のずれを避けるため、正午を基準にします。
  return new Date(year, month - 1, day, 12);
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function formatMonthDay(date: Date): string {
  return `${String(date.getMonth() + 1)}月${String(date.getDate())}日`;
}

export function computeMaintenanceWindow(occurredAt: Date): MaintenanceWindow {
  return {
    scheduledFor: addDays(occurredAt, MAINTENANCE_RECOMMENDED_START_DAYS),
    dueAt: addDays(occurredAt, MAINTENANCE_RECOMMENDED_UPPER_DAYS),
  };
}

// Issue #52: 推奨開始日から推奨上限日までの暦日数(totalDays)のうち、
// 「そろそろ」表示を開始する経過日数のしきい値を求める。ちょうど80%に
// 達する日を含めるため切り上げる。開始日と上限日が同日(totalDays<=0)の
// 場合はゼロ除算を避け、しきい値0(=当日から即座にそろそろ扱い)とする
// (design memoの「同日は当日扱い」)。timeZone非依存(呼び出し側が暦日数を
// 正しく求める)。
export function maintenanceReminderThresholdDays(totalDays: number): number {
  if (totalDays <= 0) return 0;
  return Math.ceil(totalDays * MAINTENANCE_REMINDER_THRESHOLD_RATIO);
}

export function getMaintenanceDisplayState(
  window: MaintenanceWindow,
  now: Date,
): MaintenanceDisplayState {
  const today = startOfDay(now);
  const scheduled = startOfDay(window.scheduledFor);
  const due = startOfDay(window.dueAt);
  const totalDays = Math.round((due - scheduled) / 86_400_000);
  const reminderStart =
    scheduled + maintenanceReminderThresholdDays(totalDays) * 86_400_000;

  if (today < reminderStart) return "before-window";
  if (today <= due) return "in-window";
  return "past-window";
}

export function getStrictDisplayState(
  dueAt: Date,
  now: Date,
): StrictDisplayState {
  const today = startOfDay(now);
  const due = startOfDay(dueAt);

  if (today > due) return "overdue";
  if (today === due) return "due-today";
  return "upcoming";
}

export const MAINTENANCE_DISPLAY_COPY: Record<
  MaintenanceDisplayState,
  { badge: string; tone: TodoTone; message: string }
> = {
  "before-window": {
    badge: "予定",
    tone: "upcoming",
    message: "次回の交換予定です",
  },
  "in-window": {
    badge: "そろそろ",
    tone: "reminder",
    message: "そろそろ交換時期です",
  },
  "past-window": {
    badge: "要確認",
    tone: "caution",
    message: "交換推奨期間を過ぎています",
  },
};

export const STRICT_DISPLAY_COPY: Record<
  StrictDisplayState,
  { badge: string; tone: TodoTone }
> = {
  upcoming: { badge: "予定", tone: "upcoming" },
  "due-today": { badge: "今日", tone: "today" },
  overdue: { badge: "期限切れ", tone: "urgent" },
};

// Issue #227 / YDR-032: 定例日基準Todoの繰り返しパターンを、登録フォームと
// 同じ言い回しで表示する。候補計算(src/lib/d1/calendar.ts)には使わない、
// 表示専用の変換。
const CALENDAR_WEEKDAY_LABELS: Record<number, string> = {
  1: "月曜日",
  2: "火曜日",
  3: "水曜日",
  4: "木曜日",
  5: "金曜日",
  6: "土曜日",
  7: "日曜日",
};

export type CalendarScheduleRule = {
  scheduleDayOfMonth: number | null;
  scheduleDayOfWeek: number | null;
  scheduleKind: string | null;
  scheduleMonth: number | null;
  scheduleMonthEnd: boolean;
  scheduleWeekOfMonth: number | null;
};

function describeMonthlyDaySchedule(schedule: CalendarScheduleRule): string | null {
  if (schedule.scheduleMonthEnd) return "毎月末";
  return schedule.scheduleDayOfMonth === null
    ? null
    : `毎月${String(schedule.scheduleDayOfMonth)}日`;
}

function describeMonthlyNthWeekdaySchedule(
  schedule: CalendarScheduleRule,
  weekday: string | null,
): string | null {
  if (weekday === null || schedule.scheduleWeekOfMonth === null) return null;
  return `毎月第${String(schedule.scheduleWeekOfMonth)}${weekday}`;
}

function describeYearlySchedule(schedule: CalendarScheduleRule): string | null {
  if (schedule.scheduleMonth === null || schedule.scheduleDayOfMonth === null) return null;
  return `毎年${String(schedule.scheduleMonth)}月${String(schedule.scheduleDayOfMonth)}日`;
}

export function describeCalendarSchedule(schedule: CalendarScheduleRule): string | null {
  const weekday = schedule.scheduleDayOfWeek === null
    ? null
    : CALENDAR_WEEKDAY_LABELS[schedule.scheduleDayOfWeek] ?? null;
  switch (schedule.scheduleKind) {
    case "weekly":
      return weekday === null ? null : `毎週${weekday}`;
    case "monthly_day":
      return describeMonthlyDaySchedule(schedule);
    case "monthly_nth_weekday":
      return describeMonthlyNthWeekdaySchedule(schedule, weekday);
    case "yearly":
      return describeYearlySchedule(schedule);
    default:
      return null;
  }
}

// Issue #244(設計メモ案1): 完了日基準Todoの推奨期間は、task_rulesに保存された
// 完了からの日数(recommended_start_offset/recommended_until_offset)だけを持ち、
// 登録時に選ばれた元の単位(日/週)は保存していない。開始・上限のどちらも7で
// 割り切れる場合だけ週間で表示し、それ以外は日数で表示する。28〜56日は
// 「完了から4〜8週間後」、10〜20日は「完了から10〜20日後」になる。開始と上限が
// 同じ値のときは、「完了から4週間後」のように値を重複させない。
export function describeCompletionRecurrence(
  recommendedStartOffsetDays: number,
  recommendedUntilOffsetDays: number,
): string {
  const useWeeks =
    recommendedStartOffsetDays % 7 === 0 && recommendedUntilOffsetDays % 7 === 0;
  const unit = useWeeks ? "週間" : "日";
  const start = useWeeks ? recommendedStartOffsetDays / 7 : recommendedStartOffsetDays;
  const until = useWeeks ? recommendedUntilOffsetDays / 7 : recommendedUntilOffsetDays;
  const range = start === until ? String(start) : `${String(start)}〜${String(until)}`;
  return `完了から${range}${unit}後`;
}

export function describeMaintenanceSchedule(
  state: MaintenanceDisplayState,
  window: MaintenanceWindow,
): string {
  switch (state) {
    case "before-window":
      return `${formatMonthDay(window.scheduledFor)}から交換の目安です`;
    case "in-window":
      return `${formatMonthDay(window.dueAt)}までが交換の目安です`;
    case "past-window":
      return `${formatMonthDay(window.dueAt)}に交換推奨期間の上限を過ぎました`;
  }
}
