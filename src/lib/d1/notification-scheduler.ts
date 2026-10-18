import type { IntegrationPrincipal } from "../../features/integration/principal";
import { parseStoredScopes } from "../../features/integration/scopes";
import { NOTIFICATION_CONNECTION_ACTIVE } from "./notification-settings";
export type SchedulerPosition = { source_epoch: string; source_version: number; source_day: string; source_after: string; candidate_after: string; outbox_after: string };
export type SchedulerLease = SchedulerPosition & { connection_id: string; household_id: string; user_id: string; lease_token: string };
const databaseNow = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
export function notificationScheduleGuard(db: D1Database, p: IntegrationPrincipal, lease: SchedulerLease, id: string) {
  return db.prepare(`INSERT INTO attention_guards(id,valid) SELECT ?,CASE WHEN ?=? AND ?=? AND ?=? AND EXISTS(
    SELECT 1 FROM notification_scheduler_progress WHERE connection_id=? AND household_id=? AND user_id=?
      AND lease_token=? AND lease_expires_at>${databaseNow}) THEN 1 ELSE 0 END`)
    .bind(id, p.connectionId, lease.connection_id, p.householdId, lease.household_id, p.userId, lease.user_id,
      p.connectionId, p.householdId, p.userId, lease.lease_token);
}
function wantedConnection(clients: string, instant: string) {
  return `((c.client_id IN (SELECT value FROM json_each(${clients})) AND ${NOTIFICATION_CONNECTION_ACTIVE.replaceAll("?4", instant)}
    AND EXISTS(SELECT 1 FROM notification_settings s WHERE s.household_id=c.household_id AND s.user_id=c.user_id
      AND s.connection_id=c.id AND json_extract(s.settings,'$.enabled')=1 AND coalesce(json_extract(s.settings,'$.muted'),0)=0))
    OR EXISTS(SELECT 1 FROM notification_outbox o WHERE o.connection_id=c.id AND o.state IN ('pending','leased','sending','retry_wait'))
    OR EXISTS(SELECT 1 FROM notification_event_groups g WHERE g.connection_id=c.id AND g.state IN ('pending','retry_wait'))
    OR EXISTS(SELECT 1 FROM notification_event_groups g WHERE g.connection_id=c.id AND g.state='sending'))`;
}
export async function seedNotificationSchedule(db: D1Database, allowedClientIds: readonly string[], now: Date) {
  const eligible = wantedConnection("?1", "?2");
  const values = [JSON.stringify(allowedClientIds), now.toISOString()];
  await db.batch([
    db.prepare(`DELETE FROM notification_scheduler_progress WHERE connection_id IN (
      SELECT p.connection_id FROM notification_scheduler_progress p WHERE (p.lease_token IS NULL OR p.lease_expires_at<=${databaseNow})
      AND NOT EXISTS(SELECT 1 FROM oauth_connections c WHERE c.id=p.connection_id AND ${eligible})
      ORDER BY p.next_run_at,p.connection_id LIMIT 100)`).bind(...values),
    db.prepare(`INSERT INTO notification_scheduler_progress(connection_id,household_id,user_id,next_run_at)
      SELECT c.id,c.household_id,c.user_id,?2 FROM oauth_connections c WHERE ${eligible}
      ON CONFLICT DO NOTHING`).bind(...values),
  ]);
}
export async function claimNotificationSchedule(db: D1Database, now: Date, allowedClientIds: readonly string[]) {
  return db.prepare(`UPDATE notification_scheduler_progress SET lease_token=?2,lease_expires_at=?3 WHERE connection_id=(
    SELECT p.connection_id FROM notification_scheduler_progress p JOIN oauth_connections c ON c.id=p.connection_id WHERE p.next_run_at<=?1
      AND (p.lease_token IS NULL OR p.lease_expires_at<=${databaseNow}) AND ${wantedConnection("?4", "?1")}
      ORDER BY p.next_run_at,p.connection_id LIMIT 1)
    AND (lease_token IS NULL OR lease_expires_at<=${databaseNow}) RETURNING *`)
    .bind(now.toISOString(), crypto.randomUUID(), new Date(now.getTime() + 120_000).toISOString(), JSON.stringify(allowedClientIds)).first<SchedulerLease>();
}
export async function schedulerPrincipal(db: D1Database, lease: SchedulerLease): Promise<IntegrationPrincipal | null> {
  const row = await db.prepare("SELECT client_id,scopes FROM oauth_connections WHERE id=? AND household_id=? AND user_id=?")
    .bind(lease.connection_id, lease.household_id, lease.user_id).first<{ client_id: string; scopes: string }>();
  if (!row) return null;
  return { connectionId: lease.connection_id, householdId: lease.household_id, userId: lease.user_id, clientId: row.client_id, scopes: parseStoredScopes(row.scopes) };
}
export async function finishNotificationSchedule(db: D1Database, lease: SchedulerLease, position: SchedulerPosition, now: Date, allowedClientIds: readonly string[], error: "conflict" | "unavailable" | null = null) {
  await db.batch([
    db.prepare(`DELETE FROM notification_scheduler_progress WHERE connection_id=?1 AND lease_token=?2 AND lease_expires_at>${databaseNow}
      AND NOT EXISTS(SELECT 1 FROM oauth_connections c WHERE c.id=?1 AND ${wantedConnection("?3", "?4")})`)
      .bind(lease.connection_id, lease.lease_token, JSON.stringify(allowedClientIds), now.toISOString()),
    db.prepare(`UPDATE notification_scheduler_progress SET source_epoch=?4,source_version=?5,source_day=?6,source_after=?7,candidate_after=?8,outbox_after=?9,
    next_run_at=?10,last_success_at=CASE WHEN ?11 IS NULL THEN ?3 ELSE last_success_at END,last_error=?11,lease_token=NULL,lease_expires_at=NULL
    WHERE connection_id=?1 AND lease_token=?2 AND lease_expires_at>${databaseNow}`)
    .bind(lease.connection_id, lease.lease_token, now.toISOString(), position.source_epoch, position.source_version, position.source_day,
      position.source_after, position.candidate_after, position.outbox_after, new Date(now.getTime() + 300_000).toISOString(), error),
  ]);
}
export async function schedulerCandidatePage(db: D1Database, householdId: string, after: string, limit: number) {
  const rows = (await db.prepare("SELECT id FROM attention_candidates WHERE household_id=? AND id>? ORDER BY id LIMIT ?")
    .bind(householdId, after, limit + 1).all<{ id: string }>()).results;
  return { ids: rows.slice(0, limit).map((row) => row.id), nextAfter: rows.length > limit ? rows[limit - 1].id : "" };
}
