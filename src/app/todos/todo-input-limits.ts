import type { CompletionIntervalUnit } from "../../lib/d1/calendar";

// Issue #367: Todo名の長さと繰り返しの上限値は、登録(new/actions.ts)と
// 編集([id]/actions.ts)が同じ値を別々に持っていた。DBのCHECK制約と対応する
// 値をここへ集め、片方だけ変わることを防ぐ。

export const TASK_TITLE_MAX_LENGTH = 100;
export const INVALID_TASK_TITLE_MESSAGE =
  `Todo名は1文字以上${String(TASK_TITLE_MAX_LENGTH)}文字以内で入力してください。`;

// Issue #99 / YDR-037の7、YDR-038: 上限はDBのCHECK制約と同じ値にそろえる。
// 月・年は固定日数へ換算しないため、日数列の倍率は日・週だけが持つ。
export const COMPLETION_UNIT_DAYS = { day: 1, week: 7 } as const;
export const MAX_COMPLETION_VALUE: Record<CompletionIntervalUnit, number> = {
  day: 3650,
  month: 120,
  week: 520,
  year: 10,
};
export const MAX_INTERVAL_COUNT = { day: 3650, week: 520 } as const;
// 固定間隔の起点日は、操作日の前後3650日(約10年)までを受け付ける。
export const MAX_INTERVAL_ANCHOR_DISTANCE_DAYS = 3650;

// 登録・編集で同じ規則。前後の空白を落としたうえで、1文字以上・上限以内なら
// その値を返す。文字数は書記素ではなくコードポイントで数える(既存の規則)。
export function parseTodoTitle(formData: FormData): string | null {
  const raw = formData.get("title");
  if (typeof raw !== "string") return null;
  const title = raw.trim();
  return title.length === 0 || Array.from(title).length > TASK_TITLE_MAX_LENGTH
    ? null
    : title;
}
