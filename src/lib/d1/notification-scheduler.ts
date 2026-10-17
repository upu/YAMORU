import type { IntegrationPrincipal } from "../../features/integration/principal";
import { parseStoredScopes } from "../../features/integration/scopes";
export type SchedulerPosition = { source_epoch: string; source_version: number; source_day: string; source_after: string; candidate_after: string; outbox_after: string };
export type SchedulerLease = SchedulerPosition & { connection_id: string; household_id: string; user_id: string; lease_token: string };
const databaseNow = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
export async function seedNotificationSchedule(db: D1Database, allowedClientIds: readonly string[], now: Date) {
  await db.prepare(`INSERT INTO notification_scheduler_progress(connection_id,household_id,user_id,next_run_at)
    SELECT c.id,c.household_id,c.user_id,?2 FROM oauth_connections c WHERE
      instr(' '||c.scopes||' ',' household.read ')>0 AND instr(' '||c.scopes||' ',' events.subscribe ')>0
      AND ((c.client_id IN (SELECT value FROM json_each(?1)) AND EXISTS(SELECT 1 FROM notification_settings s
        WHERE s.household_id=c.household_id AND s.user_id=c.user_id AND s.connection_id=c.id AND json_extract(s.settings,'$.enabled')=1))
        OR EXISTS(SELECT 1 FROM notification_outbox o WHERE o.connection_id=c.id AND o.state IN ('pending','leased','sending','retry_wait')))
    ON CONFLICT DO NOTHING`).bind(JSON.stringify(allowedClientIds), now.toISOString()).run();
}
export async function claimNotificationSchedule(db: D1Database, now: Date) {
  return db.prepare(`UPDATE notification_scheduler_progress SET lease_token=?2,lease_expires_at=?3 WHERE connection_id=(
    SELECT connection_id FROM notification_scheduler_progress WHERE next_run_at<=?1
      AND (lease_token IS NULL OR lease_expires_at<=${databaseNow}) ORDER BY next_run_at,connection_id LIMIT 1)
    AND (lease_token IS NULL OR lease_expires_at<=${databaseNow}) RETURNING *`)
    .bind(now.toISOString(), crypto.randomUUID(), new Date(now.getTime() + 120_000).toISOString()).first<SchedulerLease>();
}
export async function schedulerPrincipal(db: D1Database, lease: SchedulerLease): Promise<IntegrationPrincipal | null> {
  const row = await db.prepare("SELECT client_id,scopes FROM oauth_connections WHERE id=? AND household_id=? AND user_id=?")
    .bind(lease.connection_id, lease.household_id, lease.user_id).first<{ client_id: string; scopes: string }>();
  if (!row) return null;
  return { connectionId: lease.connection_id, householdId: lease.household_id, userId: lease.user_id, clientId: row.client_id, scopes: parseStoredScopes(row.scopes) };
}
export async function finishNotificationSchedule(db: D1Database, lease: SchedulerLease, position: SchedulerPosition, now: Date, error: "conflict" | "unavailable" | null = null) {
  await db.prepare(`UPDATE notification_scheduler_progress SET source_epoch=?4,source_version=?5,source_day=?6,source_after=?7,candidate_after=?8,outbox_after=?9,
    next_run_at=?10,last_success_at=CASE WHEN ?11 IS NULL THEN ?3 ELSE last_success_at END,last_error=?11,lease_token=NULL,lease_expires_at=NULL
    WHERE connection_id=?1 AND lease_token=?2 AND lease_expires_at>${databaseNow}`)
    .bind(lease.connection_id, lease.lease_token, now.toISOString(), position.source_epoch, position.source_version, position.source_day,
      position.source_after, position.candidate_after, position.outbox_after, new Date(now.getTime() + 300_000).toISOString(), error).run();
}
export async function schedulerCandidatePage(db: D1Database, householdId: string, after: string, limit: number) {
  const rows = (await db.prepare("SELECT id FROM attention_candidates WHERE household_id=? AND id>? ORDER BY id LIMIT ?")
    .bind(householdId, after, limit + 1).all<{ id: string }>()).results;
  return { ids: rows.slice(0, limit).map((row) => row.id), nextAfter: rows.length > limit ? rows[limit - 1].id : "" };
}
