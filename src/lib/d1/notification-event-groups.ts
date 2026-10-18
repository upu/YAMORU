import { z } from "zod";
import type { IntegrationPrincipal } from "../../features/integration/principal";
import { canonicalJson } from "../../features/integration/commands/contract";
import { NotificationError } from "../../features/integration/notifications/contract";
import { eventSubscription } from "./notification-event-subscriptions";
import { notificationRecipientStorage as recipients, type EventRecipientAttempt, type RecipientRow } from "./notification-event-dispatch";
import { NotificationOutboxError, notificationOutboxStorage as storage, type NotificationLease, type SendResult } from "./notification-outbox";
import type { RecipientState } from "./notification-recipient-state";
const databaseNow = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
// 最新状態の再照合と保存の再試行にもD1の呼出枠を残す。残りは次のjobへ回す。
export const DAILY_GROUP_ITEM_LIMIT = 10;
const sourceSchema = z.object({ data: z.object({ source: z.object({ kind: z.enum(["todo_occurrence", "consumable"]), entity_id: z.string(), todo_rule_id: z.string().nullable() }) }) });
type GroupRow = { id: string; subscription_id: string; lifecycle: string; event_id: string; body: string | null; item_count: number; state: RecipientState; attempt_token: string | null; attempt_expires_at: string | null; next_attempt_at: string; revision: number };
type MemberRow = RecipientRow & { delivery_id: string; claim_group: string | null };
export type FrozenNotificationGroup = { id: string; subscriptionId: string; eventId: string; body: string };
function leaseMap(leases: readonly NotificationLease[]) {
  if (leases.length > DAILY_GROUP_ITEM_LIMIT || new Set(leases.map((l) => l.deliveryId)).size !== leases.length) throw new Error("invalid_group_leases");
  return new Map(leases.map((l) => [l.deliveryId, l]));
}
async function ownedGroup(db: D1Database, p: IntegrationPrincipal, id: string) {
  const row = await db.prepare("SELECT * FROM notification_event_groups WHERE id=? AND household_id=? AND user_id=? AND connection_id=?")
    .bind(id, p.householdId, p.userId, p.connectionId).first<GroupRow>();
  if (!row) throw new NotificationError("not_found");
  return row;
}
function groupGuard(db: D1Database, p: IntegrationPrincipal, group: GroupRow, guard: string, sending = false) {
  return db.prepare(`INSERT INTO attention_guards(id,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM notification_event_groups
    WHERE id=? AND household_id=? AND user_id=? AND connection_id=? AND revision=? AND state=? AND attempt_token IS ?
      AND (?=0 OR attempt_expires_at>${databaseNow})) THEN 1 ELSE 0 END`)
    .bind(guard, group.id, p.householdId, p.userId, p.connectionId, group.revision, group.state, group.attempt_token, Number(sending));
}
function groupMembers(db: D1Database, id: string) {
  return db.prepare(`SELECT r.*,i.delivery_id,c.group_id AS claim_group FROM notification_event_group_items i
    JOIN notification_event_recipients r ON r.delivery_id=i.delivery_id AND r.subscription_id=i.subscription_id
    LEFT JOIN notification_event_group_claims c ON c.delivery_id=i.delivery_id AND c.subscription_id=i.subscription_id
    WHERE i.group_id=? ORDER BY i.delivery_id`).bind(id).all<MemberRow>();
}
function membershipGuard(db: D1Database, group: GroupRow, guard: string) {
  return db.prepare(`INSERT INTO attention_guards(id,valid) SELECT ?,CASE WHEN
    (SELECT count(*) FROM notification_event_group_items WHERE group_id=?)=? AND
    (SELECT count(*) FROM notification_event_group_claims WHERE group_id=?)=? THEN 1 ELSE 0 END`)
    .bind(guard, group.id, group.item_count, group.id, group.item_count);
}
async function snapshot(db: D1Database, p: IntegrationPrincipal, lease: NotificationLease, subscriptionId: string, now: Date) {
  const parent = await storage.loadLease(db, p, lease);
  const stamp = await storage.readStamp(db, p, lease.candidateId);
  const decision = await recipients.modeDecision(db, p, await storage.sendDecision(db, p, lease.candidateId, now), "daily");
  const row = await db.prepare("SELECT * FROM notification_event_recipients WHERE delivery_id=? AND subscription_id=?")
    .bind(lease.deliveryId, subscriptionId).first<RecipientRow>();
  return { lease, parent, stamp, decision, row };
}
type Snapshot = Awaited<ReturnType<typeof snapshot>>;
function snapshotGuards(db: D1Database, p: IntegrationPrincipal, entry: Snapshot, ids: string[], active: boolean) {
  return [storage.leaseGuard(db, p, entry.lease, ids[0], entry.parent.state === "sending" ? "sending" : "leased"),
    recipients.parentRevisionGuard(db, entry.lease.deliveryId, entry.parent.revision, ids[1]),
    storage.stampGuard(db, p, entry.lease.candidateId, entry.stamp, ids[2], active)];
}
function terminalGroup(db: D1Database, groupId: string, state: "accepted" | "unknown" | "failed" | "cancelled", reason: string | null, now: Date) {
  return db.prepare("UPDATE notification_event_groups SET state=?,attempt_token=NULL,attempt_expires_at=NULL,reason=?,terminal_at=?,updated_at=?,revision=revision+1 WHERE id=?")
    .bind(state, reason, now.toISOString(), now.toISOString(), groupId);
}
function releaseClaims(db: D1Database, id: string) { return db.prepare("DELETE FROM notification_event_group_claims WHERE group_id=?").bind(id); }
function bumpParents(db: D1Database, ids: string[]) {
  return db.prepare("UPDATE notification_outbox SET revision=revision+1 WHERE delivery_id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(ids));
}
export async function freezeDailyNotificationGroup(db: D1Database, p: IntegrationPrincipal, leases: readonly NotificationLease[], subscriptionId: string, now: Date): Promise<FrozenNotificationGroup | null> {
  await storage.requireIdentity(db, p); leaseMap(leases);
  const sub = await eventSubscription(db, p, subscriptionId);
  const selected: (Snapshot & { row: RecipientRow; source: z.infer<typeof sourceSchema>["data"]["source"] })[] = [];
  for (const lease of [...leases].sort((a, b) => a.deliveryId.localeCompare(b.deliveryId))) {
    const entry = await snapshot(db, p, lease, subscriptionId, now);
    const row = entry.row;
    if (!row || !["pending", "retry_wait"].includes(row.state) || row.next_attempt_at > now.toISOString() || entry.decision.state !== "ready" || !recipients.subscriptionUsable(sub, row, now)) continue;
    if (await db.prepare("SELECT 1 FROM notification_event_group_claims WHERE delivery_id=? AND subscription_id=?").bind(lease.deliveryId, subscriptionId).first()) continue;
    const frozen = await recipients.frozenEvent(db, lease.deliveryId);
    if (!frozen || frozen.mode !== "daily") continue;
    selected.push({ ...entry, row, source: sourceSchema.parse(JSON.parse(frozen.body)).data.source });
  }
  if (!selected.length || !sub) return null;
  const id = crypto.randomUUID(); const eventId = `evt_${crypto.randomUUID()}`;
  const body = canonicalJson({ eventId, name: "attention.ready", timestamp: now.toISOString(), data: { group_id: id, candidate_ids: selected.map((s) => s.lease.candidateId), observed_at: now.toISOString(), notification_mode: "daily",
    items: selected.map((s) => ({ delivery_id: s.lease.deliveryId, candidate_id: s.lease.candidateId, source: s.source })) }, cursor: null });
  const guards: string[] = []; const statements: D1PreparedStatement[] = [];
  for (const entry of selected) {
    const ids = Array.from({ length: 5 }, () => crypto.randomUUID()); guards.push(...ids);
    statements.push(...snapshotGuards(db, p, entry, ids, true), recipients.childGuard(db, entry.lease.deliveryId, entry.row, ids[3]),
      db.prepare(`INSERT INTO attention_guards(id,valid) SELECT ?,CASE WHEN NOT EXISTS(SELECT 1 FROM notification_event_group_claims
        WHERE delivery_id=? AND subscription_id=?) THEN 1 ELSE 0 END`).bind(ids[4], entry.lease.deliveryId, subscriptionId));
  }
  const subGuard = crypto.randomUUID(); guards.push(subGuard);
  statements.push(db.prepare(`INSERT INTO attention_guards(id,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM notification_event_subscriptions
    WHERE id=? AND lifecycle=? AND revision=? AND state='active' AND expires_at>${databaseNow}) THEN 1 ELSE 0 END`).bind(subGuard, sub.id, sub.lifecycle, sub.revision),
    db.prepare("INSERT INTO notification_event_groups(id,household_id,user_id,connection_id,subscription_id,lifecycle,event_id,body,item_count,next_attempt_at,frozen_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(id, p.householdId, p.userId, p.connectionId, subscriptionId, sub.lifecycle, eventId, body, selected.length, now.toISOString(), now.toISOString(), now.toISOString()),
    db.prepare(`INSERT INTO notification_event_group_items(group_id,delivery_id,subscription_id,household_id,user_id,connection_id,lifecycle)
      SELECT ?,r.delivery_id,r.subscription_id,r.household_id,r.user_id,r.connection_id,r.lifecycle FROM notification_event_recipients r
      WHERE r.subscription_id=? AND r.delivery_id IN (SELECT value FROM json_each(?))`).bind(id, subscriptionId, JSON.stringify(selected.map((s) => s.lease.deliveryId))),
    db.prepare("INSERT INTO notification_event_group_claims(delivery_id,subscription_id,group_id) SELECT delivery_id,subscription_id,group_id FROM notification_event_group_items WHERE group_id=?").bind(id),
    bumpParents(db, selected.map((s) => s.lease.deliveryId)), storage.cleanupGuards(db, guards));
  await storage.batch(db, statements, "read_conflict");
  return { id, subscriptionId, eventId, body };
}
async function cancelUnsent(db: D1Database, p: IntegrationPrincipal, group: GroupRow, entries: Snapshot[], now: Date, reason: string) {
  const guards = [crypto.randomUUID()];
  const statements = [groupGuard(db, p, group, guards[0])];
  const sub = await eventSubscription(db, p, group.subscription_id);
  for (const entry of entries) {
    const ids = Array.from({ length: 3 }, () => crypto.randomUUID()); guards.push(...ids);
    statements.push(...snapshotGuards(db, p, entry, ids, false));
    const row = entry.row;
    if (!row || !["pending", "retry_wait"].includes(row.state)) continue;
    if (entry.decision.state === "deferred" && recipients.subscriptionUsable(sub, row, now)) continue;
    const plan = recipients.recipientPlan(entry.decision, row, sub, now);
    if (plan.kind === "stop") statements.push(db.prepare("UPDATE notification_event_recipients SET state=?,reason=?,updated_at=? WHERE delivery_id=? AND subscription_id=? AND state IN ('pending','retry_wait')")
      .bind(plan.state, plan.reason, now.toISOString(), entry.lease.deliveryId, group.subscription_id));
  }
  statements.push(terminalGroup(db, group.id, "cancelled", reason, now), releaseClaims(db, group.id), bumpParents(db, entries.map((e) => e.lease.deliveryId)), storage.cleanupGuards(db, guards));
  await storage.batch(db, statements, "read_conflict");
}
function startMemberStatements(db: D1Database, p: IntegrationPrincipal, entry: Snapshot, sub: Awaited<ReturnType<typeof eventSubscription>>, token: string, guards: string[], now: Date) {
  if (!entry.row) throw new NotificationOutboxError("read_conflict");
  const plan = recipients.recipientPlan(entry.decision, entry.row, sub, now);
  if (plan.kind !== "send") throw new NotificationOutboxError("read_conflict");
  const ids = Array.from({ length: 5 }, () => crypto.randomUUID()); guards.push(...ids);
  return [...snapshotGuards(db, p, entry, ids, true), recipients.childGuard(db, entry.lease.deliveryId, entry.row, ids[3]),
    ...recipients.startRecipientStatements(db, p, entry.lease, entry.row, plan.sub, token, ids[4], now)];
}
export async function beginDailyNotificationGroup(db: D1Database, p: IntegrationPrincipal, groupId: string, leases: readonly NotificationLease[], now: Date): Promise<EventRecipientAttempt | null> {
  await storage.requireIdentity(db, p); const byId = leaseMap(leases);
  const group = await ownedGroup(db, p, groupId);
  if (!["pending", "retry_wait"].includes(group.state) || group.next_attempt_at > now.toISOString()) return null;
  const members = (await groupMembers(db, groupId)).results;
  if (!group.body || members.length !== group.item_count || members.some((m) => m.claim_group !== groupId)) {
    await cancelUnsent(db, p, group, [], now, "membership_changed"); return null;
  }
  const entries: Snapshot[] = [];
  for (const member of members) {
    const lease = byId.get(member.delivery_id); if (!lease) throw new NotificationOutboxError("lease_lost");
    entries.push(await snapshot(db, p, lease, group.subscription_id, now));
  }
  const sub = await eventSubscription(db, p, group.subscription_id);
  const ready = entries.every((e) => e.row && ["pending", "retry_wait"].includes(e.row.state) && e.row.next_attempt_at <= now.toISOString() && recipients.recipientPlan(e.decision, e.row, sub, now).kind === "send");
  if (!ready) { await cancelUnsent(db, p, group, entries, now, "members_changed"); return null; }
  if (!sub?.encrypted_destination || !sub.provider_id) throw new NotificationOutboxError("read_conflict");
  const token = crypto.randomUUID(); const guards = [crypto.randomUUID(), crypto.randomUUID()];
  const statements = [groupGuard(db, p, group, guards[0]), membershipGuard(db, group, guards[1])];
  for (const entry of entries) {
    statements.push(...startMemberStatements(db, p, entry, sub, token, guards, now));
  }
  const expiresAt = entries.map((e) => e.parent.lease_expires_at).sort()[0];
  statements.push(db.prepare("UPDATE notification_event_groups SET state='sending',attempt_token=?,attempt_expires_at=?,updated_at=?,revision=revision+1 WHERE id=?")
    .bind(token, expiresAt, now.toISOString(), groupId), storage.cleanupGuards(db, guards));
  await storage.batch(db, statements, "read_conflict");
  return { subscriptionId: group.subscription_id, token, eventId: group.event_id, body: group.body, encryptedDestination: sub.encrypted_destination, providerId: sub.provider_id };
}
async function finishMemberPlan(db: D1Database, p: IntegrationPrincipal, group: GroupRow, member: MemberRow, byId: Map<string, NotificationLease>, attempt: EventRecipientAttempt, result: SendResult, guards: string[], now: Date) {
  const lease = byId.get(member.delivery_id); if (!lease) throw new NotificationOutboxError("lease_lost");
  const parent = await storage.loadLease(db, p, lease, "sending");
  const ids = Array.from({ length: 3 }, () => crypto.randomUUID()); guards.push(...ids);
  const outcome = recipients.recipientResult(member, result, now);
  return { outcome, statements: [storage.leaseGuard(db, p, lease, ids[0], "sending"), recipients.parentRevisionGuard(db, lease.deliveryId, parent.revision, ids[1]),
    db.prepare("INSERT INTO attention_guards(id,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM notification_event_recipients WHERE delivery_id=? AND subscription_id=? AND state='sending' AND attempt_token=?) THEN 1 ELSE 0 END")
      .bind(ids[2], lease.deliveryId, group.subscription_id, attempt.token),
    db.prepare("UPDATE notification_event_recipients SET state=?,attempt_token=NULL,next_attempt_at=?,reason=?,updated_at=? WHERE delivery_id=? AND subscription_id=?")
      .bind(outcome.state, outcome.nextAt, outcome.reason, now.toISOString(), lease.deliveryId, group.subscription_id)] };
}
function combinedOutcome(outcomes: ReturnType<typeof recipients.recipientResult>[]) {
  const first = outcomes.at(0); if (!first) throw new NotificationOutboxError("lease_lost");
  const retry = outcomes.every((o) => o.state === "retry_wait");
  const partialRetry = !retry && outcomes.some((o) => o.state === "retry_wait");
  return { state: partialRetry ? "cancelled" as const : first.state, nextAt: outcomes.map((o) => o.nextAt).sort().at(-1) ?? first.nextAt };
}
export async function finishDailyNotificationGroup(db: D1Database, p: IntegrationPrincipal, groupId: string, leases: readonly NotificationLease[], attempt: EventRecipientAttempt, result: SendResult, now: Date) {
  await storage.requireIdentity(db, p); const byId = leaseMap(leases);
  const group = await ownedGroup(db, p, groupId);
  if (group.state !== "sending" || group.attempt_token !== attempt.token || group.subscription_id !== attempt.subscriptionId || group.event_id !== attempt.eventId) throw new NotificationOutboxError("lease_lost");
  const members = (await groupMembers(db, groupId)).results;
  if (members.length !== group.item_count || members.some((m) => m.state !== "sending" || m.claim_group !== groupId)) throw new NotificationOutboxError("lease_lost");
  const guards = [crypto.randomUUID(), crypto.randomUUID()];
  const statements = [groupGuard(db, p, group, guards[0], true), membershipGuard(db, group, guards[1])];
  const outcomes: ReturnType<typeof recipients.recipientResult>[] = [];
  for (const member of members) {
    const plan = await finishMemberPlan(db, p, group, member, byId, attempt, result, guards, now);
    outcomes.push(plan.outcome); statements.push(...plan.statements);
  }
  const { state, nextAt } = combinedOutcome(outcomes);
  statements.push(state === "retry_wait" ? db.prepare("UPDATE notification_event_groups SET state='retry_wait',attempt_token=NULL,attempt_expires_at=NULL,next_attempt_at=?,updated_at=?,revision=revision+1 WHERE id=?").bind(nextAt, now.toISOString(), groupId)
    : terminalGroup(db, groupId, state, result.reason ?? null, now));
  if (state === "cancelled") statements.push(releaseClaims(db, groupId));
  statements.push(bumpParents(db, members.map((m) => m.delivery_id)), storage.cleanupGuards(db, guards));
  await storage.batch(db, statements, "lease_lost");
  return { state, nextAt };
}
export async function recoverNotificationEventGroups(db: D1Database, p: IntegrationPrincipal, now: Date) {
  await storage.requireIdentity(db, p);
  const groups = (await db.prepare(`SELECT * FROM notification_event_groups WHERE household_id=? AND user_id=? AND connection_id=?
    AND state='sending' AND attempt_expires_at<=${databaseNow} ORDER BY attempt_expires_at,id LIMIT 100`).bind(p.householdId, p.userId, p.connectionId).all<GroupRow>()).results;
  for (const group of groups) {
    const guards = [crypto.randomUUID(), crypto.randomUUID()];
    await storage.batch(db, [groupGuard(db, p, group, guards[0]),
      db.prepare(`INSERT INTO attention_guards(id,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM notification_event_groups WHERE id=? AND attempt_expires_at<=${databaseNow}) THEN 1 ELSE 0 END`).bind(guards[1], group.id),
      db.prepare(`UPDATE notification_event_recipients SET state='unknown',attempt_token=NULL,reason='group_interrupted',updated_at=?
        WHERE subscription_id=? AND state='sending' AND attempt_token=? AND delivery_id IN (SELECT delivery_id FROM notification_event_group_items WHERE group_id=?)`)
        .bind(now.toISOString(), group.subscription_id, group.attempt_token, group.id),
      terminalGroup(db, group.id, "unknown", "group_interrupted", now),
      db.prepare("UPDATE notification_outbox SET revision=revision+1 WHERE delivery_id IN (SELECT delivery_id FROM notification_event_group_items WHERE group_id=?)").bind(group.id),
      storage.cleanupGuards(db, guards)], "read_conflict");
  }
  return groups.length;
}
