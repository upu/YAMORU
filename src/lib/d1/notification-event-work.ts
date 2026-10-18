import type { IntegrationPrincipal } from "../../features/integration/principal";
import { NotificationOutboxError, notificationOutboxStorage as storage, type NotificationLease } from "./notification-outbox";
import { notificationGroupStorage as groups, DAILY_GROUP_ITEM_LIMIT } from "./notification-event-groups";
import { notificationScheduleGuard, type SchedulerLease } from "./notification-scheduler";
import { notificationRecipientStorage } from "./notification-event-dispatch";
import { deliveryRecordStatements } from "./notification-deliveries";
type Parent = { delivery_id: string; candidate_id: string; revision: number };
export async function reconcileNotificationGroups(db: D1Database, p: IntegrationPrincipal, lease: SchedulerLease, now: Date, stopReason?: string) {
  await storage.requireOwner(db, p);
  const invalid = `g.item_count<>(SELECT count(*) FROM notification_event_group_items WHERE group_id=g.id)
    OR EXISTS(SELECT 1 FROM notification_event_group_items i
      LEFT JOIN notification_outbox o ON o.delivery_id=i.delivery_id
      LEFT JOIN notification_event_recipients r ON r.delivery_id=i.delivery_id AND r.subscription_id=i.subscription_id
      LEFT JOIN notification_event_group_claims c ON c.delivery_id=i.delivery_id AND c.subscription_id=i.subscription_id
      WHERE i.group_id=g.id AND (o.delivery_id IS NULL OR o.state NOT IN ('pending','retry_wait','leased','sending')
        OR r.state NOT IN ('pending','retry_wait') OR c.group_id IS NOT g.id))`;
  const rows = (await db.prepare(`SELECT g.id FROM notification_event_groups g WHERE g.household_id=? AND g.user_id=? AND g.connection_id=?
    AND g.state IN ('pending','retry_wait') AND (?=1 OR (${invalid})) ORDER BY g.next_attempt_at,g.id LIMIT 100`)
    .bind(p.householdId, p.userId, p.connectionId, Number(stopReason !== undefined)).all<{ id: string }>()).results;
  for (const row of rows) {
    const group = await groups.ownedGroup(db, p, row.id);
    if (!["pending", "retry_wait"].includes(group.state)) continue;
    const guards = [crypto.randomUUID(), crypto.randomUUID()];
    await storage.batch(db, [notificationScheduleGuard(db, p, lease, guards[0]), groups.groupGuard(db, p, group, guards[1]),
      groups.terminalGroup(db, group.id, "cancelled", stopReason ?? "members_changed", now), groups.releaseClaims(db, group.id), storage.cleanupGuards(db, guards)], "lease_lost");
  }
  return rows.length;
}
async function acquire(db: D1Database, p: IntegrationPrincipal, schedule: SchedulerLease, parents: Parent[], now: Date, groupId?: string): Promise<NotificationLease[]> {
  if (!parents.length) return [];
  const guards = [crypto.randomUUID(), crypto.randomUUID()]; const token = crypto.randomUUID();
  const snapshot = JSON.stringify(parents);
  const statements = [notificationScheduleGuard(db, p, schedule, guards[0]),
    db.prepare(`INSERT INTO attention_guards(id,valid) SELECT ?,CASE WHEN (SELECT count(*) FROM json_each(?) j
      JOIN notification_outbox o ON o.delivery_id=json_extract(j.value,'$.delivery_id') AND o.revision=json_extract(j.value,'$.revision')
      WHERE o.household_id=? AND o.user_id=? AND o.connection_id=? AND o.state IN ('pending','retry_wait') AND o.next_attempt_at<=?)=? THEN 1 ELSE 0 END`)
      .bind(guards[1], snapshot, p.householdId, p.userId, p.connectionId, now.toISOString(), parents.length)];
  if (groupId) {
    const group = await groups.ownedGroup(db, p, groupId); const id = crypto.randomUUID(); guards.push(id);
    if (!["pending", "retry_wait"].includes(group.state)) throw new NotificationOutboxError("read_conflict");
    statements.push(groups.groupGuard(db, p, group, id));
    const membersGuard = crypto.randomUUID(); guards.push(membersGuard);
    statements.push(db.prepare(`INSERT INTO attention_guards(id,valid) SELECT ?,CASE WHEN
      (SELECT count(*) FROM notification_event_group_items WHERE group_id=?)=? AND
      (SELECT count(*) FROM notification_event_group_claims WHERE group_id=?)=? THEN 1 ELSE 0 END`)
      .bind(membersGuard, groupId, parents.length, groupId, parents.length));
  }
  statements.push(db.prepare(`UPDATE notification_outbox SET state='leased',lease_token=?,lease_expires_at=?,updated_at=?,revision=revision+1
    WHERE delivery_id IN (SELECT json_extract(value,'$.delivery_id') FROM json_each(?))`)
    .bind(token, new Date(now.getTime() + 300_000).toISOString(), now.toISOString(), snapshot), storage.cleanupGuards(db, guards));
  await storage.batch(db, statements, "lease_lost");
  return parents.map((parent) => ({ deliveryId: parent.delivery_id, candidateId: parent.candidate_id, leaseToken: token }));
}
export async function claimScheduledEventWork(db: D1Database, p: IntegrationPrincipal, schedule: SchedulerLease, now: Date, remaining = DAILY_GROUP_ITEM_LIMIT) {
  await storage.requireIdentity(db, p);
  if (!Number.isInteger(remaining) || remaining < 1 || remaining > DAILY_GROUP_ITEM_LIMIT) throw new Error("invalid_work_limit");
  const pending = (await db.prepare(`SELECT id,item_count FROM notification_event_groups WHERE household_id=? AND user_id=? AND connection_id=?
    AND state IN ('pending','retry_wait') AND next_attempt_at<=? ORDER BY next_attempt_at,id LIMIT 20`)
    .bind(p.householdId, p.userId, p.connectionId, now.toISOString()).all<{ id: string; item_count: number }>()).results;
  for (const group of pending) {
    if (group.item_count > remaining) continue;
    const parents = (await db.prepare(`SELECT o.delivery_id,o.candidate_id,o.revision FROM notification_event_group_items i
      JOIN notification_outbox o ON o.delivery_id=i.delivery_id
      WHERE i.group_id=? AND o.household_id=? AND o.user_id=? AND o.connection_id=? AND o.state IN ('pending','retry_wait') AND o.next_attempt_at<=?
      ORDER BY o.delivery_id`).bind(group.id, p.householdId, p.userId, p.connectionId, now.toISOString()).all<Parent>()).results;
    if (parents.length === group.item_count) return { leases: await acquire(db, p, schedule, parents, now, group.id), groupId: group.id, cost: group.item_count };
  }
  const parents = (await db.prepare(`SELECT o.delivery_id,o.candidate_id,o.revision FROM notification_outbox o
    WHERE o.household_id=? AND o.user_id=? AND o.connection_id=? AND o.state IN ('pending','retry_wait') AND o.next_attempt_at<=?
    AND NOT EXISTS(SELECT 1 FROM notification_event_group_claims c JOIN notification_event_groups g ON g.id=c.group_id
      WHERE c.delivery_id=o.delivery_id AND g.state IN ('pending','retry_wait','sending'))
    ORDER BY o.next_attempt_at,o.delivery_id LIMIT ?`).bind(p.householdId, p.userId, p.connectionId, now.toISOString(), remaining).all<Parent>()).results;
  return { leases: await acquire(db, p, schedule, parents, now), groupId: null, cost: 0 };
}
export async function scheduledRecipientIds(db: D1Database, lease: NotificationLease, now: Date, maximum: number) {
  return (await db.prepare(`SELECT subscription_id FROM notification_event_recipients WHERE delivery_id=?
    AND state IN ('pending','retry_wait') AND next_attempt_at<=? ORDER BY subscription_id LIMIT ?`).bind(lease.deliveryId, now.toISOString(), maximum)
    .all<{ subscription_id: string }>()).results.map((r) => r.subscription_id);
}
export async function releaseUnsentEventWork(db: D1Database, p: IntegrationPrincipal, schedule: SchedulerLease, lease: NotificationLease, now: Date) {
  const parent = await storage.loadLease(db, p, lease, "leased");
  const stamp = await storage.readStamp(db, p, lease.candidateId);
  const decision = await storage.sendDecision(db, p, lease.candidateId, now);
  const terminal = decision.state === "cancelled" || decision.state === "suppressed" ? decision.state : null;
  const state = terminal ?? "pending";
  const nextAt = decision.nextAt && decision.nextAt > now.toISOString() ? decision.nextAt : new Date(now.getTime() + 300_000).toISOString();
  const guards = Array.from({ length: 4 }, () => crypto.randomUUID());
  await storage.batch(db, [notificationScheduleGuard(db, p, schedule, guards[0]), storage.leaseGuard(db, p, lease, guards[1], "leased"),
    notificationRecipientStorage.parentRevisionGuard(db, lease.deliveryId, parent.revision, guards[2]), storage.stampGuard(db, p, lease.candidateId, stamp, guards[3], !terminal),
    storage.updateOutcome(db, lease, state, terminal ? decision.reason : "awaiting_subscription", now, nextAt),
    ...(terminal ? deliveryRecordStatements(db, p, { deliveryId: lease.deliveryId, candidateId: lease.candidateId, outcome: terminal, reason: decision.reason }, parent.candidate_name, now) : []),
    storage.cleanupGuards(db, guards)], "lease_lost");
}
