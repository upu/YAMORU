import type { IntegrationPrincipal } from "../principal";
import { NotificationOutboxError, type NotificationLease, type SendResult } from "../../../lib/d1/notification-outbox";
import { beginEventRecipient, finishEventRecipient, settleNotificationEvent, type EventRecipientAttempt } from "../../../lib/d1/notification-event-dispatch";
import { beginDailyNotificationGroup, finishDailyNotificationGroup, DAILY_GROUP_ITEM_LIMIT } from "../../../lib/d1/notification-event-groups";
import { sendEventRecipient } from "./event-delivery";
import type { PinnedWebhookTransport } from "./webhook-transport";
import type { SchedulerLease } from "../../../lib/d1/notification-scheduler";
type Dependencies = { db: D1Database; principal: IntegrationPrincipal; secret: string; providerId: string; transport: PinnedWebhookTransport; now?: () => Date; signal?: AbortSignal; maintenance?: SchedulerLease };
export class NotificationEventJobError extends Error {
  constructor() { super("notification_event_storage_unavailable"); }
}
function retryableTransition(error: unknown, finish: boolean) {
  return finish || (error instanceof NotificationOutboxError && error.code === "read_conflict");
}
async function retryTransition<T>(operation: () => Promise<T>, finish = false): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); }
    catch (error) {
      if (attempt >= 2 || !retryableTransition(error, finish)) throw new NotificationEventJobError();
    }
  }
}
// mutexは一回のjob内だけ。DBの親revisionを競合させず、HTTPは二宛先まで並行する。
function transitionQueue(onFailure: () => void) {
  let previous = Promise.resolve();
  return <T>(run: () => Promise<T>) => {
    const next = previous.then(run).catch((error: unknown) => { onFailure(); throw error; });
    previous = next.then(() => {}, () => {});
    return next;
  };
}
async function dispatchAttempts(deps: Dependencies, ids: readonly string[], begin: (id: string) => Promise<EventRecipientAttempt | null>, finish: (id: string, attempt: EventRecipientAttempt, result: SendResult) => Promise<unknown>) {
  const stopped = new AbortController();
  const signal = AbortSignal.any([stopped.signal, AbortSignal.timeout(90_000), ...(deps.signal ? [deps.signal] : [])]);
  const progress = { position: 0, started: 0, failed: false };
  const stop = () => { progress.failed = true; stopped.abort(); };
  // queueを解放する前に停止し、後ろで待つbeginへ失敗を確実に伝える。
  const serial = transitionQueue(stop);
  async function work() {
    try {
      while (progress.position < ids.length && !progress.failed && !signal.aborted) {
        const id = ids[progress.position++];
        const attempt = await serial(() => signal.aborted || progress.failed ? Promise.resolve(null) : retryTransition(() => begin(id)));
        if (!attempt) continue;
        const result = await sendEventRecipient({ ...deps, signal }, attempt);
        progress.started++;
        await serial(() => retryTransition(() => finish(id, attempt, result), true));
      }
    } catch { stop(); }
  }
  await Promise.all([work(), work()]);
  if (progress.failed) throw new NotificationEventJobError();
  return progress.started;
}
function validSet(ids: readonly string[], maximum: number) {
  return ids.length >= 1 && ids.length <= maximum && new Set(ids).size === ids.length;
}
export async function deliverFrozenNotificationEvent(deps: Dependencies, lease: NotificationLease, recipientIds: readonly string[]) {
  if (!validSet(recipientIds, 20)) throw new Error("invalid_recipient_set");
  const clock = deps.now ?? (() => new Date());
  const started = await dispatchAttempts(deps, recipientIds,
    (id) => beginEventRecipient(deps.db, deps.principal, lease, id, clock(), deps.maintenance),
    (_id, attempt, result) => finishEventRecipient(deps.db, deps.principal, lease, attempt, result, clock()));
  const outcome = await retryTransition(() => settleNotificationEvent(deps.db, deps.principal, lease, clock()));
  return { ...outcome, started };
}
export async function deliverFrozenDailyNotificationEvents(deps: Dependencies, leases: readonly NotificationLease[], groupIds: readonly string[]) {
  if (!validSet(groupIds, 20) || !validSet(leases.map((l) => l.deliveryId), DAILY_GROUP_ITEM_LIMIT)) throw new Error("invalid_group_set");
  const count = await deps.db.prepare(`SELECT sum(item_count) AS total FROM notification_event_groups WHERE household_id=? AND user_id=? AND connection_id=?
    AND id IN (SELECT value FROM json_each(?))`).bind(deps.principal.householdId, deps.principal.userId, deps.principal.connectionId, JSON.stringify(groupIds)).first<{ total: number | null }>();
  if ((count?.total ?? 0) > DAILY_GROUP_ITEM_LIMIT) throw new Error("invalid_group_budget");
  const clock = deps.now ?? (() => new Date());
  const started = await dispatchAttempts(deps, groupIds,
    (id) => beginDailyNotificationGroup(deps.db, deps.principal, id, leases, clock(), deps.maintenance),
    (id, attempt, result) => finishDailyNotificationGroup(deps.db, deps.principal, id, leases, attempt, result, clock()));
  const outcomes = [];
  for (const lease of leases) outcomes.push({ deliveryId: lease.deliveryId, ...await retryTransition(() => settleNotificationEvent(deps.db, deps.principal, lease, clock())) });
  return { outcomes, started };
}
