// YDR-017: 厳密な期限とメンテナンスの推奨期間を区別する

import {
  type CompletionIntervalUnit,
  type StoredCalendarSpec,
  isCompletionIntervalUnit,
} from "../lib/d1/calendar";
//
// scheduled_for/due_atの意味はYDR-012に従う。maintenanceでは
// scheduled_forを推奨期間の開始、due_atを推奨期間の上限として使う。
// strictではscheduled_forとdue_atを同日として扱い、期限切れ表示を維持する。

// Issue #52 / #281: 推奨期間の経過割合がこの値以上になったら、開始直後の
// 「推奨期間」より一段強い「そろそろ」と案内する。利用者ごとの設定化はせず、
// 固定のプロダクト規則とする。
const MAINTENANCE_REMINDER_THRESHOLD_RATIO = 0.8;

export type TodoTone =
  | "urgent"
  | "today"
  | "upcoming"
  | "done"
  | "reminder"
  | "caution";

// Issue #243: コンパクトなリスト表示(todo-list-row.tsx)専用の予定情報。
// カード向けのitem.meta文章("8月28日から推奨期間です"等)は表示済みの
// 日本語文なので解析せず、pending-todo.tsがここで組み立てた構造化データを
// TodoListRowが短い表記(「8/28〜」等)へ変換する(issue本文の設計メモ案1)。
// バッジ(今日/予定/期限切れ/推奨期間/そろそろ/推奨期間超過/未定)がすでに
// 状態語を示すため、
// ここでは日付だけを最小限に持つ。
export type TodoListSchedule =
  // 厳密な期限(1回限り・定例日基準)の期日。
  | { iso: string; kind: "due" }
  // 完了日基準Todoの推奨期間の開始(before-window)。
  | { iso: string; kind: "from" }
  // 完了日基準Todoの推奨期間の上限(in-window・reminder-window・past-window)。
  | { iso: string; kind: "until" }
  // 予定日未定。バッジの「未定」と重複させないため日付を持たない。
  | { kind: "undated" };

export type MaintenanceDisplayState =
  | "before-window"
  | "in-window"
  | "reminder-window"
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

