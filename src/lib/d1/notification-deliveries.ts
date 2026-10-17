import type { IntegrationPrincipal } from "../../features/integration/principal";
import { NotificationError } from "../../features/integration/notifications/contract";
import { requireHouseholdMembership, type D1Session } from "./authorization";
import { currentNotificationCandidate } from "./notification-policy";
import { notificationOwner } from "./notification-settings";
export { evaluateNotification } from "./notification-policy";

export const DELIVERY_OUTCOMES = ["accepted", "reported", "unknown", "failed", "deferred", "cancelled", "suppressed"] as const;
export type DeliveryOutcome = typeof DELIVERY_OUTCOMES[number];
export type DeliveryRecord = { deliveryId: string; candidateId: string; outcome: DeliveryOutcome; reason: string | null };
export type DeliveryHistory = { sequence: number; deliveryId: string; candidateId: string; candidateName: string; connectionId: string; outcome: DeliveryOutcome; reason: string | null; recordedAt: string };
type StoredDelivery = { household_id: string; user_id: string; connection_id: string; outcome: string; reason: string | null; candidate_name: string };
function replay(existing: StoredDelivery | null, principal: IntegrationPrincipal, input: DeliveryRecord): boolean {
  if (!existing) return false;
  if (existing.household_id !== principal.householdId || existing.user_id !== principal.userId || existing.connection_id !== principal.connectionId) throw new NotificationError("not_found");
  if (existing.outcome === input.outcome && existing.reason === input.reason) return true;
  if (existing.outcome !== "deferred" && !(existing.outcome === "accepted" && input.outcome === "reported")) throw new NotificationError("invalid_input");
  return false;
}

