import type { IntegrationPrincipal } from "../../features/integration/principal";
import { notificationOutboxStorage as storage } from "./notification-outbox";
import { notificationScheduleGuard, type SchedulerLease } from "./notification-scheduler";
import { pollClaimGuard, pollDatabaseNow, pollLeaseToken, pollMembers, pollMembershipGuard, type PollClaim } from "./notification-poll";
import { pollResult } from "./notification-poll-statements";
import { deliveryRecordStatements } from "./notification-deliveries";
export async function recoverNotificationPollClaims(db: D1Database, p: IntegrationPrincipal, schedule: SchedulerLease, now: Date) {
  await storage.requireOwner(db, p);
  const row = await db.prepare(`SELECT * FROM notification_poll_claims WHERE connection_id=? AND household_id=? AND user_id=?
    AND state='claimed' AND lease_expires_at<=${pollDatabaseNow} ORDER BY lease_expires_at,id LIMIT 1`)
    .bind(p.connectionId, p.householdId, p.userId).first<PollClaim>();
  if (!row) return 0;
  const members = await pollMembers(db, p, row.id);
  const guards = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const statements = [notificationScheduleGuard(db, p, schedule, guards[0]), pollClaimGuard(db, p, row, guards[1], true), pollMembershipGuard(db, row, members, guards[2], false)];
  for (const member of members.filter((m) => m.state === "sending" && m.lease_token === row.lease_token)) {
    const lease = { deliveryId: member.delivery_id, candidateId: member.candidate_id, leaseToken: pollLeaseToken(row) };
    const guard = crypto.randomUUID(); guards.push(guard);
    statements.push(storage.leaseGuard(db, p, lease, guard, "sending", true, schedule, true),
      storage.updateOutcome(db, lease, "unknown", "periodic_lease_expired", now),
      ...deliveryRecordStatements(db, p, { deliveryId: member.delivery_id, candidateId: member.candidate_id, outcome: "unknown", reason: "periodic_lease_expired" }, member.candidate_name, now));
  }
  statements.push(db.prepare("UPDATE notification_poll_claims SET state='unknown',terminal_at=?,result=?,revision=revision+1 WHERE id=?")
    .bind(now.toISOString(), JSON.stringify(pollResult(row, members, "unknown", now.toISOString())), row.id), storage.cleanupGuards(db, guards));
  await storage.batch(db, statements, "lease_lost");
  return 1;
}
export async function pruneNotificationPollClaims(db: D1Database, now: Date) {
  return db.prepare(`DELETE FROM notification_poll_claims WHERE id IN (SELECT id FROM notification_poll_claims
    WHERE terminal_at IS NOT NULL AND terminal_at<? ORDER BY terminal_at,id LIMIT 100)`)
    .bind(new Date(now.getTime() - 90 * 86_400_000).toISOString()).run();
}
