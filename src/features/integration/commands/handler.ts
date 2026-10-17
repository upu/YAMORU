import { d1ErrorCode, type D1ErrorCode } from "../../../lib/d1/errors";
import type { BusinessStatements } from "../../../lib/d1/todos/command-plans";
import { tokyoDate } from "./input";
import { CommandError, type CommandPreview, type CommandTarget, type NormalizedCommand } from "./contract";

// command別の処理が満たす形。normalizeは要求だけから確定できる値を固める
// (「今」や「昨日」の絶対化を含む)。planは現在の家庭データを読み、previewと、
// commit時に受付記録と同じbatchへ載せる文を返す。commitでもplanをやり直し、
// previewが変わっていないことを確かめてから実行する。

export type CommandContext = {
  db: D1Database;
  householdId: string;
  now: Date;
  userId: string;
};

export type CommandExecution = BusinessStatements & {
  result: Record<string, unknown>;
  // 結果に書き込み後のrevisionを付ける対象。続けて訂正・取消するときの
  // expected_revisionに使える。
  revisionEntity: { id: string; kind: "managed_item" | "todo_occurrence" };
};

export type CommandPlan = {
  build(input: { businessKey: string; recordedAt: string }): CommandExecution;
  preview: CommandPreview;
};

export type CommandHandler = {
  normalize(context: CommandContext, request: { payload: unknown; target: unknown }): NormalizedCommand;
  plan(context: CommandContext, normalized: NormalizedCommand): Promise<CommandPlan>;
};

// D1層の業務エラーを外部向けのエラーへ読み替える。対応のないエラーは
// そのまま投げ、呼び出し側の一般的な失敗(temporarily_unavailable)にする。
export async function mapD1Error(
  error: unknown,
  mapping: Partial<Record<D1ErrorCode, () => CommandError | Promise<CommandError>>>,
): Promise<never> {
  const code = d1ErrorCode(error);
  const map = code === undefined ? undefined : mapping[code];
  if (map === undefined) throw error;
  throw await map();
}

// 既存の対象に作用するcommandの対象。normalizeで必ず決めている。
export function targetOf(normalized: NormalizedCommand): CommandTarget {
  if (normalized.target === null) throw new Error(`${normalized.command} requires a target`);
  return normalized.target;
}

export function performerNotFound(field: string): CommandError {
  return new CommandError("invalid_input", { fieldErrors: { [field]: "performer_not_in_household" } });
}

// 結果から利用者が開ける詳細画面。読み取りToolのdetail_urlと同じ相対パス。
export function todoDetailUrl(occurrenceId: string): string {
  return `/todos/${encodeURIComponent(occurrenceId)}`;
}

export function managedItemDetailUrl(itemId: string): string {
  return `/managed-items/${encodeURIComponent(itemId)}`;
}

// 外部へ返す繰り返し方式の名前。DBの'once'は契約上one_timeと呼ぶ。
export function recurrenceName(basis: string): string {
  return basis === "once" ? "one_time" : basis;
}

export function scheduleView(slot: { dueAt: string | null; scheduledFor: string | null }) {
  return {
    due_at: slot.dueAt,
    due_on: tokyoDate(slot.dueAt),
    scheduled_for: slot.scheduledFor,
    scheduled_on: tokyoDate(slot.scheduledFor),
  };
}