// 配信runtime専用。外部入力を直接渡さない。#442でlease世代と実際の送信結果を
// 検証して同じbatchに組み込む。解除と応答が競合しても既に起きた結果は記録する。
export async function recordDelivery(db: D1Database, principal: IntegrationPrincipal, input: DeliveryRecord, now: Date) {
  await requireHouseholdMembership(db, { userId: principal.userId }, principal.householdId);
  const connection = await db.prepare("SELECT 1 FROM oauth_connections WHERE id=? AND household_id=? AND user_id=? AND client_id=?")
    .bind(principal.connectionId, principal.householdId, principal.userId, principal.clientId).first();
  if (!connection) throw new NotificationError("not_found");
  const existing = await db.prepare("SELECT * FROM notification_delivery_history WHERE delivery_id=? AND candidate_id=?")
    .bind(input.deliveryId, input.candidateId).first<StoredDelivery>();
  const minimum = existing ?? await db.prepare("SELECT household_id,user_id,connection_id,outcome,NULL AS reason,'' AS candidate_name FROM notification_delivery_marks WHERE delivery_id=? AND candidate_id=?")
    .bind(input.deliveryId, input.candidateId).first<StoredDelivery>();
  if (replay(minimum, principal, input)) return;
  const candidate = await currentNotificationCandidate(db, principal.householdId, input.candidateId, now);
  if (!candidate && !existing) throw new NotificationError("not_found");
  await db.batch(deliveryRecordStatements(db, principal, input, candidate?.name ?? existing?.candidate_name ?? "", now));
}
// #442の送信結果保存とoutbox更新を同じtransactionへまとめる入口。
export function deliveryRecordStatements(db: D1Database, p: IntegrationPrincipal, input: DeliveryRecord, name: string, now: Date) {
  const values = [input.deliveryId, p.householdId, p.userId, p.connectionId, input.candidateId, input.outcome, now.toISOString()] as const;
  const guardId = `notification:${crypto.randomUUID()}`;
  return [
    // 候補のbatch assertionと同じ一時guardを使い、競合時は履歴と最小記録を共に取り消す。
    db.prepare(`INSERT INTO attention_guards(id,valid) SELECT ?1,CASE WHEN NOT EXISTS(
      SELECT 1 FROM (
        SELECT household_id,user_id,connection_id,outcome FROM notification_delivery_history WHERE delivery_id=?2 AND candidate_id=?3
        UNION ALL SELECT household_id,user_id,connection_id,outcome FROM notification_delivery_marks WHERE delivery_id=?2 AND candidate_id=?3
      ) WHERE household_id<>?4 OR user_id<>?5 OR connection_id<>?6
        OR NOT(outcome=?7 OR outcome='deferred' OR (outcome='accepted' AND ?7='reported'))
      ) THEN 1 ELSE 0 END`).bind(guardId, input.deliveryId, input.candidateId, p.householdId, p.userId, p.connectionId, input.outcome),
    db.prepare(`INSERT INTO notification_delivery_history(delivery_id,household_id,user_id,connection_id,candidate_id,outcome,recorded_at,candidate_name,reason)
      VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9) ON CONFLICT(delivery_id,candidate_id) DO UPDATE SET outcome=excluded.outcome,reason=excluded.reason,
        recorded_at=CASE WHEN notification_delivery_history.outcome='deferred' THEN excluded.recorded_at ELSE notification_delivery_history.recorded_at END
      WHERE notification_delivery_history.household_id=excluded.household_id AND notification_delivery_history.user_id=excluded.user_id
        AND notification_delivery_history.connection_id=excluded.connection_id
        AND (notification_delivery_history.outcome='deferred' OR (notification_delivery_history.outcome='accepted' AND excluded.outcome='reported'))`)
      .bind(...values, name, input.reason),
    db.prepare(`INSERT INTO notification_delivery_marks(delivery_id,household_id,user_id,connection_id,candidate_id,outcome,recorded_at)
      SELECT ?1,?2,?3,?4,?5,?6,?7 WHERE ?6 IN ('accepted','reported','unknown')
        AND EXISTS(SELECT 1 FROM attention_candidates WHERE id=?5 AND household_id=?2)
      ON CONFLICT(delivery_id,candidate_id) DO UPDATE SET outcome=excluded.outcome
      WHERE notification_delivery_marks.household_id=excluded.household_id AND notification_delivery_marks.user_id=excluded.user_id
        AND notification_delivery_marks.connection_id=excluded.connection_id AND notification_delivery_marks.outcome='accepted' AND excluded.outcome='reported'`)
      .bind(...values),
    db.prepare("DELETE FROM attention_guards WHERE id=?").bind(guardId),
  ];
}
export async function listDeliveries(db: D1Database, session: D1Session, input: { before?: number; limit?: number }, now = new Date()) {
  const { householdId, userId } = await notificationOwner(db, session);
  const limit = input.limit ?? 20;
  const before = input.before ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50 || !Number.isSafeInteger(before) || before < 1) throw new NotificationError("invalid_input");
  const since = new Date(now.getTime() - 90 * 86_400_000).toISOString();
  const { results } = await db.prepare(`SELECT sequence,delivery_id AS deliveryId,candidate_id AS candidateId,candidate_name AS candidateName,
    connection_id AS connectionId,outcome,reason,recorded_at AS recordedAt FROM notification_delivery_history
    WHERE household_id=? AND user_id=? AND sequence<? AND recorded_at>=? ORDER BY sequence DESC LIMIT ?`)
    .bind(householdId, userId, before, since, limit + 1).all<DeliveryHistory>();
  return { items: results.slice(0, limit), nextBefore: results.length > limit ? results[limit - 1].sequence : null };
}
// #442の定期保守から呼ぶ。詳細だけを小分けに削除し、候補区間の重複抑止は保持。
export async function pruneDeliveryHistory(db: D1Database, now: Date) {
  return db.prepare("DELETE FROM notification_delivery_history WHERE sequence IN (SELECT sequence FROM notification_delivery_history WHERE recorded_at<? ORDER BY recorded_at LIMIT 100)")
    .bind(new Date(now.getTime() - 90 * 86_400_000).toISOString()).run();
}
