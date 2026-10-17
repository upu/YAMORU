import { readHouseholdVersion } from "../../../lib/d1/conversation-read";
import { refreshAttention } from "../../../lib/d1/attention";
import { enqueueNotification, reconcilePendingNotifications, recoverNotificationLeases, NotificationOutboxError } from "../../../lib/d1/notification-outbox";
import { claimNotificationSchedule, finishNotificationSchedule, schedulerPrincipal, seedNotificationSchedule, schedulerCandidatePage, type SchedulerLease, type SchedulerPosition } from "../../../lib/d1/notification-scheduler";
import { usableNotificationConnection } from "../../../lib/d1/notification-settings";
import { pruneDeliveryHistory } from "../../../lib/d1/notification-deliveries";
import { ReadError } from "../read-contract";
import { formatTokyoDateInput } from "../../todos/projection/time-zone";
type Dependencies = { db: D1Database; allowedClientIds: readonly string[]; now?: () => Date; candidateLimit?: number; connectionLimit?: number };
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
  await recoverNotificationLeases(deps.db, p, now);
  const allowed = deps.allowedClientIds.includes(p.clientId);
  const reconciled = await reconcilePendingNotifications(deps.db, p, now, lease.outbox_after, allowed ? undefined : "client_disabled");
  if (!allowed || !await usableNotificationConnection(deps.db, p, p.connectionId, now)) return { ...lease, outbox_after: reconciled.nextAfter };
  const version = await readHouseholdVersion(deps.db, p.householdId);
  const day = formatTokyoDateInput(now.toISOString());
  const resume = lease.source_epoch === version.epoch && lease.source_version === version.version && lease.source_day === day;
  const sourceAfter = await refreshAttention(deps.db, p.householdId, version, now, resume ? lease.source_after : "");
  const page = await schedulerCandidatePage(deps.db, p.householdId, lease.candidate_after, limit);
  for (const id of page.ids) await enqueueNotification(deps.db, p, id, now);
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
    const lease = await claimNotificationSchedule(deps.db, clock());
    if (!lease) break;
    try {
      const position = await processConnection(deps, lease, candidateLimit);
      await finishNotificationSchedule(deps.db, lease, position, clock());
    } catch (error) {
      const reason = error instanceof ReadError || error instanceof NotificationOutboxError ? "conflict" : "unavailable";
      await finishNotificationSchedule(deps.db, lease, lease, clock(), reason);
      failed++;
    }
  }
  await pruneDeliveryHistory(deps.db, clock());
  return { processed, failed };
}
