import { readHouseholdVersion } from "../../../lib/d1/conversation-read";
import { refreshAttention } from "../../../lib/d1/attention";
import { drainStoppedNotificationSchedule, enqueueNotificationPage, reconcilePendingNotifications, recoverNotificationLeases, NotificationOutboxError } from "../../../lib/d1/notification-outbox";
import { claimNotificationSchedule, finishNotificationSchedule, schedulerPrincipal, seedNotificationSchedule, schedulerCandidatePage, type SchedulerLease, type SchedulerPosition } from "../../../lib/d1/notification-scheduler";
import { usableNotificationConnection } from "../../../lib/d1/notification-settings";
import { pruneDeliveryHistory } from "../../../lib/d1/notification-deliveries";
import { pruneEventSubscriptions } from "../../../lib/d1/notification-event-subscriptions";
import { pruneNotificationOutbox } from "../../../lib/d1/notification-outbox-retention";
import { ReadError } from "../read-contract";
import { formatTokyoDateInput } from "../../todos/projection/time-zone";
import { recoverNotificationEventGroups } from "../../../lib/d1/notification-event-groups";
import { reconcileNotificationGroups } from "../../../lib/d1/notification-event-work";
import { sendScheduledNotificationEvents, type NotificationEventProvider } from "./event-scheduler";
import { readNotificationPolicyFrame } from "../../../lib/d1/notification-policy";
import { pruneNotificationPollClaims, recoverNotificationPollClaims } from "../../../lib/d1/notification-poll-recovery";
type Dependencies = { db: D1Database; allowedClientIds: readonly string[]; now?: () => Date; candidateLimit?: number; connectionLimit?: number; events?: NotificationEventProvider };
const systemNow = () => new Date();
function bounded(value: number | undefined, fallback: number, max: number) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > max) throw new Error("Invalid scheduler work limit");
  return value;
}
async function processConnection(deps: Dependencies, lease: SchedulerLease, limit: number): Promise<SchedulerPosition> {
  const p = await schedulerPrincipal(deps.db, lease);
  if (!p) return lease;
  const now = deps.now?.() ?? new Date();
  await recoverNotificationPollClaims(deps.db, p, lease, now);
  const allowed = deps.allowedClientIds.includes(p.clientId);
  if (!allowed || !await usableNotificationConnection(deps.db, p, p.connectionId, now)) {
    const reason = allowed ? "connection_unavailable" : "client_disabled";
    await recoverNotificationEventGroups(deps.db, p, now, lease);
    await reconcileNotificationGroups(deps.db, p, lease, now, reason);
    const result = await drainStoppedNotificationSchedule(deps.db, p, lease, now, reason);
    return { ...lease, outbox_after: result.nextAfter };
  }
  await recoverNotificationEventGroups(deps.db, p, now, lease);
  await recoverNotificationLeases(deps.db, p, now);
  const reconciled = await reconcilePendingNotifications(deps.db, p, now, lease.outbox_after);
  await reconcileNotificationGroups(deps.db, p, lease, now);
  if (!await usableNotificationConnection(deps.db, p, p.connectionId, now)) return { ...lease, outbox_after: reconciled.nextAfter };
  const version = await readHouseholdVersion(deps.db, p.householdId);
  const day = formatTokyoDateInput(now.toISOString());
  const resume = lease.source_epoch === version.epoch && lease.source_version === version.version && lease.source_day === day;
  const sourceAfter = await refreshAttention(deps.db, p.householdId, version, now, resume ? lease.source_after : "");
  const page = await schedulerCandidatePage(deps.db, p.householdId, lease.candidate_after, limit);
  const frame = await readNotificationPolicyFrame(deps.db, p, now);
  await enqueueNotificationPage(deps.db, p, page.ids, now, frame);
  if (deps.events) await sendScheduledNotificationEvents({ ...deps.events, db: deps.db, principal: p, maintenance: lease, now: deps.now ?? systemNow });
  return { source_epoch: version.epoch, source_version: version.version, source_day: day, source_after: sourceAfter ?? "", candidate_after: page.nextAfter, outbox_after: reconciled.nextAfter };
}
export async function runNotificationScheduler(deps: Dependencies) {
  const clock = deps.now ?? systemNow;
  const candidateLimit = bounded(deps.candidateLimit, 25, 50);
  const connectionLimit = bounded(deps.connectionLimit, 2, 5);
  const now = clock();
  await seedNotificationSchedule(deps.db, deps.allowedClientIds, now);
  let processed = 0;
  let failed = 0;
  for (; processed < connectionLimit; processed++) {
    const lease = await claimNotificationSchedule(deps.db, clock(), deps.allowedClientIds);
    if (!lease) break;
    try {
      const position = await processConnection(deps, lease, candidateLimit);
      await finishNotificationSchedule(deps.db, lease, position, clock(), deps.allowedClientIds);
    } catch (error) {
      const reason = error instanceof ReadError || error instanceof NotificationOutboxError ? "conflict" : "unavailable";
      await finishNotificationSchedule(deps.db, lease, lease, clock(), deps.allowedClientIds, reason);
      failed++;
    }
  }
  await pruneDeliveryHistory(deps.db, clock());
  await pruneEventSubscriptions(deps.db, clock());
  await pruneNotificationOutbox(deps.db, clock());
  await pruneNotificationPollClaims(deps.db, clock());
  return { processed, failed };
}
