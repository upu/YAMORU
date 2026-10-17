import { StockError, type StockRecordInput } from "../../features/consumables/stock-contract";
import { stockCorrectionHash, type StockCorrectionInput } from "../../features/consumables/stock-correction";
import { projectStockRecord, selectStockBasis, type StockProjection } from "../../features/consumables/stock-projection";
import { loadStockRecord, loadStockState, requireStockPerformer, STOCK_FACT_COLUMNS, type StockOwner, type StockRecord, type StockState } from "./consumable-stock-read";
import { stockEventStatement, stockGuardRelease, stockGuardStatement, stockProjectionStatements, type StockEventWrite, type StockResult } from "./consumable-stock-statements";
import { tokyoDateToUtcIso } from "../../features/todos/projection/time-zone";

async function correctedProjection(db: D1Database, owner: StockOwner, state: StockState, original: StockRecord, replacement: StockRecord, input: StockCorrectionInput): Promise<StockProjection> {
  if (input.currentObservation) return { recordId: "@current-stock-observation", status: input.currentObservation.status, effect: "applied" };
  const unchanged: StockProjection = { recordId: state.head?.recordId ?? null, status: state.status, effect: "history_only" };
  const changed = stockBasisChanged(original, replacement);
  if (!changed) return unchanged;
  if (state.head?.recordId !== original.recordId) return replacement.voided ? unchanged : projectStockRecord(state.head, replacement, input.application, input.changes.moment?.current ?? false);
  if (input.application === "history_only") throw new StockError("missing_required", "current_observation", "current_basis_changed");
  const { results } = await db.prepare(`SELECT ${STOCK_FACT_COLUMNS} FROM consumable_stock_current c
    JOIN consumable_stock_events r ON r.id=c.record_id JOIN consumable_stock_events e ON e.id=c.latest_event_id
    WHERE c.household_id=? AND c.consumable_id=? AND c.record_id<>? AND c.voided=0 LIMIT 101`)
    .bind(owner.householdId, state.consumableId, original.recordId).all<Omit<StockRecord, "voided"> & { voided: number }>();
  if (results.length > 100) throw new StockError("missing_required", "current_observation", "current_basis_required");
  const basis = selectStockBasis([...results.map((r) => ({ ...r, voided: r.voided === 1 })), replacement]);
  if (!basis) throw new StockError("missing_required", "current_observation", "current_basis_required");
  return { recordId: basis.recordId, status: basis.status, effect: "applied" };
}
function stockBasisChanged(original: StockRecord, replacement: StockRecord) {
  return original.voided !== replacement.voided || original.status !== replacement.status || original.occurredOn !== replacement.occurredOn || original.occurredAt !== replacement.occurredAt;
}
function requireCorrectableDate(original: StockRecord, input: StockCorrectionInput) {
  if (input.voided || input.changes.moment !== undefined) return;
  if (original.occurredOn === null || tokyoDateToUtcIso(original.occurredOn) === null) throw new StockError("missing_required", "date", "valid_date_required");
}
function replacementRecord(original: StockRecord, input: StockCorrectionInput, now: Date): StockRecord {
  if (original.kind === "state_snapshot") throw new StockError("invalid_input", "record_id", "saved_state_is_not_observation");
  if (original.voided && input.voided) throw new StockError("invalid_input", "void", "already_voided");
  if (original.kind === "refill" && input.changes.status !== undefined && input.changes.status !== "available") throw new StockError("invalid_input", "status", "refill_is_available");
  requireCorrectableDate(original, input);
  return { ...original, revision: original.revision + 1, voided: input.voided,
    occurredOn: input.changes.moment?.on ?? original.occurredOn, occurredAt: input.changes.moment ? input.changes.moment.at : original.occurredAt,
    status: input.changes.status ?? original.status, performerId: input.changes.performerId === undefined ? original.performerId : input.changes.performerId,
    recordedAt: now.toISOString() };
}
export async function planStockCorrection(db: D1Database, owner: StockOwner, consumableId: string, input: StockCorrectionInput, now: Date, expectedRevision?: number) {
  const state = await loadStockState(db, owner, consumableId);
  if (expectedRevision !== undefined && expectedRevision !== state.revision) throw new StockError("stale_stock");
  const original = await loadStockRecord(db, owner, consumableId, input.recordId);
  if (!original) throw new StockError("not_found");
  if (original.revision !== input.recordRevision) throw new StockError("stale_stock");
  const replacement = replacementRecord(original, input, now);
  if (input.changes.performerId !== undefined) await requireStockPerformer(db, owner, input.changes.performerId, "performer_id");
  if (input.currentObservation) await requireStockPerformer(db, owner, input.currentObservation.performerId, "current_observation.performer_id");
  const projection = await correctedProjection(db, owner, state, original, replacement, input);
  const preview = { affected_entities: [{ kind: "consumable", id: consumableId }],
    diff: { before: { record_id: original.recordId, record_revision: original.revision, occurred_on: original.occurredOn, occurred_at: original.occurredAt,
      stock_status: original.status, performer_id: original.performerId, voided: original.voided, current_stock_status: state.status },
    after: { occurred_on: replacement.occurredOn, occurred_at: replacement.occurredAt, stock_status: replacement.status, performer_id: replacement.performerId,
      voided: replacement.voided, current_stock_status: projection.status, state_effect: projection.effect,
      current_observation: input.currentObservation ? { stock_status: input.currentObservation.status, performer_id: input.currentObservation.performerId, occurred_at: input.currentObservation.moment.at } : null } },
    schedule_effect: { shared_schedule_changed: false } };
  return { owner, state, original, replacement, input, projection, preview, hash: await stockCorrectionHash(consumableId, input) };
}
export type StockCorrectionPlan = Awaited<ReturnType<typeof planStockCorrection>>;
export function buildStockCorrection(db: D1Database, plan: StockCorrectionPlan, key: string, source: "web" | "integration", at: string) {
  const { owner, state, original, replacement, input, projection } = plan;
  const eventId = crypto.randomUUID();
  const currentId = input.currentObservation ? crypto.randomUUID() : null;
  const result: StockResult = { record_id: original.recordId, event_id: eventId, record_revision: replacement.revision, consumable_id: state.consumableId,
    kind: original.kind as StockRecordInput["kind"], occurred_on: replacement.occurredOn, occurred_at: replacement.occurredAt, stock_status: replacement.status,
    performer_id: replacement.performerId, current_stock_status: projection.status ?? state.status, state_effect: projection.effect,
    stock_revision: state.revision + (currentId ? 2 : 1), current_observation_id: currentId, detail_url: `/consumables/${encodeURIComponent(state.consumableId)}`, record_voided: replacement.voided };
  const event: StockEventWrite = { id: eventId, recordId: original.recordId, kind: result.kind, action: replacement.voided ? "voided" : "corrected",
    revision: replacement.revision, previousEventId: original.eventId, refillId: original.refillId,
    moment: { on: replacement.occurredOn ?? "", at: replacement.occurredAt, current: false }, status: replacement.status, performerId: replacement.performerId, key, hash: plan.hash, result };
  const statements = [stockGuardStatement(db, owner, state, [input.changes.performerId ?? null, input.currentObservation?.performerId ?? null]),
    stockEventStatement(db, owner, state.consumableId, event, source, at)];
  const evidenceKeys = [key];
  if (input.currentObservation && currentId) {
    const extra = input.currentObservation;
    const extraKey = `${key}:current_observation`;
    statements.push(stockEventStatement(db, owner, state.consumableId, { ...event, id: currentId, recordId: currentId, revision: 0, previousEventId: null,
      action: "created", kind: "observation", refillId: null, moment: extra.moment, status: extra.status, performerId: extra.performerId, key: extraKey, result: null }, source, at));
    evidenceKeys.push(extraKey);
  }
  const headId = projection.recordId === "@current-stock-observation" ? currentId : projection.recordId;
  if (projection.effect === "applied" && headId) statements.push(...stockProjectionStatements(db, owner, state.consumableId, headId, result.current_stock_status, at));
  statements.push(stockGuardRelease(db, owner, state.consumableId));
  return { statements, result, evidenceKeys };
}
