import type { IntegrationPrincipal } from "../../features/integration/principal";
import { ReadError } from "../../features/integration/read-contract";
import { isConnectionActive } from "./oauth-connections";

export type NotificationReference = { delivery_id: string; candidate_id: string };
export type ReplySource = { kind: "todo_occurrence" | "consumable"; id: string; todo_rule_id: string | null };
type ReplyRow = { delivery_id: string; candidate_id: string; candidate_name: string; kind: ReplySource["kind"] | null; entity_id: string | null; todo_rule_id: string | null; terminal_at: string | null; live: number };
const OWNER = "o.household_id=?1 AND o.user_id=?2 AND o.connection_id=?3";
const MEMBER = `EXISTS(SELECT 1 FROM oauth_connections c JOIN users u ON u.id=c.user_id
  JOIN household_members m ON m.household_id=c.household_id AND m.user_id=c.user_id
  WHERE c.id=?3 AND c.household_id=?1 AND c.user_id=?2 AND c.client_id=?4
    AND c.revoked_at IS NULL AND c.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND c.user_session_version=u.session_version
    AND instr(' '||c.scopes||' ',' household.read ')>0 AND instr(' '||c.scopes||' ',' notifications.manage ')>0)`;
function referenceCondition(current: boolean) {
  const expiry = current ? "AND (h.terminal_at IS NULL OR (h.terminal_at>=?6 AND h.terminal_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-90 days')))" : "";
  return `(o.delivery_id=?5 OR EXISTS(SELECT 1 FROM notification_poll_claim_items i
  JOIN notification_poll_claims h ON h.id=i.claim_id AND h.household_id=i.household_id AND h.user_id=i.user_id AND h.connection_id=i.connection_id
  WHERE i.delivery_id=o.delivery_id AND i.household_id=o.household_id AND i.user_id=o.user_id AND i.connection_id=o.connection_id
    AND h.id=?5 ${expiry}))`;
}
const FROM = `FROM notification_outbox o LEFT JOIN notification_outbox_sources s
  ON s.delivery_id=o.delivery_id AND s.household_id=o.household_id AND s.user_id=o.user_id AND s.connection_id=o.connection_id
  LEFT JOIN task_occurrences t ON s.kind='todo_occurrence' AND t.id=s.entity_id AND t.household_id=o.household_id AND t.task_rule_id=s.todo_rule_id
  LEFT JOIN consumables c ON s.kind='consumable' AND c.id=s.entity_id AND c.household_id=o.household_id`;
const LIVE = "((s.kind='todo_occurrence' AND t.id IS NOT NULL) OR (s.kind='consumable' AND c.id IS NOT NULL))";
const cutoff = (now: Date) => new Date(now.getTime() - 90 * 86_400_000).toISOString();
const values = (p: IntegrationPrincipal, id: string, now: Date) => [p.householdId, p.userId, p.connectionId, p.clientId, id, cutoff(now)];

export async function requireNotificationReplyAccess(db: D1Database, p: IntegrationPrincipal, now: Date) {
  if (!p.scopes.includes("household.read") || !p.scopes.includes("notifications.manage")) throw new ReadError("insufficient_scope");
  const row = await db.prepare(`SELECT 1 FROM oauth_connections WHERE id=? AND household_id=? AND user_id=? AND client_id=?
    AND instr(' '||scopes||' ',' household.read ')>0 AND instr(' '||scopes||' ',' notifications.manage ')>0`)
    .bind(p.connectionId, p.householdId, p.userId, p.clientId).first();
  if (!row || !await isConnectionActive(db, p.connectionId, now.toISOString())) throw new ReadError("not_found");
}
export async function readNotificationReplySet(db: D1Database, p: IntegrationPrincipal, id: string, now: Date) {
  await requireNotificationReplyAccess(db, p, now);
  const header = await db.prepare(`SELECT item_count,terminal_at FROM notification_poll_claims
    WHERE id=? AND household_id=? AND user_id=? AND connection_id=?`).bind(id, p.householdId, p.userId, p.connectionId)
    .first<{ item_count: number; terminal_at: string | null }>();
  const rows = (await db.prepare(`SELECT o.delivery_id,o.candidate_id,o.candidate_name,s.kind,s.entity_id,s.todo_rule_id,s.terminal_at,
    CASE WHEN ${LIVE} AND (s.terminal_at IS NULL OR s.terminal_at>=?6) THEN 1 ELSE 0 END AS live
    ${FROM} WHERE ${OWNER} AND ${referenceCondition(false)} ORDER BY o.delivery_id LIMIT 51`)
    .bind(...values(p, id, now)).all<ReplyRow>()).results;
  if ((!header && !rows.length) || rows.length > 50) throw new ReadError("not_found");
  const expired = header?.terminal_at !== null && header?.terminal_at !== undefined && header.terminal_at < cutoff(now);
  return { count: header?.item_count ?? 1, items: rows.map((row) => ({
    delivery_id: row.delivery_id, candidate_id: row.candidate_id,
    name: !expired && row.kind && (row.terminal_at === null || row.terminal_at >= cutoff(now)) ? row.candidate_name : null,
    source: !expired && row.live && row.kind && row.entity_id && (row.terminal_at === null || row.terminal_at >= cutoff(now))
      ? { kind: row.kind, id: row.entity_id, todo_rule_id: row.todo_rule_id } satisfies ReplySource : null,
  })) };
}
export async function notificationReplySource(db: D1Database, p: IntegrationPrincipal, ref: NotificationReference, now: Date) {
  const set = await readNotificationReplySet(db, p, ref.delivery_id, now);
  const item = set.items.find((item) => item.candidate_id === ref.candidate_id);
  if (!item?.source) throw new ReadError("not_found");
  return item.source;
}
// The existing CHECK(valid=1) aborts the whole business/receipt batch if retention or ownership changed.
export function notificationReplyGuard(db: D1Database, p: IntegrationPrincipal, ref: NotificationReference, source: ReplySource, now: Date, id: string) {
  return db.prepare(`INSERT INTO attention_guards(id,valid) SELECT ?7,CASE WHEN ${MEMBER} AND EXISTS(
    SELECT 1 ${FROM} WHERE ${OWNER} AND ${referenceCondition(true)} AND o.candidate_id=?8 AND s.kind=?9 AND s.entity_id=?10 AND ${LIVE}
      AND (s.terminal_at IS NULL OR (s.terminal_at>=?6 AND s.terminal_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-90 days')))
  ) THEN 1 ELSE 0 END`).bind(...values(p, ref.delivery_id, now), id, ref.candidate_id, source.kind, source.id);
}
