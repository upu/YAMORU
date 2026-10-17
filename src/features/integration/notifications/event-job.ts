import type { IntegrationPrincipal } from "../principal";
import { NotificationOutboxError, type NotificationLease } from "../../../lib/d1/notification-outbox";
import { beginEventRecipient, finishEventRecipient, settleNotificationEvent } from "../../../lib/d1/notification-event-dispatch";
import { sendEventRecipient } from "./event-delivery";
import type { PinnedWebhookTransport } from "./webhook-transport";
type Dependencies = { db: D1Database; principal: IntegrationPrincipal; secret: string; providerId: string; transport: PinnedWebhookTransport; now?: () => Date; signal?: AbortSignal };
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
function transitionQueue() {
  let previous = Promise.resolve();
  return <T>(run: () => Promise<T>) => {
    const next = previous.then(run);
    previous = next.then(() => {}, () => {});
    return next;
  };
}
export async function deliverFrozenNotificationEvent(deps: Dependencies, lease: NotificationLease, recipientIds: readonly string[]) {
  if (recipientIds.length < 1 || recipientIds.length > 20 || new Set(recipientIds).size !== recipientIds.length) throw new Error("invalid_recipient_set");
  const clock = deps.now ?? (() => new Date());
  const signal = deps.signal ? AbortSignal.any([deps.signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000);
  const serial = transitionQueue();
  const progress = { position: 0, started: 0, failed: false };
  async function work() {
    try {
      while (progress.position < recipientIds.length && !progress.failed && !signal.aborted) {
        const id = recipientIds[progress.position++];
        const attempt = await serial(() => signal.aborted ? Promise.resolve(null) : retryTransition(() => beginEventRecipient(deps.db, deps.principal, lease, id, clock())));
        if (!attempt) continue;
        const result = await sendEventRecipient({ ...deps, signal }, attempt);
        progress.started++;
        await serial(() => retryTransition(() => finishEventRecipient(deps.db, deps.principal, lease, attempt, result, clock()), true));
      }
    } catch { progress.failed = true; }
  }
  await Promise.all([work(), work()]);
  if (progress.failed) throw new NotificationEventJobError();
  const outcome = await retryTransition(() => settleNotificationEvent(deps.db, deps.principal, lease, clock()));
  return { ...outcome, started: progress.started };
}
