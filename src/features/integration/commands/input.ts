import { tokyoDateToUtcIso } from "../../../app/time-zone";
import { tokyoDateFromIso } from "../../../lib/d1/calendar";
import { CommandError, invalidInput, isCommandName, type CommandName, type CommandTarget } from "./contract";

// 外部から届いた値を検証する。未知のキーは受け付けず、黙って捨てない。

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/u;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/u;

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
  operationId: string;
  payload: unknown;
  target: unknown;
};

export function parsePrepareRequest(input: unknown): PrepareRequest {
  const value = objectValue(input, "input", ["operation_id", "command", "target", "expected_revision", "payload"]);
  const operationId = uuidValue(value.operation_id, "operation_id");
  // 対象のrevisionは#435の家庭世代と結び付けてから受け付ける。それまでは
  // 指定されても黙って無視せず、未対応として返す。
  if (value.expected_revision !== undefined) throw new CommandError("unsupported_capability", { operationId });
  if (!isCommandName(value.command)) throw new CommandError("unsupported_capability", { operationId });
  return { command: value.command, operationId, payload: value.payload, target: value.target };
}

export function parseCommitRequest(input: unknown): { fingerprint: string; operationId: string; previewId: string } {
  const value = objectValue(input, "input", ["operation_id", "preview_id", "fingerprint", "confirmation_token"]);
  const operationId = uuidValue(value.operation_id, "operation_id");
  // 追加確認(confirmation_url)の導線は後続で実装する。現在のpreviewは
  // すべて確認不要(not_needed)なので、tokenを受け取る場面はない。
  if (value.confirmation_token !== undefined) throw new CommandError("unsupported_capability", { operationId });
  const previewId = uuidValue(value.preview_id, "preview_id");
  if (typeof value.fingerprint !== "string" || !HASH_PATTERN.test(value.fingerprint)) {
    throw invalidInput("fingerprint", "invalid_fingerprint");
  }
  return { fingerprint: value.fingerprint, operationId, previewId };
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

function parseOccurredAt(value: unknown, field: string, now: Date): OccurredValue {
  const parsed = typeof value === "string" && INSTANT_PATTERN.test(value) ? new Date(value) : null;
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
