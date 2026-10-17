import type { IntegrationPrincipal } from "../../features/integration/principal";
import { NotificationError } from "../../features/integration/notifications/contract";
import { currentNotificationCandidate, evaluateNotification, type NotificationDecision } from "./notification-policy";
import { deliveryRecordStatements, type DeliveryOutcome } from "./notification-deliveries";
import { usableNotificationConnection } from "./notification-settings";
import type { SchedulerLease } from "./notification-scheduler";
import { aggregateRecipientState, eventRecipientStatuses } from "./notification-recipient-state";

type OutboxState = "pending" | "leased" | "sending" | "retry_wait" | Exclude<DeliveryOutcome, "deferred">;
type OutboxRow = { delivery_id: string; candidate_id: string; candidate_name: string; state: OutboxState; lease_token: string; attempts: number; first_sent_at: string | null; revision: number; next_attempt_at: string };
export type NotificationLease = { deliveryId: string; candidateId: string; leaseToken: string };
export type SendResult = { kind: "accepted" | "unknown" | "failed" | "retry"; reason?: string };
export class NotificationOutboxError extends Error {
  constructor(public readonly code: "lease_lost" | "read_conflict") { super(code); }
}
const databaseNow = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const leaseOf = (row: OutboxRow): NotificationLease => ({ deliveryId: row.delivery_id, candidateId: row.candidate_id, leaseToken: row.lease_token });
const retryExhausted = (row: OutboxRow, now: Date) => row.attempts >= 8 || (row.first_sent_at !== null && now.getTime() - Date.parse(row.first_sent_at) >= 86_400_000);
async function sendDecision(db: D1Database, p: IntegrationPrincipal, candidateId: string, now: Date) {
  if (!await usableNotificationConnection(db, p, p.connectionId, now)) return { state: "cancelled" as const, reason: "connection_unavailable", nextAt: null };
  return evaluateNotification(db, p, candidateId, now);
}

