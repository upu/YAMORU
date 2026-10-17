import { Temporal } from "@js-temporal/polyfill";
import { formatTokyoDateInput, tokyoDateToUtcIso } from "../todos/projection/time-zone";

export type StockStatus = "available" | "low" | "out";
export type StockKind = "observation" | "refill";
export type StockMoment = { on: string; at: string | null; current: boolean };
export type StockApplication = "auto" | "history_only";
export class StockError extends Error {
  constructor(readonly code: "invalid_input" | "not_found" | "stale_stock" | "idempotency_conflict" | "missing_required",
    readonly field = "", readonly reason: string = code) { super(code); }
}
export function stockStatus(value: unknown, field = "status"): StockStatus {
  if (value !== "available" && value !== "low" && value !== "out") throw new StockError("invalid_input", field, "stock_status_required");
  return value;
}
export function stockPerformer(value: unknown, actorId: string): string | null {
  if (value === undefined) return actorId;
  if (value === null) return null;
  if (typeof value !== "string" || !value || value.length > 200) throw new StockError("invalid_input", "performer_id", "user_id_required");
  return value;
}
function instant(value: unknown, now: Date): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new StockError("invalid_input", "at", "datetime_required");
  let at: string;
  try { at = new Date(Temporal.Instant.from(value).epochMilliseconds).toISOString(); }
  catch { throw new StockError("invalid_input", "at", "datetime_required"); }
  if (Date.parse(at) > now.getTime()) throw new StockError("invalid_input", "at", "future_datetime");
  return at;
}
export function stockMoment(on: unknown, at: unknown, now: Date): StockMoment {
  if ((on === undefined) === (at === undefined)) throw new StockError("invalid_input", "date", "one_date_or_instant_required");
  if (on !== undefined) {
    if (typeof on !== "string" || tokyoDateToUtcIso(on) === null) throw new StockError("invalid_input", "on", "date_required");
    if (on > formatTokyoDateInput(now.toISOString())) throw new StockError("invalid_input", "on", "future_date");
    return { on, at: null, current: false };
  }
  const value = at === "now" ? now.toISOString() : instant(at, now);
  return { on: formatTokyoDateInput(value), at: value, current: at === "now" };
}
export function stockApplication(value: unknown): StockApplication {
  if (value === undefined || value === "auto") return "auto";
  if (value === "history_only") return value;
  throw new StockError("invalid_input", "application", "auto_or_history_only");
}

export type StockCurrentObservation = { status: StockStatus; performerId: string | null; moment: StockMoment };
export function stockCurrentObservation(value: unknown, actorId: string, now: Date): StockCurrentObservation | null {
  if (value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new StockError("invalid_input", "current_observation", "object_required");
  const p = value as Record<string, unknown>;
  if (Object.keys(p).some((key) => key !== "status" && key !== "performerId")) throw new StockError("invalid_input", "current_observation", "unknown_field");
  return { status: stockStatus(p.status, "current_observation.status"), performerId: stockPerformer(p.performerId, actorId), moment: stockMoment(undefined, "now", now) };
}
export type StockRecordDraft = { kind: unknown; on?: unknown; at?: unknown; status?: unknown; performerId?: unknown; application?: unknown; currentObservation?: unknown };
export type StockRecordInput = { kind: StockKind; moment: StockMoment; status: StockStatus; performerId: string | null; application: StockApplication; currentObservation: StockCurrentObservation | null };
export function normalizeStockRecord(draft: StockRecordDraft, actorId: string, now: Date): StockRecordInput {
  if (draft.kind !== "observation" && draft.kind !== "refill") throw new StockError("invalid_input", "kind", "record_kind_required");
  const status = draft.kind === "refill" ? "available" : stockStatus(draft.status);
  if (draft.kind === "refill" && draft.status !== undefined && draft.status !== "available") throw new StockError("invalid_input", "status", "refill_is_available");
  return { kind: draft.kind, moment: stockMoment(draft.on, draft.at, now), status, performerId: stockPerformer(draft.performerId, actorId),
    application: stockApplication(draft.application), currentObservation: stockCurrentObservation(draft.currentObservation, actorId, now) };
}
