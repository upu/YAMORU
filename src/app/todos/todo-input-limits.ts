import type { CompletionIntervalUnit } from "../../lib/d1/calendar";

// Issue #367: Todo名の長さと繰り返しの上限値は、登録(new/actions.ts)と
// 編集([id]/actions.ts)が同じ値を別々に持っていた。DBのCHECK制約と対応する
// 値をここへ集め、片方だけ変わることを防ぐ。

export const TASK_TITLE_MAX_LENGTH = 100;
export const INVALID_TASK_TITLE_MESSAGE =
  `Todo名は1文字以上${String(TASK_TITLE_MAX_LENGTH)}文字以内で入力してください。`;

// Issue #329 / YDR-047: 実施するときに毎回参照する手順・注意点のメモ。
// 上限はtask_rules.noteのCHECK制約と同じ値にそろえる。
export const TASK_NOTE_MAX_LENGTH = 1000;
export const INVALID_TASK_NOTE_MESSAGE =
  `メモは${String(TASK_NOTE_MAX_LENGTH)}文字以内で入力してください。`;
export const TASK_NOTE_PLACEHOLDER = "手順・注意点など";

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

// 上限超過だけを保存可能な値と区別する。メモは任意なので、保存できる値には
// 「メモ未設定」(null)も含まれ、戻り値をnullかどうかで判定できない。
export type ParsedTodoNote =
  | { status: "ok"; value: string | null }
  | { status: "too-long" };

// Issue #329 / YDR-047: メモは任意。欄がない・空欄・空白だけはすべて
// 「メモ未設定」(null)として扱い、空文字をDBへ残さない。
// textareaの改行はHTMLの規約でCRLFとして送られるため、保存前にLFへそろえる
// (文字数の数え方と表示を、入力欄で見えていたものと一致させる)。
// 文字数はTodo名と同じくコードポイントで数える。
export function parseTodoNote(formData: FormData): ParsedTodoNote {
  const raw = formData.get("note");
  if (typeof raw !== "string") return { status: "ok", value: null };
  const note = raw.replaceAll("\r\n", "\n").trim();
  if (note.length === 0) return { status: "ok", value: null };
  return Array.from(note).length > TASK_NOTE_MAX_LENGTH
    ? { status: "too-long" }
    : { status: "ok", value: note };
}
