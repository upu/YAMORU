import { StockError, stockApplication, stockCurrentObservation, stockMoment, stockPerformer, stockStatus, type StockMoment } from "./stock-contract";

export type StockCorrectionDraft = { recordId: unknown; recordRevision: unknown; changes?: unknown; void?: unknown; application?: unknown; currentObservation?: unknown };
export function normalizeStockCorrection(draft: StockCorrectionDraft, actorId: string, now: Date) {
  if (typeof draft.recordId !== "string" || !draft.recordId || draft.recordId.length > 250) throw new StockError("invalid_input", "record_id", "record_id_required");
  if (!Number.isSafeInteger(draft.recordRevision) || Number(draft.recordRevision) < 0) throw new StockError("invalid_input", "record_revision", "revision_required");
  if (draft.void !== undefined && draft.void !== true) throw new StockError("invalid_input", "void", "true_required");
  if ((draft.void === true) === (draft.changes !== undefined)) throw new StockError("invalid_input", "changes", "changes_or_void_required");
  const changes = draft.void === true ? {} : correctionChanges(draft.changes, actorId, now);
  return { recordId: draft.recordId, recordRevision: Number(draft.recordRevision), voided: draft.void === true, changes,
    application: stockApplication(draft.application), currentObservation: stockCurrentObservation(draft.currentObservation, actorId, now) };
}
function correctionChanges(value: unknown, actorId: string, now: Date): { moment?: StockMoment; status?: ReturnType<typeof stockStatus>; performerId?: string | null } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new StockError("invalid_input", "changes", "object_required");
  const p = value as Record<string, unknown>;
  const keys = Object.keys(p);
  if (!keys.length || keys.some((key) => !["on", "at", "status", "performerId"].includes(key))) throw new StockError("invalid_input", "changes", "unknown_or_empty_changes");
  return { ...(p.on !== undefined || p.at !== undefined ? { moment: stockMoment(p.on, p.at, now) } : {}),
    ...(p.status !== undefined ? { status: stockStatus(p.status) } : {}),
    ...(p.performerId !== undefined ? { performerId: stockPerformer(p.performerId, actorId) } : {}) };
}
export type StockCorrectionInput = ReturnType<typeof normalizeStockCorrection>;
export async function stockCorrectionHash(consumableId: string, input: StockCorrectionInput) {
  const { changes, currentObservation: current } = input;
  const moment = changes.moment;
  const payload = JSON.stringify(["correct", consumableId, input.recordId, input.recordRevision, input.voided,
    moment ? (moment.current ? "now" : moment.at ?? moment.on) : null, changes.status ?? null,
    changes.performerId === undefined ? ["unchanged"] : changes.performerId, input.application,
    current ? [current.status, current.performerId, "now"] : null]);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload))), (n) => n.toString(16).padStart(2, "0")).join("");
}
