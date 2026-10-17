import type { IntegrationPrincipal } from "../../features/integration/principal";
import type { EventFilter } from "../../features/integration/notifications/event-filter";
import { EventSubscriptionError } from "../../features/integration/notifications/event-errors";
import { NOTIFICATION_CONNECTION_ACTIVE } from "./notification-settings";
import { canonicalJson } from "../../features/integration/commands/contract";
const databaseNow = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const activeNow = NOTIFICATION_CONNECTION_ACTIVE.replaceAll("?4", databaseNow);
export type EventSubscriptionRow = { id: string; household_id: string; user_id: string; connection_id: string; event_name: string; filters: string; callback_origin: string; callback_hash: string;
  key_fingerprint: string | null; provider_id: string | null; encrypted_destination: string | null; state: "active" | "revoked" | "expired"; revision: number; verified_at: string | null; expires_at: string };
export type EventSubscriptionIdentity = { id: string; filter: EventFilter; callbackOrigin: string; callbackHash: string };
export async function authorizeEventOwner(db: D1Database, p: IntegrationPrincipal, now: Date) {
  if (!p.scopes.includes("household.read") || !p.scopes.includes("events.subscribe")) throw new EventSubscriptionError("insufficient_scope");
  const row = await db.prepare(`SELECT c.expires_at FROM oauth_connections c WHERE c.id=?1 AND c.household_id=?2 AND c.user_id=?3 AND c.client_id=?5 AND ${NOTIFICATION_CONNECTION_ACTIVE}`)
    .bind(p.connectionId, p.householdId, p.userId, now.toISOString(), p.clientId).first<{ expires_at: string }>();
  if (!row) throw new EventSubscriptionError("connection_unavailable");
  return row;
}
export async function eventSubscription(db: D1Database, p: IntegrationPrincipal, id: string) {
  return db.prepare(`SELECT s.* FROM notification_event_subscriptions s JOIN oauth_connections c ON c.id=s.connection_id
    WHERE s.id=? AND s.household_id=? AND s.user_id=? AND s.connection_id=? AND c.client_id=?`)
    .bind(id, p.householdId, p.userId, p.connectionId, p.clientId).first<EventSubscriptionRow>();
}
export async function validateEventTargets(db: D1Database, p: IntegrationPrincipal, filter: EventFilter) {
  const row = await db.prepare(`SELECT
    (SELECT count(*) FROM task_rules WHERE household_id=?1 AND id IN (SELECT value FROM json_each(?2))) AS todos,
    (SELECT count(*) FROM consumables WHERE household_id=?1 AND id IN (SELECT value FROM json_each(?3))) AS stock`)
    .bind(p.householdId, JSON.stringify(filter.todo_rule_ids ?? []), JSON.stringify(filter.consumable_ids ?? [])).first<{ todos: number; stock: number }>();
  if (row?.todos !== (filter.todo_rule_ids?.length ?? 0) || row.stock !== (filter.consumable_ids?.length ?? 0)) throw new EventSubscriptionError("not_found");
}
export async function activeEventSubscriptionCount(db: D1Database, p: IntegrationPrincipal, exceptId: string, now: Date) {
  const row = await db.prepare("SELECT count(*) AS n FROM notification_event_subscriptions WHERE household_id=? AND user_id=? AND connection_id=? AND id<>? AND state='active' AND expires_at>?")
    .bind(p.householdId, p.userId, p.connectionId, exceptId, now.toISOString()).first<{ n: number }>();
  return row?.n ?? 0;
}
export async function recentWebhookVerification(db: D1Database, p: IntegrationPrincipal, callbackHash: string, keyFingerprint: string, providerId: string, now: Date) {
  return db.prepare(`SELECT verified_at FROM notification_event_subscriptions WHERE household_id=? AND user_id=? AND connection_id=? AND callback_hash=?
    AND key_fingerprint=? AND provider_id=? AND state='active' AND expires_at>? AND verified_at>? ORDER BY verified_at DESC LIMIT 1`)
    .bind(p.householdId, p.userId, p.connectionId, callbackHash, keyFingerprint, providerId, now.toISOString(), new Date(now.getTime() - 900_000).toISOString()).first<{ verified_at: string }>();
}
async function guardedBatch(db: D1Database, statements: D1PreparedStatement[]) {
  try { await db.batch(statements); }
  catch (error) {
    if (error instanceof Error && error.message.includes("CHECK constraint failed: valid=1")) throw new EventSubscriptionError("read_conflict");
    throw error;
  }
}
function ownerGuard(db: D1Database, p: IntegrationPrincipal, id: string) {
  return db.prepare(`INSERT INTO attention_guards(id,valid) SELECT ?6,CASE WHEN EXISTS(SELECT 1 FROM oauth_connections c
    WHERE c.id=?1 AND c.household_id=?2 AND c.user_id=?3 AND c.client_id=?5 AND ${activeNow}) THEN 1 ELSE 0 END`)
    .bind(p.connectionId, p.householdId, p.userId, null, p.clientId, id);
}
type VerifiedInput = EventSubscriptionIdentity & { encryptedDestination: string; keyFingerprint: string; providerId: string; verifiedAt: string; expiresAt: string; expectedRevision: number };
export async function saveEventSubscription(db: D1Database, p: IntegrationPrincipal, input: VerifiedInput, now: Date, commitGuard?: D1PreparedStatement) {
  const guards = [crypto.randomUUID(), crypto.randomUUID()];
  const unchanged = db.prepare(`INSERT INTO attention_guards(id,valid) SELECT ?1,CASE WHEN
    NOT EXISTS(SELECT 1 FROM notification_event_subscriptions s WHERE s.id=?2 AND (s.household_id<>?3 OR s.user_id<>?4 OR s.connection_id<>?5))
    AND coalesce((SELECT revision FROM notification_event_subscriptions WHERE id=?2),0)=?6
    AND ?7>${databaseNow} AND ?11>strftime('%Y-%m-%dT%H:%M:%fZ','now','-15 minutes')
    AND (SELECT count(*) FROM notification_event_subscriptions WHERE connection_id=?5 AND state='active' AND expires_at>${databaseNow} AND id<>?2)<20
    AND NOT EXISTS(SELECT 1 FROM json_each(?8) j LEFT JOIN task_rules r ON r.id=j.value AND r.household_id=?3 WHERE r.id IS NULL)
    AND NOT EXISTS(SELECT 1 FROM json_each(?9) j LEFT JOIN consumables c ON c.id=j.value AND c.household_id=?3 WHERE c.id IS NULL)
    AND EXISTS(SELECT 1 FROM oauth_connections WHERE id=?5 AND expires_at>=?10) THEN 1 ELSE 0 END`)
    .bind(guards[1], input.id, p.householdId, p.userId, p.connectionId, input.expectedRevision, input.expiresAt,
      JSON.stringify(input.filter.todo_rule_ids ?? []), JSON.stringify(input.filter.consumable_ids ?? []), input.expiresAt, input.verifiedAt);
  const save = db.prepare(`INSERT INTO notification_event_subscriptions(id,household_id,user_id,connection_id,event_name,filters,callback_origin,callback_hash,
    key_fingerprint,provider_id,encrypted_destination,state,verified_at,expires_at,created_at,updated_at)
    VALUES(?1,?2,?3,?4,'attention.ready',?5,?6,?7,?8,?9,?10,'active',?11,?12,?13,?13)
    ON CONFLICT(id) DO UPDATE SET key_fingerprint=excluded.key_fingerprint,provider_id=excluded.provider_id,encrypted_destination=excluded.encrypted_destination,
      state='active',verified_at=excluded.verified_at,expires_at=excluded.expires_at,stopped_at=NULL,updated_at=excluded.updated_at,revision=notification_event_subscriptions.revision+1`)
    .bind(input.id, p.householdId, p.userId, p.connectionId, canonicalJson(input.filter), input.callbackOrigin, input.callbackHash,
      input.keyFingerprint, input.providerId, input.encryptedDestination, input.verifiedAt, input.expiresAt, now.toISOString());
  await guardedBatch(db, [...(commitGuard ? [commitGuard] : []), ownerGuard(db, p, guards[0]), unchanged, save,
    db.prepare("DELETE FROM attention_guards WHERE id IN (?,?)").bind(...guards)]);
}
export async function stopEventSubscription(db: D1Database, p: IntegrationPrincipal, input: EventSubscriptionIdentity, now: Date, commitGuard?: D1PreparedStatement) {
  const guard = crypto.randomUUID();
  // 未保存の購読にもtombstoneを残し、確認中だった古い要求による復活を防ぐ。
  await guardedBatch(db, [...(commitGuard ? [commitGuard] : []), ownerGuard(db, p, guard),
    db.prepare(`INSERT INTO notification_event_subscriptions(id,household_id,user_id,connection_id,event_name,filters,callback_origin,callback_hash,state,expires_at,stopped_at,created_at,updated_at)
      VALUES(?1,?2,?3,?4,'attention.ready',?5,?6,?7,'revoked',?8,?8,?8,?8)
      ON CONFLICT(id) DO UPDATE SET state='revoked',encrypted_destination=NULL,key_fingerprint=NULL,stopped_at=excluded.stopped_at,updated_at=excluded.updated_at,
        revision=notification_event_subscriptions.revision+1 WHERE notification_event_subscriptions.household_id=?2 AND notification_event_subscriptions.user_id=?3 AND notification_event_subscriptions.connection_id=?4`)
      .bind(input.id, p.householdId, p.userId, p.connectionId, canonicalJson(input.filter), input.callbackOrigin, input.callbackHash, now.toISOString()),
    db.prepare("DELETE FROM attention_guards WHERE id=?").bind(guard)]);
}
export async function pruneEventSubscriptions(db: D1Database, now: Date) {
  await db.batch([
    db.prepare(`UPDATE notification_event_subscriptions SET state='expired',encrypted_destination=NULL,key_fingerprint=NULL,stopped_at=?1,updated_at=?1,revision=revision+1
      WHERE id IN (SELECT s.id FROM notification_event_subscriptions s WHERE s.state='active' AND (s.expires_at<=?1 OR NOT EXISTS(
        SELECT 1 FROM oauth_connections c WHERE c.id=s.connection_id AND ${NOTIFICATION_CONNECTION_ACTIVE.replaceAll("?4", "?1")})) ORDER BY s.expires_at,s.id LIMIT 100)`).bind(now.toISOString()),
    db.prepare("DELETE FROM notification_event_subscriptions WHERE id IN (SELECT id FROM notification_event_subscriptions WHERE state<>'active' AND updated_at<? ORDER BY updated_at,id LIMIT 100)")
      .bind(new Date(now.getTime() - 90 * 86_400_000).toISOString()),
  ]);
}
