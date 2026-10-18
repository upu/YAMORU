import type { IntegrationPrincipal } from "../../features/integration/principal";
import { CommandError } from "../../features/integration/commands/contract";
import { NotificationError } from "../../features/integration/notifications/contract";
import { notificationOutboxStorage as storage } from "./notification-outbox";
import { evaluateNotificationPage, readNotificationPolicyFrame, type NotificationEvaluation, type NotificationPolicyFrame } from "./notification-policy";

export const pollDatabaseNow = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
export type PollParent = { delivery_id: string; candidate_id: string; candidate_name: string; revision: number; state: string; next_attempt_at: string; lease_token: string | null; attempts: number; first_sent_at: string | null; event_delivery: number };
export type PollClaim = { id: string; state: "claimed" | "reported" | "unknown" | "empty"; lease_token: string | null; lease_expires_at: string | null; revision: number; item_count: number; terminal_at: string | null; result: string | null };
export type PollSelected = { id: string; evaluation: NotificationEvaluation; parent: PollParent | undefined };
export function pollLeaseToken(row: PollClaim) {
  if (!row.lease_token) throw new Error("missing_poll_lease");
  return row.lease_token;
}
export async function pollFrame(db: D1Database, p: IntegrationPrincipal, now: Date) {
  let frame: NotificationPolicyFrame;
  try { await storage.requireIdentity(db, p); frame = await readNotificationPolicyFrame(db, p, now); }
  catch (error) {
    if (error instanceof NotificationError) throw new CommandError(error.code === "insufficient_scope" ? "insufficient_scope" : "not_found");
    throw error;
  }
  if (!frame.usable) throw new CommandError("connection_revoked");
  if (!frame.settings.enabled || frame.settings.muted || frame.settings.connectionId !== p.connectionId) throw new CommandError("invalid_input", { fieldErrors: { notification_settings: "enable_for_connection_required" } });
  return frame;
}
export function pollPolicyGuard(db: D1Database, p: IntegrationPrincipal, frame: NotificationPolicyFrame, id: string) {
  return db.prepare(`INSERT INTO attention_guards(id,valid) SELECT ?1,CASE WHEN
    EXISTS(SELECT 1 FROM household_read_versions WHERE household_id=?2 AND epoch=?6 AND version=?7)
    AND EXISTS(SELECT 1 FROM notification_settings WHERE household_id=?2 AND user_id=?3 AND connection_id=?4 AND revision=?8
      AND json_extract(settings,'$.enabled')=1 AND coalesce(json_extract(settings,'$.muted'),0)=0)
    AND EXISTS(SELECT 1 FROM oauth_connections c JOIN users u ON u.id=c.user_id
      JOIN household_members m ON m.household_id=c.household_id AND m.user_id=c.user_id
      WHERE c.id=?4 AND c.household_id=?2 AND c.user_id=?3 AND c.client_id=?5 AND c.revoked_at IS NULL
        AND c.expires_at>${pollDatabaseNow} AND c.user_session_version=u.session_version
        AND instr(' '||c.scopes||' ',' household.read ')>0 AND instr(' '||c.scopes||' ',' events.subscribe ')>0)
    THEN 1 ELSE 0 END`).bind(id, p.householdId, p.userId, p.connectionId, p.clientId, frame.epoch, frame.version, frame.settingsRevision);
}
function skippedReason(e: NotificationEvaluation, expected: string, id: string, parent: PollParent | undefined, now: Date) {
  if (!e.candidate) return "candidate_resolved";
  if (!e.candidate.projectionCurrent || expected !== JSON.stringify([1, id, e.candidate.revision])) return "stale_candidate";
  if (e.decision.state !== "ready") return e.decision.reason;
  if (!parent) return null;
  if (parent.event_delivery) return "event_delivery";
  if (parent.state === "failed") return "delivery_failed";
  if (!["pending", "retry_wait"].includes(parent.state)) return "delivery_busy";
  if (parent.next_attempt_at > now.toISOString()) return "retry_wait";
  if (parent.attempts >= 8 || (parent.first_sent_at && now.getTime() - Date.parse(parent.first_sent_at) >= 86_400_000)) return "retry_limit";
  return null;
}
export async function selectPollCandidates(db: D1Database, p: IntegrationPrincipal, ids: string[], revisions: Record<string, string>, now: Date) {
  const frame = await pollFrame(db, p, now);
  const evaluated = await evaluateNotificationPage(db, p, ids, now, frame);
  const parents = (await db.prepare(`SELECT o.*,EXISTS(SELECT 1 FROM notification_event_batches b WHERE b.delivery_id=o.delivery_id) AS event_delivery
    FROM notification_outbox o WHERE o.household_id=? AND o.user_id=? AND o.connection_id=?
      AND o.candidate_id IN (SELECT value FROM json_each(?)) AND o.state IN ('pending','leased','sending','retry_wait','unknown','failed')`)
    .bind(p.householdId, p.userId, p.connectionId, JSON.stringify(ids)).all<PollParent>()).results;
  const byId = new Map(parents.map((r) => [r.candidate_id, r]));
  const selected: PollSelected[] = []; const skipped: { candidate_id: string; reason: string }[] = [];
  for (const id of ids) {
    const evaluation = evaluated.get(id); if (!evaluation) throw new Error("missing_poll_evaluation");
    const parent = byId.get(id);
    const reason = skippedReason(evaluation, revisions[id], id, parent, now);
    if (reason) skipped.push({ candidate_id: id, reason }); else selected.push({ id, evaluation, parent });
  }
  return { frame, selected, skipped };
}
export async function readPollClaim(db: D1Database, p: IntegrationPrincipal, id: string, token: string) {
  await storage.requireIdentity(db, p).catch((error: unknown) => { if (error instanceof NotificationError) throw new CommandError("not_found"); throw error; });
  const row = await db.prepare(`SELECT * FROM notification_poll_claims WHERE id=? AND household_id=? AND user_id=? AND connection_id=? AND lease_token=?`)
    .bind(id, p.householdId, p.userId, p.connectionId, token).first<PollClaim>();
  if (!row) throw new CommandError("not_found");
  return row;
}
export async function pollMembers(db: D1Database, p: IntegrationPrincipal, id: string) {
  return (await db.prepare(`SELECT o.* FROM notification_poll_claim_items i JOIN notification_outbox o
    ON o.delivery_id=i.delivery_id AND o.household_id=i.household_id AND o.user_id=i.user_id AND o.connection_id=i.connection_id
    WHERE i.claim_id=? AND i.household_id=? AND i.user_id=? AND i.connection_id=? ORDER BY o.delivery_id LIMIT 51`)
    .bind(id, p.householdId, p.userId, p.connectionId).all<PollParent>()).results;
}
export function pollClaimGuard(db: D1Database, p: IntegrationPrincipal, row: PollClaim, id: string, expired = false) {
  return db.prepare(`INSERT INTO attention_guards(id,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM notification_poll_claims
    WHERE id=? AND household_id=? AND user_id=? AND connection_id=? AND revision=? AND state=? AND lease_token=?
      AND (state<>'claimed' OR lease_expires_at${expired ? "<=" : ">"}${pollDatabaseNow})) THEN 1 ELSE 0 END`)
    .bind(id, row.id, p.householdId, p.userId, p.connectionId, row.revision, row.state, row.lease_token);
}
export function pollMembershipGuard(db: D1Database, row: PollClaim, members: PollParent[], id: string, complete: boolean) {
  return db.prepare(`INSERT INTO attention_guards(id,valid) SELECT ?,CASE WHEN
    (SELECT count(*) FROM notification_poll_claim_items WHERE claim_id=?)=? AND NOT EXISTS(
      SELECT 1 FROM notification_poll_claim_items WHERE claim_id=? AND delivery_id NOT IN (SELECT value FROM json_each(?))) THEN 1 ELSE 0 END`)
    .bind(id, row.id, complete ? row.item_count : members.length, row.id, JSON.stringify(members.map((m) => m.delivery_id)));
}
