import { requireCurrentHouseholdId, requireD1Session, requireHouseholdMembership, type D1Session } from "./authorization";
import { D1NotFoundError } from "./errors";
import { operationClientExpression } from "./integration-operations";
import { StockError, type StockStatus } from "../../features/consumables/stock-contract";
import type { StockFact } from "../../features/consumables/stock-projection";

export type StockOwner = { householdId: string; userId: string };
export type StockRecord = StockFact & { refillId: string | null; performerId: string | null };
type StoredStockRecord = Omit<StockRecord, "voided"> & { voided: number };
export type StockState = { consumableId: string; name: string; status: StockStatus; revision: number; head: StockRecord | null };
export const STOCK_FACT_COLUMNS = `c.record_id AS recordId,c.latest_event_id AS eventId,c.revision,c.kind,
  c.occurred_on AS occurredOn,c.occurred_at AS occurredAt,c.stock_status AS status,c.recorded_at AS recordedAt,
  c.voided,c.root_sequence AS rootSequence,r.refill_id AS refillId,e.performer_user_id AS performerId`;
export async function stockOwner(db: D1Database, session: D1Session): Promise<StockOwner> {
  const user = requireD1Session(session);
  return { userId: user.userId, householdId: await requireCurrentHouseholdId(db, session) };
}
export async function loadStockRecord(db: D1Database, owner: StockOwner, consumableId: string, recordId: string): Promise<StockRecord | null> {
  const row = await db.prepare(`SELECT ${STOCK_FACT_COLUMNS} FROM consumable_stock_current c
    JOIN consumable_stock_events r ON r.id=c.record_id JOIN consumable_stock_events e ON e.id=c.latest_event_id
    WHERE c.household_id=? AND c.consumable_id=? AND c.record_id=?`).bind(owner.householdId, consumableId, recordId).first<StoredStockRecord>();
  return row ? { ...row, voided: row.voided === 1 } : null;
}
export async function loadStockState(db: D1Database, owner: StockOwner, consumableId: string): Promise<StockState> {
  await requireHouseholdMembership(db, { userId: owner.userId }, owner.householdId);
  const row = await db.prepare(`SELECT c.name,c.stock_status AS status,c.stock_revision AS revision,h.record_id AS headId
    FROM consumables c LEFT JOIN consumable_stock_heads h ON h.consumable_id=c.id AND h.household_id=c.household_id
    WHERE c.id=? AND c.household_id=?`).bind(consumableId, owner.householdId).first<{ name: string; status: StockStatus; revision: number; headId: string | null }>();
  if (!row) throw new D1NotFoundError("消耗品が見つかりません。");
  return { consumableId, name: row.name, status: row.status, revision: row.revision,
    head: row.headId ? await loadStockRecord(db, owner, consumableId, row.headId) : null };
}
export async function requireStockPerformer(db: D1Database, owner: StockOwner, performerId: string | null, field: string) {
  if (performerId === null) return;
  const row = await db.prepare("SELECT 1 FROM household_members WHERE household_id=? AND user_id=?").bind(owner.householdId, performerId).first();
  if (!row) throw new StockError("invalid_input", field, "not_in_household");
}
export type StockHistoryItem = StockRecord & { createdAt: string; actorId: string | null; actorName: string | null; performerName: string | null;
  source: "unknown" | "web" | "integration"; originalSource: "unknown" | "web" | "integration"; clientId: string | null;
  originalClientId: string | null; latestActorId: string | null; latestActorName: string | null };
export async function listStockHistory(db: D1Database, session: D1Session, consumableId: string, input: { limit?: number; before?: number } = {}) {
  const owner = await stockOwner(db, session);
  await loadStockState(db, owner, consumableId);
  const limit = input.limit ?? 20;
  const before = input.before ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50 || !Number.isSafeInteger(before) || before < 1) throw new StockError("invalid_input", "cursor", "invalid_page");
  const { results } = await db.prepare(`SELECT ${STOCK_FACT_COLUMNS},r.recorded_at AS createdAt,r.actor_user_id AS actorId,a.nickname AS actorName,
    p.nickname AS performerName,e.source,r.source AS originalSource,${operationClientExpression("e")} AS clientId,
    ${operationClientExpression("r")} AS originalClientId,e.actor_user_id AS latestActorId,la.nickname AS latestActorName
    FROM consumable_stock_current c JOIN consumable_stock_events r ON r.id=c.record_id JOIN consumable_stock_events e ON e.id=c.latest_event_id
    LEFT JOIN profiles a ON a.user_id=r.actor_user_id AND EXISTS(SELECT 1 FROM household_members m WHERE m.household_id=c.household_id AND m.user_id=a.user_id)
    LEFT JOIN profiles p ON p.user_id=e.performer_user_id AND EXISTS(SELECT 1 FROM household_members m WHERE m.household_id=c.household_id AND m.user_id=p.user_id)
    LEFT JOIN profiles la ON la.user_id=e.actor_user_id AND EXISTS(SELECT 1 FROM household_members m WHERE m.household_id=c.household_id AND m.user_id=la.user_id)
    WHERE c.household_id=? AND c.consumable_id=? AND c.root_sequence<? ORDER BY c.root_sequence DESC LIMIT ?`)
    .bind(owner.householdId, consumableId, before, limit + 1).all<Omit<StockHistoryItem, "voided"> & { voided: number }>();
  await requireHouseholdMembership(db, session, owner.householdId);
  return { items: results.slice(0, limit).map((row) => ({ ...row, voided: row.voided === 1 })),
    nextBefore: results.length > limit ? results[limit - 1].rootSequence : null };
}
export type StockVersion = { sequence: number; id: string; revision: number; action: "created" | "corrected" | "voided";
  occurredOn: string | null; occurredAt: string | null; status: StockStatus; recordedAt: string;
  performerName: string | null; actorName: string | null; source: "unknown" | "web" | "integration"; clientId: string | null };
export async function listStockVersions(db: D1Database, session: D1Session, consumableId: string, recordId: string, before = Number.MAX_SAFE_INTEGER) {
  const owner = await stockOwner(db, session);
  await loadStockState(db, owner, consumableId);
  if (!Number.isSafeInteger(before) || before < 1) throw new StockError("invalid_input", "cursor");
  const record = await loadStockRecord(db, owner, consumableId, recordId);
  if (!record) throw new StockError("not_found");
  const { results } = await db.prepare(`SELECT e.sequence,e.id,e.revision,e.action,e.occurred_on AS occurredOn,e.occurred_at AS occurredAt,
    e.stock_status AS status,e.recorded_at AS recordedAt,p.nickname AS performerName,a.nickname AS actorName,e.source,${operationClientExpression("e")} AS clientId
    FROM consumable_stock_events e
    LEFT JOIN profiles a ON a.user_id=e.actor_user_id AND EXISTS(SELECT 1 FROM household_members m WHERE m.household_id=e.household_id AND m.user_id=a.user_id)
    LEFT JOIN profiles p ON p.user_id=e.performer_user_id AND EXISTS(SELECT 1 FROM household_members m WHERE m.household_id=e.household_id AND m.user_id=p.user_id)
    WHERE e.household_id=? AND e.consumable_id=? AND e.record_id=? AND e.sequence<? ORDER BY e.sequence DESC LIMIT 21`)
    .bind(owner.householdId, consumableId, recordId, before).all<StockVersion>();
  await requireHouseholdMembership(db, session, owner.householdId);
  return { record, items: results.slice(0, 20), nextBefore: results.length > 20 ? results[19].sequence : null };
}
