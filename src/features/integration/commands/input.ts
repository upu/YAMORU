import { tokyoDateToUtcIso } from "../../../app/time-zone";
import { tokyoDateFromIso } from "../../../lib/d1/calendar";
import { CommandError, invalidInput, isCommandName, type CommandName, type CommandTarget } from "./contract";

// 外部から届いた値を検証する。未知のキーは受け付けず、黙って捨てない。

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/u;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const INSTANT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-](\d{2}):(\d{2}))$/u;

export function objectValue(value: unknown, field: string, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw invalidInput(field, "object_required");
  const unknownKey = Object.keys(value).find((key) => !keys.includes(key));
  if (unknownKey !== undefined) throw invalidInput(`${field}.${unknownKey}`, "unknown_field");
  return value as Record<string, unknown>;
}

export function idValue(value: unknown, field: string): string {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) throw invalidInput(field, "invalid_id");
  return value;
}

function uuidValue(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw invalidInput(field, "uuid_required");
  return value;
}

export type PrepareRequest = {
  command: CommandName;
  expectedRevision: unknown;
  operationId: string;
  payload: unknown;
  target: unknown;
};

export function parsePrepareRequest(input: unknown): PrepareRequest {
  const value = objectValue(input, "input", ["operation_id", "command", "target", "expected_revision", "payload"]);
  const operationId = uuidValue(value.operation_id, "operation_id");
  if (!isCommandName(value.command)) throw new CommandError("unsupported_capability", { operationId });
  return {
    command: value.command,
    expectedRevision: value.expected_revision,
    operationId,
    payload: value.payload,
    target: value.target,
  };
}

export function parseCommitRequest(input: unknown): {
  confirmationToken: string | undefined;
  fingerprint: string;
  operationId: string;
  previewId: string;
} {
  const value = objectValue(input, "input", ["operation_id", "preview_id", "fingerprint", "confirmation_token"]);
  const operationId = uuidValue(value.operation_id, "operation_id");
  const previewId = uuidValue(value.preview_id, "preview_id");
  if (typeof value.fingerprint !== "string" || !HASH_PATTERN.test(value.fingerprint)) {
    throw invalidInput("fingerprint", "invalid_fingerprint");
  }
  // 追加確認(YDR-062)の承認後にoperation_getが返すtoken。確認が必須の操作でだけ使う。
  const token = value.confirmation_token;
  if (token !== undefined && (typeof token !== "string" || token.length === 0 || token.length > 256)) {
    throw invalidInput("confirmation_token", "invalid_token");
  }
  return { confirmationToken: token, fingerprint: value.fingerprint, operationId, previewId };
}

export function parseOperationGetRequest(input: unknown): { operationId: string } {
  const value = objectValue(input, "input", ["operation_id"]);
  return { operationId: uuidValue(value.operation_id, "operation_id") };
}

export function todoOccurrenceTarget(target: unknown): CommandTarget {
  const value = objectValue(target, "target", ["kind", "id"]);
  if (value.kind !== "todo_occurrence") throw invalidInput("target.kind", "todo_occurrence_required");
  return { id: idValue(value.id, "target.id"), kind: "todo_occurrence" };
}

export function managedItemTarget(target: unknown): CommandTarget {
  const value = objectValue(target, "target", ["kind", "id"]);
  if (value.kind !== "managed_item") throw invalidInput("target.kind", "managed_item_required");
  return { id: idValue(value.id, "target.id"), kind: "managed_item" };
}

// 訂正・取消の対象は完了記録。payloadのcompletion_log_idが正本であり、
// targetを併せて送る場合は同じ記録を指していなければならない。
export function completionLogTarget(target: unknown, completionLogId: unknown): CommandTarget {
  const id = idValue(completionLogId, "payload.completion_log_id");
  if (target === undefined) return { id, kind: "completion_log" };
  const value = objectValue(target, "target", ["kind", "id"]);
  if (value.kind !== "completion_log" || value.id !== id) throw invalidInput("target", "must_match_completion_log_id");
  return { id, kind: "completion_log" };
}

export type OccurredValue = { datePrecision: "day" | "instant"; occurredAt: string };

function parseOccurredOn(value: unknown, field: string, now: Date): OccurredValue {
  const occurredAt = typeof value === "string" ? tokyoDateToUtcIso(value) : null;
  if (occurredAt === null) throw invalidInput(field, "date_required");
  // 日付だけの入力は既存Webと同じくAsia/Tokyoの暦日として扱い、今日より後を拒否する。
  if ((value as string) > tokyoDateFromIso(now.toISOString())) throw invalidInput(field, "future_date");
  return { datePrecision: "day", occurredAt };
}

// 実在する時差は-12:00〜+14:00。それより大きい値は打ち間違いとして拒否する。
const MAX_OFFSET_MINUTES = 14 * 60;

// Dateは2月30日などを翌月へ繰り越して解釈するため、暦日と時刻の各部分が
// 実在する値であることを先に確かめる。
function isRealInstant(match: RegExpExecArray): boolean {
  const [year, month, day, hour, minute, second = "0", offsetHour = "0", offsetMinute = "0"] = match.slice(1);
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day) && Number(hour) < 24 && Number(minute) < 60 && Number(second) < 60 &&
    Number(offsetMinute) < 60 && Number(offsetHour) * 60 + Number(offsetMinute) <= MAX_OFFSET_MINUTES;
}

function parseOccurredAt(value: unknown, field: string, now: Date): OccurredValue {
  const match = typeof value === "string" ? INSTANT_PATTERN.exec(value) : null;
  const parsed = match !== null && isRealInstant(match) ? new Date(match[0]) : null;
  if (parsed === null || Number.isNaN(parsed.getTime())) throw invalidInput(field, "datetime_required");
  if (parsed.getTime() > now.getTime()) throw invalidInput(field, "future_datetime");
  return { datePrecision: "instant", occurredAt: parsed.toISOString() };
}

// occurred_onとoccurred_atは一方だけを受け付ける。どちらもなければnull。
export function occurredValue(
  value: Record<string, unknown>,
  field: string,
  now: Date,
): OccurredValue | null {
  const hasOn = value.occurred_on !== undefined;
  const hasAt = value.occurred_at !== undefined;
  if (hasOn && hasAt) throw invalidInput(field, "occurred_on_or_occurred_at");
  if (hasOn) return parseOccurredOn(value.occurred_on, `${field}.occurred_on`, now);
  if (hasAt) return parseOccurredAt(value.occurred_at, `${field}.occurred_at`, now);
  return null;
}

export function tokyoDate(value: string | null): string | null {
  return value === null ? null : tokyoDateFromIso(value);
}
