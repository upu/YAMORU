import type { StockKind, StockMoment, StockStatus } from "../../features/consumables/stock-contract";
import type { StockOwner, StockState } from "./consumable-stock-read";

export type StockResult = { record_id: string; event_id: string; record_revision: number; consumable_id: string; kind: StockKind;
  occurred_on: string | null; occurred_at: string | null; stock_status: StockStatus; performer_id: string | null;
  current_stock_status: StockStatus; state_effect: "applied" | "history_only"; stock_revision: number;
  current_observation_id: string | null; detail_url: string; record_voided: boolean };
export type StockEventWrite = { id: string; recordId: string; kind: StockKind; action: "created" | "corrected" | "voided";
  revision: number; previousEventId: string | null; refillId: string | null; moment: StockMoment; status: StockStatus;
  performerId: string | null; key: string; hash: string; result: StockResult | null };
export function stockGuardStatement(db: D1Database, owner: StockOwner, state: StockState, performers: [string | null, string | null]) {
  return db.prepare(`INSERT INTO consumable_stock_write_guards(consumable_id,household_id,valid)
    SELECT ?1,?2,CASE WHEN c.stock_revision=?4 AND EXISTS(SELECT 1 FROM household_members WHERE household_id=?2 AND user_id=?3)
      AND (?5 IS NULL OR EXISTS(SELECT 1 FROM household_members WHERE household_id=?2 AND user_id=?5))
      AND (?6 IS NULL OR EXISTS(SELECT 1 FROM household_members WHERE household_id=?2 AND user_id=?6)) THEN 1 ELSE 0 END
    FROM consumables c WHERE c.id=?1 AND c.household_id=?2`)
    .bind(state.consumableId, owner.householdId, owner.userId, state.revision, ...performers);
}
export function stockEventStatement(db: D1Database, owner: StockOwner, consumableId: string, event: StockEventWrite, source: "web" | "integration", at: string) {
  return db.prepare(`INSERT INTO consumable_stock_events(id,record_id,household_id,consumable_id,kind,action,revision,previous_event_id,refill_id,
    occurred_on,occurred_at,stock_status,recorded_at,actor_user_id,performer_user_id,source,idempotency_key,request_hash,result)
    VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)`)
    .bind(event.id, event.recordId, owner.householdId, consumableId, event.kind, event.action, event.revision, event.previousEventId, event.refillId,
      event.moment.on, event.moment.at, event.status, at, owner.userId, event.performerId, source, event.key, event.hash, event.result ? JSON.stringify(event.result) : null);
}
export function stockProjectionStatements(db: D1Database, owner: StockOwner, consumableId: string, recordId: string, status: StockStatus, at: string) {
  return [db.prepare("UPDATE consumables SET stock_status=?,updated_at=? WHERE id=? AND household_id=?").bind(status, at, consumableId, owner.householdId),
    db.prepare(`INSERT INTO consumable_stock_heads(consumable_id,household_id,record_id) VALUES(?,?,?)
      ON CONFLICT(consumable_id) DO UPDATE SET record_id=excluded.record_id`).bind(consumableId, owner.householdId, recordId)];
}
export function stockGuardRelease(db: D1Database, owner: StockOwner, consumableId: string) {
  return db.prepare("DELETE FROM consumable_stock_write_guards WHERE consumable_id=? AND household_id=?").bind(consumableId, owner.householdId);
}
