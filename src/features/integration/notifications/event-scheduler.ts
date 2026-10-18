import type { IntegrationPrincipal } from "../principal";
import type { PinnedWebhookTransport } from "./webhook-transport";
import { deliverFrozenDailyNotificationEvents, deliverFrozenNotificationEvent } from "./event-job";
import { freezeNotificationEvent, notificationRecipientStorage, reconcileEventRecipient, settleNotificationEvent } from "../../../lib/d1/notification-event-dispatch";
import { DAILY_GROUP_ITEM_LIMIT, freezeDailyNotificationGroup } from "../../../lib/d1/notification-event-groups";
import { claimScheduledEventWork, releaseUnsentEventWork, scheduledRecipientIds } from "../../../lib/d1/notification-event-work";
import type { NotificationLease } from "../../../lib/d1/notification-outbox";
import type { SchedulerLease } from "../../../lib/d1/notification-scheduler";
import { getNotificationSettings } from "../../../lib/d1/notification-settings";
import { readNotificationPolicyFrame } from "../../../lib/d1/notification-policy";
export type NotificationEventProvider = { secret: string; providerId: string; transport: PinnedWebhookTransport };
type Dependencies = NotificationEventProvider & { db: D1Database; principal: IntegrationPrincipal; maintenance: SchedulerLease; now: () => Date; signal: AbortSignal };
type Prepared = { lease: NotificationLease; mode: "daily" | "individual"; ids: string[] };
async function prepare(deps: Dependencies, leases: NotificationLease[]) {
  const prepared: Prepared[] = [];
  const frame = await readNotificationPolicyFrame(deps.db, deps.principal, deps.now());
  for (const lease of leases) {
    const frozen = await freezeNotificationEvent(deps.db, deps.principal, lease, deps.now(), deps.maintenance, frame)
      ?? await notificationRecipientStorage.frozenEvent(deps.db, lease.deliveryId);
    if (!frozen) { await releaseUnsentEventWork(deps.db, deps.principal, deps.maintenance, lease, deps.now()); continue; }
    prepared.push({ lease, mode: frozen.mode, ids: await scheduledRecipientIds(deps.db, lease, deps.now(), 20) });
  }
  return prepared;
}
async function individual(deps: Dependencies, entries: Prepared[], remaining: number) {
  let cost = 0; let processed = 0;
  for (const entry of entries) {
    if (cost >= remaining || deps.signal.aborted) break;
    const ids = entry.ids.slice(0, remaining - cost);
    if (ids.length) await deliverFrozenNotificationEvent(deps, entry.lease, ids);
    else await settleNotificationEvent(deps.db, deps.principal, entry.lease, deps.now());
    cost += Math.max(1, ids.length);
    processed++;
  }
  for (const entry of entries.slice(processed)) await settleNotificationEvent(deps.db, deps.principal, entry.lease, deps.now());
  return cost;
}
async function reconcileOnly(deps: Dependencies, entries: Prepared[], remaining: number) {
  let cost = 0;
  for (const entry of entries) {
    for (const id of entry.ids.slice(0, remaining - cost)) {
      if (deps.signal.aborted) break;
      await reconcileEventRecipient(deps.db, deps.principal, entry.lease, id, deps.now(), deps.maintenance);
      cost++;
    }
    await settleNotificationEvent(deps.db, deps.principal, entry.lease, deps.now());
  }
  return cost;
}
async function daily(deps: Dependencies, entries: Prepared[], remaining: number) {
  const leases = entries.map((e) => e.lease);
  const ids = [...new Set(entries.flatMap((e) => e.ids))].sort();
  // 一回の空振りで全親を照合するため、後続の宛先は次のCronへ残す。
  for (const id of ids.slice(0, 1)) {
    const group = await freezeDailyNotificationGroup(deps.db, deps.principal, leases, id, deps.now(), deps.maintenance);
    if (!group) continue;
    const row = await deps.db.prepare("SELECT item_count FROM notification_event_groups WHERE id=?").bind(group.id).first<{ item_count: number }>();
    if (!row || row.item_count > remaining) throw new Error("invalid_group_budget");
    await deliverFrozenDailyNotificationEvents(deps, leases, [group.id]);
    return row.item_count;
  }
  return reconcileOnly(deps, entries, remaining);
}
async function deliverPrepared(deps: Dependencies, entries: Prepared[], remaining: number) {
  const { settings } = await getNotificationSettings(deps.db, { userId: deps.principal.userId }, deps.principal.householdId);
  const reconciled = await reconcileOnly(deps, entries.filter((e) => e.mode !== settings.mode), remaining);
  const current = entries.filter((e) => e.mode === settings.mode);
  const available = remaining - reconciled;
  if (!available) {
    for (const entry of current) await settleNotificationEvent(deps.db, deps.principal, entry.lease, deps.now());
    return reconciled;
  }
  const cost = settings.mode === "daily" ? await daily(deps, current, available) : await individual(deps, current, available);
  return reconciled + cost;
}
export async function sendScheduledNotificationEvents(deps: Omit<Dependencies, "signal">) {
  const context = { ...deps, signal: AbortSignal.timeout(90_000) };
  let remaining = DAILY_GROUP_ITEM_LIMIT;
  while (remaining > 0 && !context.signal.aborted) {
    const work = await claimScheduledEventWork(deps.db, deps.principal, deps.maintenance, deps.now(), remaining);
    if (!work.leases.length) break;
    if (work.groupId) {
      await deliverFrozenDailyNotificationEvents(context, work.leases, [work.groupId]); remaining -= work.cost; continue;
    }
    const entries = await prepare(context, work.leases);
    remaining -= Math.max(work.leases.length, await deliverPrepared(context, entries, remaining));
  }
}
