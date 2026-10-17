import {
  addTokyoCalendarDate,
  type CompletionIntervalUnit,
} from "../../lib/d1/calendar";
import { getTokyoDayDistance, tokyoDateToUtcIso } from "../time-zone";
import {
  COMPLETION_UNIT_DAYS,
  MAX_COMPLETION_VALUE,
  MAX_INTERVAL_ANCHOR_DISTANCE_DAYS,
  MAX_INTERVAL_COUNT,
} from "./todo-input-limits";

// 完了日基準・固定間隔の繰り返し条件を、入力値から保存する形へ変える。
// 登録画面(new/actions.ts)と外部command(#437)が同じ規則を使うため、
// FormDataに依存しない形でここへ置く。

export type RecommendedOffsets = {
  recommendedStartOffset: number;
  recommendedStartValue: number;
  recommendedUnit: CompletionIntervalUnit;
  recommendedUntilOffset: number;
  recommendedUntilValue: number;
};

export function isCompletionUnit(value: unknown): value is CompletionIntervalUnit {
  return value === "day" || value === "week" || value === "month" || value === "year";
}

// 次回の目安(短い方〜長い方)。上限はDBのCHECK制約と同じ値。
export function recommendedOffsets(
  unit: CompletionIntervalUnit,
  min: number,
  max: number,
): RecommendedOffsets | null {
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 0 || min > max) return null;
  if (max > MAX_COMPLETION_VALUE[unit]) return null;
  // 旧日数列は既存Workerとの互換性のため残す。日・週は従来値を保存できるが、
  // 月・年は固定日数へ換算しないため0を互換用の番兵値とし、新しい値・単位列を正にする。
  const multiplier = unit === "day" || unit === "week" ? COMPLETION_UNIT_DAYS[unit] : 0;
  return {
    recommendedStartOffset: min * multiplier,
    recommendedStartValue: min,
    recommendedUnit: unit,
    recommendedUntilOffset: max * multiplier,
    recommendedUntilValue: max,
  };
}

// 初回の決め方。前回の実施日から数えるか、次の目安の始まりの日を直接指定するか。
export type InitialDateMode = "next_window_start" | "previous_completion";

export function completionFirstWindow(
  offsets: RecommendedOffsets,
  mode: InitialDateMode,
  anchorDate: string,
): { firstDueAt: string; firstScheduledFor: string } | null {
  const startValue = mode === "previous_completion" ? offsets.recommendedStartValue : 0;
  const dueValue = mode === "previous_completion"
    ? offsets.recommendedUntilValue
    : offsets.recommendedUntilValue - offsets.recommendedStartValue;
  try {
    const firstScheduledFor = tokyoDateToUtcIso(addTokyoCalendarDate(anchorDate, startValue, offsets.recommendedUnit));
    const firstDueAt = tokyoDateToUtcIso(addTokyoCalendarDate(anchorDate, dueValue, offsets.recommendedUnit));
    return firstScheduledFor === null || firstDueAt === null ? null : { firstDueAt, firstScheduledFor };
  } catch {
    return null;
  }
}

export type IntervalCondition = {
  intervalAnchorOn: string;
  intervalCount: number;
  intervalUnit: "day" | "week";
};

// 固定間隔。間隔の上限と、起点日が操作日の前後3650日以内であることを求める。
export function intervalCondition(
  unit: unknown,
  count: number,
  anchorOn: string,
  now: Date,
): IntervalCondition | null {
  if (unit !== "day" && unit !== "week") return null;
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_INTERVAL_COUNT[unit]) return null;
  const anchorIso = tokyoDateToUtcIso(anchorOn);
  if (anchorIso === null) return null;
  if (Math.abs(getTokyoDayDistance(now.toISOString(), anchorIso)) > MAX_INTERVAL_ANCHOR_DISTANCE_DAYS) return null;
  return { intervalAnchorOn: anchorOn, intervalCount: count, intervalUnit: unit };
}
