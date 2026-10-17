import { normalizeStockRecord, StockError, type StockRecordDraft } from "../../features/consumables/stock-contract";
import { requireHouseholdMembership, type D1Session } from "./authorization";
import { loadStockState, requireStockPerformer, stockOwner, type StockOwner } from "./consumable-stock-read";
import { buildStockRecord, planStockRecord, stockRecordHash } from "./consumable-stock-plans";
import type { StockResult } from "./consumable-stock-statements";
import { normalizeStockCorrection, stockCorrectionHash, type StockCorrectionDraft } from "../../features/consumables/stock-correction";
import { buildStockCorrection, planStockCorrection } from "./consumable-stock-correction-plans";
export { listStockHistory } from "./consumable-stock-read";
export type { StockHistoryItem } from "./consumable-stock-read";

export type StockWriteOptions = { operationId: string; expectedRevision?: number; now?: Date };
function validateOptions(options: StockWriteOptions) {
  if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(options.operationId)) throw new StockError("invalid_input", "operation_id", "uuid_required");
  if (options.expectedRevision !== undefined && (!Number.isSafeInteger(options.expectedRevision) || options.expectedRevision < 0)) throw new StockError("invalid_input", "stock_revision", "revision_required");
}
export async function findStockReplay(db: D1Database, owner: StockOwner, consumableId: string, key: string, hash: string): Promise<StockResult | null> {
  const row = await db.prepare("SELECT actor_user_id,consumable_id,request_hash,result FROM consumable_stock_events WHERE household_id=? AND idempotency_key=?")
    .bind(owner.householdId, key).first<{ actor_user_id: string | null; consumable_id: string; request_hash: string; result: string | null }>();
  if (!row) return null;
  if (row.actor_user_id !== owner.userId || row.consumable_id !== consumableId || row.request_hash !== hash) throw new StockError("idempotency_conflict");
  if (row.result === null) throw new Error("Stock operation has no saved result");
  return JSON.parse(row.result) as StockResult;
}
export async function recordStock(db: D1Database, session: D1Session, consumableId: string, draft: StockRecordDraft, options: StockWriteOptions) {
  validateOptions(options);
  const now = new Date(options.now?.getTime() ?? Date.now());
  const owner = await stockOwner(db, session);
  const input = normalizeStockRecord(draft, owner.userId, now);
  const hash = await stockRecordHash(consumableId, input);
  const previous = await findStockReplay(db, owner, consumableId, options.operationId, hash);
  if (previous) return { ...previous, replayed: true };
  const plan = await planStockRecord(db, owner, consumableId, input, now, options.expectedRevision);
  const write = buildStockRecord(db, plan, options.operationId, "web", now.toISOString());
  try { await db.batch(write.statements); }
  catch (error) {
    await requireHouseholdMembership(db, session, owner.householdId);
    const replay = await findStockReplay(db, owner, consumableId, options.operationId, hash);
    if (replay) return { ...replay, replayed: true };
    const latest = await loadStockState(db, owner, consumableId);
    if (latest.revision !== plan.state.revision) throw new StockError("stale_stock");
    await requireStockPerformer(db, owner, input.performerId, "performer_id");
    if (input.currentObservation) await requireStockPerformer(db, owner, input.currentObservation.performerId, "current_observation.performer_id");
    throw error;
  }
  return { ...write.result, replayed: false };
}
export async function correctStock(db: D1Database, session: D1Session, consumableId: string, draft: StockCorrectionDraft, options: StockWriteOptions) {
  validateOptions(options);
  const now = new Date(options.now?.getTime() ?? Date.now());
  const owner = await stockOwner(db, session);
  const input = normalizeStockCorrection(draft, owner.userId, now);
  const hash = await stockCorrectionHash(consumableId, input);
  const previous = await findStockReplay(db, owner, consumableId, options.operationId, hash);
  if (previous) return { ...previous, replayed: true };
  const plan = await planStockCorrection(db, owner, consumableId, input, now, options.expectedRevision);
  const write = buildStockCorrection(db, plan, options.operationId, "web", now.toISOString());
  try { await db.batch(write.statements); }
  catch (error) {
    await requireHouseholdMembership(db, session, owner.householdId);
    const replay = await findStockReplay(db, owner, consumableId, options.operationId, hash);
    if (replay) return { ...replay, replayed: true };
    const latest = await loadStockState(db, owner, consumableId);
    if (latest.revision !== plan.state.revision) throw new StockError("stale_stock");
    if (input.changes.performerId !== undefined) await requireStockPerformer(db, owner, input.changes.performerId, "performer_id");
    if (input.currentObservation) await requireStockPerformer(db, owner, input.currentObservation.performerId, "current_observation.performer_id");
    throw error;
  }
  return { ...write.result, replayed: false };
}