async function requireOwner(db: D1Database, p: IntegrationPrincipal) {
  const connection = await db.prepare("SELECT 1 FROM oauth_connections WHERE id=? AND household_id=? AND user_id=? AND client_id=?")
    .bind(p.connectionId, p.householdId, p.userId, p.clientId).first();
  if (!connection) throw new NotificationError("not_found");
}
async function requireIdentity(db: D1Database, p: IntegrationPrincipal) {
  if (!p.scopes.includes("household.read") || !p.scopes.includes("events.subscribe")) throw new NotificationError("insufficient_scope");
  await requireOwner(db, p);
}
type ReadStamp = { epoch: string; version: number; settings_revision: number; control_revision: number; candidate_revision: number };
async function readStamp(db: D1Database, p: IntegrationPrincipal, candidateId: string) {
  const stamp = await db.prepare(`SELECT v.epoch,v.version,coalesce(s.revision,0) AS settings_revision,
    coalesce(t.revision,0) AS control_revision,coalesce(c.revision,0) AS candidate_revision
    FROM household_read_versions v
    LEFT JOIN notification_settings s ON s.household_id=v.household_id AND s.user_id=?2
    LEFT JOIN notification_controls t ON t.household_id=v.household_id AND t.user_id=?2 AND t.candidate_id=?3
    LEFT JOIN attention_candidates c ON c.household_id=v.household_id AND c.id=?3
    WHERE v.household_id=?1`).bind(p.householdId, p.userId, candidateId).first<ReadStamp>();
  if (!stamp) throw new NotificationError("not_found");
  return stamp;
}
function stampGuard(db: D1Database, p: IntegrationPrincipal, candidateId: string, stamp: ReadStamp, id: string, active: boolean, maintenance?: SchedulerLease) {
  return db.prepare(`INSERT INTO attention_guards(id,valid) SELECT ?1,CASE WHEN
    EXISTS(SELECT 1 FROM household_read_versions WHERE household_id=?2 AND epoch=?6 AND version=?7)
    AND coalesce((SELECT revision FROM notification_settings WHERE household_id=?2 AND user_id=?3),0)=?8
    AND coalesce((SELECT revision FROM notification_controls WHERE household_id=?2 AND user_id=?3 AND candidate_id=?10),0)=?9
    AND coalesce((SELECT revision FROM attention_candidates WHERE household_id=?2 AND id=?10),0)=?11
    AND (?13 IS NULL OR EXISTS(SELECT 1 FROM notification_scheduler_progress WHERE connection_id=?4 AND household_id=?2 AND user_id=?3
      AND lease_token=?13 AND lease_expires_at>${databaseNow}))
    AND (?12=0 OR EXISTS(SELECT 1 FROM oauth_connections c JOIN users u ON u.id=c.user_id
      JOIN household_members m ON m.user_id=c.user_id AND m.household_id=c.household_id
      WHERE c.id=?4 AND c.household_id=?2 AND c.user_id=?3 AND c.client_id=?5 AND c.revoked_at IS NULL
        AND c.expires_at>${databaseNow} AND u.session_version=c.user_session_version
        AND instr(' '||c.scopes||' ',' household.read ')>0 AND instr(' '||c.scopes||' ',' events.subscribe ')>0))
    THEN 1 ELSE 0 END`).bind(id, p.householdId, p.userId, p.connectionId, p.clientId, stamp.epoch, stamp.version, stamp.settings_revision, stamp.control_revision, candidateId, stamp.candidate_revision, Number(active), maintenance?.lease_token ?? null);
}
function leaseGuard(db: D1Database, p: IntegrationPrincipal, lease: NotificationLease, id: string, state: "leased" | "sending", expired = false, maintenance?: SchedulerLease, legacy = false) {
  return db.prepare(`INSERT INTO attention_guards(id,valid) SELECT ?1,CASE WHEN EXISTS(
    SELECT 1 FROM notification_outbox o JOIN oauth_connections c ON c.id=o.connection_id
    WHERE o.delivery_id=?2 AND o.household_id=?3 AND o.user_id=?4 AND o.connection_id=?5 AND c.client_id=?6
      AND o.candidate_id=?7 AND o.lease_token=?8 AND o.state=?9
      AND o.lease_expires_at ${expired ? "<=" : ">"} ${databaseNow}
      AND (?11=0 OR NOT EXISTS(SELECT 1 FROM notification_event_batches WHERE delivery_id=o.delivery_id))
      AND (?10 IS NULL OR EXISTS(SELECT 1 FROM notification_scheduler_progress WHERE connection_id=?5 AND household_id=?3 AND user_id=?4
        AND lease_token=?10 AND lease_expires_at>${databaseNow}))) THEN 1 ELSE 0 END`)
    .bind(id, lease.deliveryId, p.householdId, p.userId, p.connectionId, p.clientId, lease.candidateId, lease.leaseToken, state, maintenance?.lease_token ?? null, Number(legacy));
}
function cleanupGuards(db: D1Database, ids: string[]) { return db.prepare("DELETE FROM attention_guards WHERE id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(ids)); }
async function batch(db: D1Database, statements: D1PreparedStatement[], code: "lease_lost" | "read_conflict") {
  try { await db.batch(statements); }
  catch (error) {
    if (error instanceof Error && error.message.includes("CHECK constraint failed: valid=1")) throw new NotificationOutboxError(code);
    throw error;
  }
}
export async function enqueueNotification(db: D1Database, p: IntegrationPrincipal, candidateId: string, now: Date) {
  await requireIdentity(db, p);
  const stamp = await readStamp(db, p, candidateId);
  const decision = await evaluateNotification(db, p, candidateId, now);
  if (decision.state !== "ready" && decision.state !== "deferred") return null;
  const candidate = await currentNotificationCandidate(db, p.householdId, candidateId, now);
  if (!candidate) return null;
  const guard = crypto.randomUUID();
  await batch(db, [stampGuard(db, p, candidateId, stamp, guard, true),
    db.prepare(`INSERT INTO notification_outbox(delivery_id,household_id,user_id,connection_id,candidate_id,candidate_name,state,next_attempt_at,created_at,updated_at)
      VALUES(?,?,?,?,?,?,'pending',?,?,?) ON CONFLICT DO NOTHING`)
      .bind(crypto.randomUUID(), p.householdId, p.userId, p.connectionId, candidateId, candidate.name, decision.nextAt ?? now.toISOString(), now.toISOString(), now.toISOString()),
    cleanupGuards(db, [guard])], "read_conflict");
  return db.prepare(`SELECT delivery_id AS deliveryId FROM notification_outbox WHERE household_id=? AND user_id=? AND connection_id=? AND candidate_id=?
    AND state IN ('pending','leased','sending','retry_wait','unknown','failed')`).bind(p.householdId, p.userId, p.connectionId, candidateId).first<{ deliveryId: string }>();
}
export async function leaseNotification(db: D1Database, p: IntegrationPrincipal, now: Date): Promise<NotificationLease | null> {
  await requireIdentity(db, p);
  if (!await usableNotificationConnection(db, p, p.connectionId, now)) return null;
  const row = await db.prepare(`UPDATE notification_outbox SET state='leased',lease_token=?5,lease_expires_at=?6,updated_at=?4,revision=revision+1
    WHERE delivery_id=(SELECT delivery_id FROM notification_outbox WHERE household_id=?1 AND user_id=?2 AND connection_id=?3
      AND state IN ('pending','retry_wait') AND next_attempt_at<=?4 ORDER BY next_attempt_at,delivery_id LIMIT 1)
      AND state IN ('pending','retry_wait') RETURNING *`)
    .bind(p.householdId, p.userId, p.connectionId, now.toISOString(), crypto.randomUUID(), new Date(now.getTime() + 300_000).toISOString()).first<OutboxRow>();
  return row ? leaseOf(row) : null;
}
async function loadLease(db: D1Database, p: IntegrationPrincipal, lease: NotificationLease, state?: "leased" | "sending") {
  const row = await db.prepare(`SELECT * FROM notification_outbox WHERE delivery_id=? AND household_id=? AND user_id=? AND connection_id=?
    AND candidate_id=? AND lease_token=? AND state IN ('leased','sending') AND (? IS NULL OR state=?) AND lease_expires_at>${databaseNow}`)
    .bind(lease.deliveryId, p.householdId, p.userId, p.connectionId, lease.candidateId, lease.leaseToken, state ?? null, state ?? null).first<OutboxRow>();
  if (!row) throw new NotificationOutboxError("lease_lost");
  return row;
}
function updateOutcome(db: D1Database, lease: NotificationLease, state: OutboxState, reason: string | null, now: Date, nextAt = now.toISOString()) {
  return db.prepare("UPDATE notification_outbox SET state=?,reason=?,next_attempt_at=?,lease_token=NULL,lease_expires_at=NULL,updated_at=?,revision=revision+1 WHERE delivery_id=?")
    .bind(state, reason, nextAt, now.toISOString(), lease.deliveryId);
}
function closedDecision(decision: NotificationDecision | { state: "failed"; reason: string; nextAt: null }) {
  if (decision.state === "deferred") return { state: "pending" as const, outcome: "deferred" as const, reason: decision.reason, nextAt: decision.nextAt };
  if (decision.state === "ready") return { state: "suppressed" as const, outcome: "suppressed" as const, reason: "candidate_resolved", nextAt: null };
  return { state: decision.state, outcome: decision.state, reason: decision.reason, nextAt: decision.nextAt };
}
export async function beginNotificationSend(db: D1Database, p: IntegrationPrincipal, lease: NotificationLease, now: Date) {
  await requireIdentity(db, p);
  await requireLegacyDelivery(db, lease);
  const row = await loadLease(db, p, lease, "leased");
  const stamp = await readStamp(db, p, lease.candidateId);
  const decision = retryExhausted(row, now) ? { state: "failed" as const, reason: "retry_limit", nextAt: null } : await sendDecision(db, p, lease.candidateId, now);
  const candidate = decision.state === "ready" ? await currentNotificationCandidate(db, p.householdId, lease.candidateId, now) : null;
  const guards = [crypto.randomUUID(), crypto.randomUUID()];
  const statements = [leaseGuard(db, p, lease, guards[0], "leased", false, undefined, true), stampGuard(db, p, lease.candidateId, stamp, guards[1], decision.state === "ready")];
  if (decision.state === "ready" && candidate) {
    statements.push(db.prepare(`UPDATE notification_outbox SET state='sending',attempts=attempts+1,first_sent_at=coalesce(first_sent_at,?),candidate_name=?,updated_at=?,revision=revision+1 WHERE delivery_id=?`)
      .bind(now.toISOString(), candidate.name, now.toISOString(), lease.deliveryId));
  } else {
    const { state, outcome, reason, nextAt } = closedDecision(decision);
    statements.push(updateOutcome(db, lease, state, reason, now, nextAt ?? now.toISOString()),
      ...deliveryRecordStatements(db, p, { deliveryId: lease.deliveryId, candidateId: lease.candidateId, outcome, reason }, row.candidate_name, now));
    await batch(db, [...statements, cleanupGuards(db, guards)], "read_conflict");
    return { state, reason };
  }
  await batch(db, [...statements, cleanupGuards(db, guards)], "read_conflict");
  return { state: "sending", reason: "eligible" };
}
function deliveryResult(row: OutboxRow, result: SendResult, now: Date): { state: "accepted" | "unknown" | "failed" | "retry_wait"; nextAt: string; reason: string | null } {
  const exhausted = retryExhausted(row, now);
  const state = result.kind === "retry" ? exhausted ? "failed" : "retry_wait" : result.kind;
  const delay = Math.min(3_600_000, 30_000 * 2 ** Math.max(0, row.attempts - 1));
  const nextAt = state === "retry_wait" ? new Date(now.getTime() + delay + Math.floor(Math.random() * delay / 4)).toISOString() : now.toISOString();
  const reason = exhausted && result.kind === "retry" ? "retry_limit" : result.reason ?? null;
  return { state, nextAt, reason };
}
export async function finishNotificationSend(db: D1Database, p: IntegrationPrincipal, lease: NotificationLease, result: SendResult, now: Date) {
  await requireIdentity(db, p);
  await requireLegacyDelivery(db, lease);
  const row = await loadLease(db, p, lease, "sending");
  const { state, nextAt, reason } = deliveryResult(row, result, now);
  const guard = crypto.randomUUID();
  await batch(db, [leaseGuard(db, p, lease, guard, "sending", false, undefined, true), updateOutcome(db, lease, state, reason, now, nextAt),
    ...(state === "retry_wait" ? [] : deliveryRecordStatements(db, p, { deliveryId: lease.deliveryId, candidateId: lease.candidateId, outcome: state, reason }, row.candidate_name, now)),
    cleanupGuards(db, [guard])], "lease_lost");
  return { state, nextAt };
}
async function recoverRow(db: D1Database, p: IntegrationPrincipal, row: OutboxRow, now: Date, maintenance?: SchedulerLease) {
    const lease = leaseOf(row);
    const guard = crypto.randomUUID();
    const sending = row.state === "sending";
    const outcome = await recoveredOutcome(db, row, now);
    const terminal = outcome.state !== "pending" && outcome.state !== "retry_wait" && outcome.state !== "sending";
    try {
      await batch(db, [leaseGuard(db, p, lease, guard, sending ? "sending" : "leased", true, maintenance),
        db.prepare("UPDATE notification_event_recipients SET state='unknown',attempt_token=NULL,reason='send_interrupted',updated_at=? WHERE delivery_id=? AND state='sending'").bind(now.toISOString(), row.delivery_id),
        updateOutcome(db, lease, outcome.state, outcome.reason, now, outcome.nextAt),
        ...(terminal ? deliveryRecordStatements(db, p, { deliveryId: lease.deliveryId, candidateId: lease.candidateId, outcome: outcome.state, reason: outcome.reason }, row.candidate_name, now) : []),
        cleanupGuards(db, [guard])], "lease_lost");
    } catch (error) { if (!(error instanceof NotificationOutboxError)) throw error; }
}
async function recoveredOutcome(db: D1Database, row: OutboxRow, now: Date) {
  const recipients = await eventRecipientStatuses(db, row.delivery_id);
  if (recipients.length) return aggregateRecipientState(recipients, now, "interrupted");
  const sending = row.state === "sending";
  return { state: sending ? "unknown" as const : "pending" as const, nextAt: now.toISOString(), reason: sending ? "send_interrupted" : "lease_expired" };
}
export async function recoverNotificationLeases(db: D1Database, p: IntegrationPrincipal, now: Date) {
  await requireIdentity(db, p);
  return recoverLeases(db, p, now);
}
async function recoverLeases(db: D1Database, p: IntegrationPrincipal, now: Date, maintenance?: SchedulerLease) {
  const rows = (await db.prepare(`SELECT * FROM notification_outbox WHERE household_id=? AND user_id=? AND connection_id=?
    AND state IN ('leased','sending') AND lease_expires_at<=${databaseNow} ORDER BY lease_expires_at,delivery_id LIMIT 50`)
    .bind(p.householdId, p.userId, p.connectionId).all<OutboxRow>()).results;
  for (const row of rows) await recoverRow(db, p, row, now, maintenance);
  return rows.length;
}
function reconciledTime(row: OutboxRow, decision: NotificationDecision, now: Date) {
  const scheduled = decision.nextAt ?? now.toISOString();
  if (row.state === "retry_wait") return scheduled > row.next_attempt_at ? scheduled : row.next_attempt_at;
  if (decision.state === "ready" && row.next_attempt_at < scheduled) return row.next_attempt_at;
  return scheduled;
}
type StopReason = "client_disabled" | "connection_unavailable";
async function reconcileRow(db: D1Database, p: IntegrationPrincipal, row: OutboxRow, now: Date, stopReason?: StopReason, maintenance?: SchedulerLease) {
  const stamp = await readStamp(db, p, row.candidate_id);
  const decision = stopReason ? { state: "cancelled" as const, reason: stopReason, nextAt: null } : await sendDecision(db, p, row.candidate_id, now);
  const terminalOutcome = decision.state === "cancelled" || decision.state === "suppressed" ? decision.state : null;
  const recipients = terminalOutcome ? await eventRecipientStatuses(db, row.delivery_id) : [];
  const aggregate = recipients.length ? aggregateRecipientState(recipients, now, "cancel") : null;
  const state = aggregate?.state ?? terminalOutcome ?? row.state;
  const reason = aggregate?.reason ?? decision.reason;
  const guards = [crypto.randomUUID(), crypto.randomUUID()];
  const unchanged = db.prepare(`INSERT INTO attention_guards(id,valid) SELECT ?,CASE WHEN EXISTS(
    SELECT 1 FROM notification_outbox WHERE delivery_id=? AND household_id=? AND user_id=? AND connection_id=? AND revision=?
      AND state IN ('pending','retry_wait')) THEN 1 ELSE 0 END`)
    .bind(guards[0], row.delivery_id, p.householdId, p.userId, p.connectionId, row.revision);
  await batch(db, [unchanged, stampGuard(db, p, row.candidate_id, stamp, guards[1], terminalOutcome === null, maintenance),
    ...(terminalOutcome ? [db.prepare("UPDATE notification_event_recipients SET state='cancelled',reason=?,updated_at=? WHERE delivery_id=? AND state IN ('pending','retry_wait')").bind(decision.reason, now.toISOString(), row.delivery_id)] : []),
    updateOutcome(db, leaseOf(row), state, reason, now, reconciledTime(row, decision, now)),
    ...(terminalOutcome ? deliveryRecordStatements(db, p, { deliveryId: row.delivery_id, candidateId: row.candidate_id, outcome: state as DeliveryOutcome, reason }, row.candidate_name, now) : []),
    cleanupGuards(db, guards)], "read_conflict");
}
export async function reconcilePendingNotifications(db: D1Database, p: IntegrationPrincipal, now: Date, after = "", stopReason?: "client_disabled") {
  await requireIdentity(db, p);
  return reconcilePending(db, p, now, after, stopReason);
}
async function reconcilePending(db: D1Database, p: IntegrationPrincipal, now: Date, after: string, stopReason?: StopReason, maintenance?: SchedulerLease) {
  const rows = (await db.prepare(`SELECT * FROM notification_outbox WHERE household_id=? AND user_id=? AND connection_id=?
    AND state IN ('pending','retry_wait') AND delivery_id>? ORDER BY delivery_id LIMIT 26`)
    .bind(p.householdId, p.userId, p.connectionId, after).all<OutboxRow>()).results;
  const page = rows.slice(0, 25);
  for (const row of page) {
    try { await reconcileRow(db, p, row, now, stopReason, maintenance); }
    catch (error) { if (!(error instanceof NotificationOutboxError)) throw error; }
  }
  return { nextAfter: rows.length > 25 ? page[page.length - 1].delivery_id : "", processed: page.length };
}
// 失効後の後処理専用。外部のscopeを偽装せず、現在のCron leaseを各batchでも照合する。
export async function drainStoppedNotificationSchedule(db: D1Database, p: IntegrationPrincipal, lease: SchedulerLease, now: Date, reason: StopReason) {
  await requireOwner(db, p);
  const valid = await db.prepare(`SELECT 1 FROM notification_scheduler_progress WHERE connection_id=? AND household_id=? AND user_id=?
    AND lease_token=? AND lease_expires_at>${databaseNow}`).bind(p.connectionId, p.householdId, p.userId, lease.lease_token).first();
  if (!valid) throw new NotificationOutboxError("lease_lost");
  await recoverLeases(db, p, now, lease);
  return reconcilePending(db, p, now, lease.outbox_after, reason, lease);
}
async function requireLegacyDelivery(db: D1Database, lease: NotificationLease) {
  if (await db.prepare("SELECT 1 FROM notification_event_batches WHERE delivery_id=?").bind(lease.deliveryId).first()) throw new NotificationOutboxError("read_conflict");
}
// 宛先別配信も親と同じ家庭・最新判定・lease fenceを使う。HTTPへ直接公開しない。
export const notificationOutboxStorage = { requireIdentity, loadLease, readStamp, stampGuard, leaseGuard, cleanupGuards, batch, updateOutcome, sendDecision };
