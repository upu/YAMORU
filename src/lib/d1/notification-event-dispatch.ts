import type { IntegrationPrincipal } from "../../features/integration/principal";
import { eventFilterMatches, normalizeEventFilter } from "../../features/integration/notifications/event-filter";
import { canonicalJson } from "../../features/integration/commands/contract";
import { deliveryRecordStatements } from "./notification-deliveries";
import { eventSubscription, type EventSubscriptionRow } from "./notification-event-subscriptions";
import { NotificationOutboxError, notificationOutboxStorage as storage, type NotificationLease, type SendResult } from "./notification-outbox";
import { aggregateRecipientState, eventRecipientStatuses, type RecipientState } from "./notification-recipient-state";
import type { NotificationDecision } from "./notification-policy";
import { getNotificationSettings } from "./notification-settings";
import { z } from "zod";
const databaseNow = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
type FrozenEvent = { eventId: string; body: string; mode: "daily" | "individual"; recipientIds: string[] };
const frozenModeSchema = z.object({ data: z.object({ notification_mode: z.enum(["daily", "individual"]).optional() }) });
async function modeDecision(db: D1Database, p: IntegrationPrincipal, decision: NotificationDecision, mode: FrozenEvent["mode"]): Promise<NotificationDecision> {
  if (decision.state === "cancelled" || decision.state === "suppressed") return decision;
  const { settings } = await getNotificationSettings(db, { userId: p.userId }, p.householdId);
  return settings.mode === mode ? decision : { state: "cancelled", reason: "notification_mode_changed", nextAt: null };
}
type RecipientRow = { subscription_id: string; lifecycle: string; state: RecipientState; attempts: number; first_sent_at: string | null; next_attempt_at: string };
export type EventRecipientAttempt = { subscriptionId: string; token: string; eventId: string; body: string; encryptedDestination: string; providerId: string };
type LiveSubscription = EventSubscriptionRow & { encrypted_destination: string; provider_id: string };
function retryExhausted(row: RecipientRow, now: Date) {
  return row.attempts >= 8 || (row.first_sent_at !== null && now.getTime() - Date.parse(row.first_sent_at) >= 86_400_000);
}
function subscriptionUsable(sub: EventSubscriptionRow | null, row: RecipientRow, now: Date): sub is LiveSubscription {
  return Boolean(sub?.encrypted_destination && sub.provider_id && sub.state === "active" && sub.lifecycle === row.lifecycle && sub.expires_at > now.toISOString());
}
function recipientPlan(decision: NotificationDecision, row: RecipientRow, sub: EventSubscriptionRow | null, now: Date) {
  if (decision.state !== "ready") return { kind: "stop" as const, state: "cancelled", reason: decision.reason };
  if (retryExhausted(row, now)) return { kind: "stop" as const, state: "failed", reason: "retry_limit" };
  if (!subscriptionUsable(sub, row, now)) return { kind: "stop" as const, state: "cancelled", reason: "subscription_unavailable" };
  return { kind: "send" as const, sub };
}
function startRecipientStatements(db: D1Database, p: IntegrationPrincipal, lease: NotificationLease, row: RecipientRow, sub: LiveSubscription, token: string, guard: string, now: Date) {
  return [db.prepare(`INSERT INTO attention_guards(id,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM notification_event_subscriptions
    WHERE id=? AND household_id=? AND user_id=? AND connection_id=? AND lifecycle=? AND revision=? AND state='active' AND expires_at>${databaseNow}) THEN 1 ELSE 0 END`)
    .bind(guard, sub.id, p.householdId, p.userId, p.connectionId, row.lifecycle, sub.revision),
  db.prepare("UPDATE notification_event_recipients SET state='sending',attempt_token=?,attempts=attempts+1,first_sent_at=coalesce(first_sent_at,?),updated_at=?,reason=NULL WHERE delivery_id=? AND subscription_id=?")
    .bind(token, now.toISOString(), now.toISOString(), lease.deliveryId, sub.id),
  db.prepare("UPDATE notification_outbox SET state='sending',attempts=max(attempts,?),first_sent_at=coalesce(first_sent_at,?),updated_at=?,revision=revision+1 WHERE delivery_id=?")
    .bind(row.attempts + 1, now.toISOString(), now.toISOString(), lease.deliveryId)];
}
function parentRevisionGuard(db: D1Database, deliveryId: string, revision: number, id: string) {
  return db.prepare("INSERT INTO attention_guards(id,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM notification_outbox WHERE delivery_id=? AND revision=?) THEN 1 ELSE 0 END").bind(id, deliveryId, revision);
}
function childGuard(db: D1Database, deliveryId: string, row: RecipientRow, id: string) {
  return db.prepare(`INSERT INTO attention_guards(id,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM notification_event_recipients
    WHERE delivery_id=? AND subscription_id=? AND state=? AND attempts=? AND next_attempt_at=?) THEN 1 ELSE 0 END`)
    .bind(id, deliveryId, row.subscription_id, row.state, row.attempts, row.next_attempt_at);
}
async function frozenEvent(db: D1Database, deliveryId: string): Promise<FrozenEvent | null> {
  const row = await db.prepare("SELECT event_id,body FROM notification_event_batches WHERE delivery_id=?").bind(deliveryId).first<{ event_id: string; body: string | null }>();
  if (!row?.body) return null;
  const recipients = (await db.prepare("SELECT subscription_id FROM notification_event_recipients WHERE delivery_id=? ORDER BY subscription_id").bind(deliveryId).all<{ subscription_id: string }>()).results;
  return { eventId: row.event_id, body: row.body, mode: frozenModeSchema.parse(JSON.parse(row.body)).data.notification_mode ?? "individual", recipientIds: recipients.map((r) => r.subscription_id) };
}
export async function freezeNotificationEvent(db: D1Database, p: IntegrationPrincipal, lease: NotificationLease, now: Date) {
  await storage.requireIdentity(db, p);
  const row = await storage.loadLease(db, p, lease);
  const stamp = await storage.readStamp(db, p, lease.candidateId);
  if ((await storage.sendDecision(db, p, lease.candidateId, now)).state !== "ready") return null;
  const frozen = await frozenEvent(db, lease.deliveryId);
  if (frozen) return frozen;
  if (row.state !== "leased") throw new NotificationOutboxError("read_conflict");
  const source = await db.prepare("SELECT kind,entity_id,todo_rule_id FROM notification_outbox_sources WHERE delivery_id=? AND household_id=?")
    .bind(lease.deliveryId, p.householdId).first<{ kind: "todo_occurrence" | "consumable"; entity_id: string; todo_rule_id: string | null }>();
  if (!source) return null;
  const subscriptions = (await db.prepare("SELECT * FROM notification_event_subscriptions WHERE household_id=? AND user_id=? AND connection_id=? AND state='active' AND expires_at>? ORDER BY id LIMIT 21")
    .bind(p.householdId, p.userId, p.connectionId, now.toISOString()).all<EventSubscriptionRow>()).results;
  if (subscriptions.length > 20) throw new NotificationOutboxError("read_conflict");
  const selected = subscriptions.filter((s) => eventFilterMatches(normalizeEventFilter(JSON.parse(s.filters)), { kind: source.kind, entityId: source.entity_id, todoRuleId: source.todo_rule_id }));
  if (!selected.length) return null;
  const { settings } = await getNotificationSettings(db, { userId: p.userId }, p.householdId);
  const eventId = `evt_${crypto.randomUUID()}`;
  const body = canonicalJson({ eventId, name: "attention.ready", timestamp: now.toISOString(), data: { delivery_id: lease.deliveryId, candidate_ids: [lease.candidateId], observed_at: now.toISOString(), notification_mode: settings.mode, source }, cursor: null });
  const guards = Array.from({ length: 4 }, () => crypto.randomUUID());
  const snapshot = subscriptions.map((s) => ({ id: s.id, revision: s.revision, lifecycle: s.lifecycle }));
  const unchanged = db.prepare(`INSERT INTO attention_guards(id,valid) SELECT ?1,CASE WHEN
    (SELECT count(*) FROM notification_event_subscriptions WHERE connection_id=?2 AND state='active' AND expires_at>${databaseNow})=json_array_length(?3)
    AND NOT EXISTS(SELECT 1 FROM json_each(?3) j LEFT JOIN notification_event_subscriptions s
      ON s.id=json_extract(j.value,'$.id') AND s.connection_id=?2 AND s.revision=json_extract(j.value,'$.revision') AND s.lifecycle=json_extract(j.value,'$.lifecycle')
      AND s.state='active' AND s.expires_at>${databaseNow} WHERE s.id IS NULL) THEN 1 ELSE 0 END`)
    .bind(guards[3], p.connectionId, JSON.stringify(snapshot));
  await storage.batch(db, [storage.leaseGuard(db, p, lease, guards[0], "leased"), parentRevisionGuard(db, lease.deliveryId, row.revision, guards[1]),
    storage.stampGuard(db, p, lease.candidateId, stamp, guards[2], true), unchanged,
    db.prepare("INSERT INTO notification_event_batches(delivery_id,household_id,user_id,connection_id,event_id,body,frozen_at) VALUES(?,?,?,?,?,?,?)")
      .bind(lease.deliveryId, p.householdId, p.userId, p.connectionId, eventId, body, now.toISOString()),
    ...selected.map((s) => db.prepare("INSERT INTO notification_event_recipients(delivery_id,household_id,user_id,connection_id,subscription_id,lifecycle,next_attempt_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
      .bind(lease.deliveryId, p.householdId, p.userId, p.connectionId, s.id, s.lifecycle, now.toISOString(), now.toISOString())),
    db.prepare("UPDATE notification_outbox SET revision=revision+1 WHERE delivery_id=?").bind(lease.deliveryId), storage.cleanupGuards(db, guards)], "read_conflict");
  return frozenEvent(db, lease.deliveryId);
}
export async function beginEventRecipient(db: D1Database, p: IntegrationPrincipal, lease: NotificationLease, subscriptionId: string, now: Date): Promise<EventRecipientAttempt | null> {
  await storage.requireIdentity(db, p);
  const parent = await storage.loadLease(db, p, lease);
  const stamp = await storage.readStamp(db, p, lease.candidateId);
  const currentDecision = await storage.sendDecision(db, p, lease.candidateId, now);
  const row = await db.prepare("SELECT * FROM notification_event_recipients WHERE delivery_id=? AND subscription_id=?").bind(lease.deliveryId, subscriptionId).first<RecipientRow>();
  if (!row || !["pending", "retry_wait"].includes(row.state) || row.next_attempt_at > now.toISOString()) return null;
  const frozen = await frozenEvent(db, lease.deliveryId);
  if (!frozen) throw new NotificationOutboxError("read_conflict");
  const decision = await modeDecision(db, p, currentDecision, frozen.mode);
  if (decision.state === "deferred") return null;
  const sub = await eventSubscription(db, p, subscriptionId);
  const plan = recipientPlan(decision, row, sub, now);
  const sending = plan.kind === "send";
  const guards = Array.from({ length: sending ? 5 : 4 }, () => crypto.randomUUID());
  const statements = [storage.leaseGuard(db, p, lease, guards[0], parent.state === "sending" ? "sending" : "leased"),
    parentRevisionGuard(db, lease.deliveryId, parent.revision, guards[1]), childGuard(db, lease.deliveryId, row, guards[2]),
    storage.stampGuard(db, p, lease.candidateId, stamp, guards[3], sending)];
  const token = crypto.randomUUID();
  let attempt: EventRecipientAttempt | null = null;
  if (plan.kind === "send") {
    statements.push(...startRecipientStatements(db, p, lease, row, plan.sub, token, guards[4], now));
    attempt = { subscriptionId, token, eventId: frozen.eventId, body: frozen.body, encryptedDestination: plan.sub.encrypted_destination, providerId: plan.sub.provider_id };
  } else {
    statements.push(db.prepare("UPDATE notification_event_recipients SET state=?,reason=?,updated_at=? WHERE delivery_id=? AND subscription_id=?")
      .bind(plan.state, plan.reason, now.toISOString(), lease.deliveryId, subscriptionId),
    db.prepare("UPDATE notification_outbox SET revision=revision+1 WHERE delivery_id=?").bind(lease.deliveryId));
  }
  await storage.batch(db, [...statements, storage.cleanupGuards(db, guards)], "read_conflict");
  return attempt;
}
export async function finishEventRecipient(db: D1Database, p: IntegrationPrincipal, lease: NotificationLease, attempt: EventRecipientAttempt, result: SendResult, now: Date) {
  await storage.requireIdentity(db, p);
  const parent = await storage.loadLease(db, p, lease, "sending");
  const row = await db.prepare("SELECT * FROM notification_event_recipients WHERE delivery_id=? AND subscription_id=? AND state='sending' AND attempt_token=?")
    .bind(lease.deliveryId, attempt.subscriptionId, attempt.token).first<RecipientRow>();
  if (!row) throw new NotificationOutboxError("lease_lost");
  const exhausted = retryExhausted(row, now);
  const state = result.kind === "retry" ? exhausted ? "failed" : "retry_wait" : result.kind;
  const delay = Math.min(3_600_000, 30_000 * 2 ** Math.max(0, row.attempts - 1));
  const nextAt = state === "retry_wait" ? new Date(now.getTime() + delay + Math.floor(Math.random() * delay / 4)).toISOString() : now.toISOString();
  const guards = Array.from({ length: 3 }, () => crypto.randomUUID());
  const tokenGuard = db.prepare("INSERT INTO attention_guards(id,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM notification_event_recipients WHERE delivery_id=? AND subscription_id=? AND state='sending' AND attempt_token=?) THEN 1 ELSE 0 END")
    .bind(guards[2], lease.deliveryId, attempt.subscriptionId, attempt.token);
  await storage.batch(db, [storage.leaseGuard(db, p, lease, guards[0], "sending"), parentRevisionGuard(db, lease.deliveryId, parent.revision, guards[1]), tokenGuard,
    db.prepare("UPDATE notification_event_recipients SET state=?,attempt_token=NULL,next_attempt_at=?,reason=?,updated_at=? WHERE delivery_id=? AND subscription_id=?")
      .bind(state, nextAt, result.kind === "retry" && exhausted ? "retry_limit" : result.reason ?? null, now.toISOString(), lease.deliveryId, attempt.subscriptionId),
    db.prepare("UPDATE notification_outbox SET revision=revision+1 WHERE delivery_id=?").bind(lease.deliveryId), storage.cleanupGuards(db, guards)], "lease_lost");
  return { state, nextAt };
}
export async function settleNotificationEvent(db: D1Database, p: IntegrationPrincipal, lease: NotificationLease, now: Date) {
  await storage.requireIdentity(db, p);
  const parent = await storage.loadLease(db, p, lease);
  const stamp = await storage.readStamp(db, p, lease.candidateId);
  const decision = await storage.sendDecision(db, p, lease.candidateId, now);
  const rows = await eventRecipientStatuses(db, lease.deliveryId);
  if (!rows.length) throw new NotificationOutboxError("read_conflict");
  const cancel = decision.state === "cancelled" || decision.state === "suppressed";
  const aggregate = aggregateRecipientState(rows, now, cancel ? "cancel" : undefined);
  if (aggregate.state === "sending") throw new NotificationOutboxError("read_conflict");
  const nextAt = aggregate.state === "retry_wait" && decision.nextAt && decision.nextAt > aggregate.nextAt ? decision.nextAt : aggregate.nextAt;
  const terminal = aggregate.state !== "retry_wait";
  const guards = Array.from({ length: 3 }, () => crypto.randomUUID());
  await storage.batch(db, [storage.leaseGuard(db, p, lease, guards[0], parent.state === "sending" ? "sending" : "leased"),
    parentRevisionGuard(db, lease.deliveryId, parent.revision, guards[1]), storage.stampGuard(db, p, lease.candidateId, stamp, guards[2], !cancel && !terminal),
    ...(cancel ? [db.prepare("UPDATE notification_event_recipients SET state='cancelled',reason=?,updated_at=? WHERE delivery_id=? AND state IN ('pending','retry_wait')").bind(decision.reason, now.toISOString(), lease.deliveryId)] : []),
    storage.updateOutcome(db, lease, aggregate.state, aggregate.reason, now, nextAt),
    ...(terminal ? deliveryRecordStatements(db, p, { deliveryId: lease.deliveryId, candidateId: lease.candidateId, outcome: aggregate.state, reason: aggregate.reason }, parent.candidate_name, now) : []),
    storage.cleanupGuards(db, guards)], "read_conflict");
  return { state: aggregate.state, nextAt };
}