// Issue #99 / YDR-037: "interval"は「起点日からN日ごと・N週ごと」の固定間隔。
export const RECURRENCE_BASES = ["calendar", "completion", "interval", "once"] as const;

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
    badge: "推奨期間",
    tone: "upcoming",
    message: "交換の推奨期間です",
  },
  "reminder-window": {
    badge: "そろそろ",
    tone: "reminder",
    message: "そろそろ交換時期です",
  },
  "past-window": {
    badge: "推奨期間超過",
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

// Issue #102 / YDR-040: 定例日ルールは複数の候補指定を持てる。表示も保存された
// 候補指定の配列から組み立て、曜日・週番号の昇順で並べる(YDR-040の10)。
function weekdayLabel(dayOfWeek: number): string | null {
  return CALENDAR_WEEKDAY_LABELS[dayOfWeek] ?? null;
}

function describeWeeklySchedule(specs: readonly StoredCalendarSpec[]): string | null {
  const labels = specs.map((spec) => weekdayLabel(spec.dayOfWeek));
  if (labels.length === 0 || labels.some((label) => label === null)) return null;
  return `毎週${labels.join("・")}`;
}

function describeMonthlyDaySchedule(specs: readonly StoredCalendarSpec[]): string | null {
  const parts = specs.map((spec) =>
    spec.monthEnd ? "末" : spec.dayOfMonth === 0 ? null : `${String(spec.dayOfMonth)}日`
  );
  if (parts.length === 0 || parts.some((part) => part === null)) return null;
  return `毎月${parts.join("・")}`;
}

function describeMonthlyNthWeekdaySchedule(
  specs: readonly StoredCalendarSpec[],
): string | null {
  const sorted = [...specs].sort((left, right) =>
    left.weekOfMonth - right.weekOfMonth || Number(left.weekLast) - Number(right.weekLast)
  );
  const weekday = weekdayLabel(sorted.at(0)?.dayOfWeek ?? 0);
  if (
    weekday === null || sorted.length === 0 ||
    sorted.some((spec) => spec.dayOfWeek !== sorted[0].dayOfWeek || spec.weekOfMonth === 0)
  ) {
    return null;
  }
  const positions = sorted.map((spec) =>
    spec.weekLast ? "最終" : `第${String(spec.weekOfMonth)}`
  );
  return `毎月${positions.join("・")}${weekday}`;
}

function describeYearlySchedule(specs: readonly StoredCalendarSpec[]): string | null {
  const parts = specs.map((spec) =>
    spec.month === 0 || spec.dayOfMonth === 0
      ? null
      : `${String(spec.month)}月${String(spec.dayOfMonth)}日`
  );
  if (parts.length === 0 || parts.some((part) => part === null)) return null;
  return `毎年${parts.join("・")}`;
}

export function describeCalendarSchedule(
  specs: readonly StoredCalendarSpec[],
): string | null {
  const kind = specs.at(0)?.kind;
  if (kind === undefined || specs.some((spec) => spec.kind !== kind)) return null;
  switch (kind) {
    case "weekly":
      return describeWeeklySchedule(specs);
    case "monthly_day":
      return describeMonthlyDaySchedule(specs);
    case "monthly_nth_weekday":
      return describeMonthlyNthWeekdaySchedule(specs);
    case "yearly":
      return describeYearlySchedule(specs);
    default:
      return null;
  }
}

// Issue #99 / YDR-037: 固定間隔Todoの繰り返しを、起点日と間隔で表示する。
// 保存値は単位(日・週)と回数のままで、ここでは表示だけを組み立てる。
export type IntervalRecurrenceRule = {
  intervalAnchorOn: string | null;
  intervalCount: number | null;
  intervalUnit: string | null;
};

// 形式だけでなく実在する暦日かも確かめる。登録時とDBのCHECK制約で不正な
// 起点日は弾いているが、表示側でも確かめ、データが壊れている場合に
// 「2月30日」のような誤表示をせずnullで落とす(Issue #99のレビュー指摘)。
function formatAnchorMonthDay(anchorOn: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(anchorOn);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(month)}月${String(day)}日`;
}

// 「2週ごと」は一般に「隔週」と呼ばれるため、週の別名として併記する
// (保存値は2週のままで、隔週を独立した値にはしない。Issue #99の設計メモ)。
export function describeIntervalRecurrence(
  rule: IntervalRecurrenceRule,
): string | null {
  const { intervalAnchorOn, intervalCount, intervalUnit } = rule;
  if (
    intervalAnchorOn === null || intervalCount === null ||
    !Number.isSafeInteger(intervalCount) || intervalCount < 1
  ) {
    return null;
  }
  const anchor = formatAnchorMonthDay(intervalAnchorOn);
  if (anchor === null) return null;
  const count = String(intervalCount);
  if (intervalUnit === "day") return `${anchor}から${count}日ごと`;
  if (intervalUnit !== "week") return null;
  return `${anchor}から${count}週間ごと${intervalCount === 2 ? "(隔週)" : ""}`;
}

// Issue #48 / YDR-038: 新しい行は入力値と単位をそのまま表示する。追加列を持たない
// 既存行だけはIssue #244の従来規則へフォールバックし、開始・上限がともに7で
// 割り切れる場合は週、それ以外は日で表示する。
const COMPLETION_INTERVAL_LABELS: Record<CompletionIntervalUnit, string> = {
  day: "日",
  month: "か月",
  week: "週間",
  year: "年",
};

function describeStoredCompletionRecurrence(
  recommendedStartValue: number | null = null,
  recommendedUntilValue: number | null = null,
  recommendedUnit: string | null = null,
): string | null {
  if (
    recommendedStartValue === null || recommendedUntilValue === null ||
    !Number.isSafeInteger(recommendedStartValue) ||
    !Number.isSafeInteger(recommendedUntilValue) ||
    recommendedStartValue < 0 || recommendedUntilValue < recommendedStartValue
  ) {
    return null;
  }
  if (recommendedUnit === null || !isCompletionIntervalUnit(recommendedUnit)) return null;
  const unit = COMPLETION_INTERVAL_LABELS[recommendedUnit];
  const range = recommendedStartValue === recommendedUntilValue
    ? String(recommendedStartValue)
    : `${String(recommendedStartValue)}〜${String(recommendedUntilValue)}`;
  return `完了から${range}${unit}後`;
}

export function describeCompletionRecurrence(
  recommendedStartOffsetDays: number,
  recommendedUntilOffsetDays: number,
  recommendedStartValue: number | null = null,
  recommendedUntilValue: number | null = null,
  recommendedUnit: string | null = null,
): string {
  const stored = describeStoredCompletionRecurrence(
    recommendedStartValue,
    recommendedUntilValue,
    recommendedUnit,
  );
  if (stored !== null) return stored;
  const useWeeks =
    recommendedStartOffsetDays % 7 === 0 && recommendedUntilOffsetDays % 7 === 0;
  const unit = useWeeks ? "週間" : "日";
  const start = useWeeks ? recommendedStartOffsetDays / 7 : recommendedStartOffsetDays;
  const until = useWeeks ? recommendedUntilOffsetDays / 7 : recommendedUntilOffsetDays;
  const range = start === until ? String(start) : `${String(start)}〜${String(until)}`;
  return `完了から${range}${unit}後`;
}
