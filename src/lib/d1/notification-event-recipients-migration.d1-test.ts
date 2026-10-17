import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { applyMigrationsThrough, applyMigrationsAfter } from "./test-support/migrations";
import { resetNotificationFixtures, notificationCandidate, notificationPrincipal as principal } from "./test-support/notifications";
import { householdAMember } from "./test-support/households";
import { createEventSubscriptionService } from "../../features/integration/notifications/event-subscriptions";
import { DEFAULT_SETTINGS } from "../../features/integration/notifications/contract";
import { saveNotificationSettings } from "./notification-settings";
import { enqueueNotification, leaseNotification } from "./notification-outbox";
import { freezeNotificationEvent } from "./notification-event-dispatch";
it("0042の行・日時と旧購読SQLを保持し、宛先の家庭一致・不変identity・全取消を強制する", async () => {
  const db = env.DB; const now = new Date();
  await applyMigrationsThrough(db, "0042_notification_outbox_sources");
  await resetNotificationFixtures(db);
  await saveNotificationSettings(db, householdAMember, { ...DEFAULT_SETTINGS, enabled: true, connectionId: principal.connectionId, mode: "individual", quietEnabled: false }, 0, now);
  const source = await notificationCandidate(db);
  await enqueueNotification(db, principal, source.candidate.candidate_id, now);
  const api = createEventSubscriptionService({ db, authorize: async () => principal, secret: "fictional-master-secret-at-least-32-bytes", providerId: "test",
    transport: { post: async (_url, request) => Response.json(JSON.parse(request.body) as unknown) } });
  await api.subscribe({ name: "attention.ready", delivery: { mode: "webhook", url: "https://receiver.example.com/events", secret: `whsec_${btoa("x".repeat(32))}` } });
  const before = await db.prepare("SELECT * FROM notification_event_subscriptions").first();
  const outbox = await db.prepare("SELECT * FROM notification_outbox").first();
  await applyMigrationsAfter(db, "0042_notification_outbox_sources");
  const after = await db.prepare("SELECT * FROM notification_event_subscriptions").first();
  expect(after?.lifecycle).toMatch(/^[0-9a-f]{32}$/);
  const unchanged = { ...after };
  delete unchanged.lifecycle;
  expect(unchanged).toEqual(before);
  expect(await db.prepare("SELECT * FROM notification_outbox").first()).toEqual(outbox);
  // 旧Workerの更新列だけでも、未失効の更新は世代不変、停止後の再開では別世代になる。
  await db.prepare("UPDATE notification_event_subscriptions SET revision=revision+1,updated_at=?").bind(now.toISOString()).run();
  expect((await db.prepare("SELECT lifecycle FROM notification_event_subscriptions").first())?.lifecycle).toBe(after?.lifecycle);
  const lease = await leaseNotification(db, principal, now);
  if (!lease) throw new Error("Missing lease");
  await freezeNotificationEvent(db, principal, lease, now);
  await expect(db.prepare("UPDATE notification_event_recipients SET household_id='household-b'").run()).rejects.toThrow();
  await expect(db.prepare(`INSERT INTO notification_event_recipients(delivery_id,household_id,user_id,connection_id,subscription_id,lifecycle,next_attempt_at,updated_at)
    SELECT delivery_id,household_id,user_id,connection_id,'foreign-subscription',lifecycle,next_attempt_at,updated_at FROM notification_event_recipients`).run()).rejects.toThrow("recipient owner mismatch");
  const recipients = (await db.prepare("SELECT * FROM notification_event_recipients").all()).results;
  await expect(db.batch([db.prepare("UPDATE notification_event_recipients SET state='accepted'"), db.prepare("INSERT INTO attention_guards(id,valid) VALUES('forced-recipient-rollback',0)")])).rejects.toThrow();
  expect((await db.prepare("SELECT * FROM notification_event_recipients").all()).results).toEqual(recipients);
  await db.prepare("DELETE FROM notification_event_subscriptions").run();
  expect((await db.prepare("SELECT * FROM notification_event_recipients").all()).results).toEqual(recipients);
  await db.prepare("DELETE FROM households WHERE id='household-a'").run();
  expect((await db.prepare("SELECT * FROM notification_event_batches").all()).results).toEqual([]);
  expect((await db.prepare("SELECT * FROM notification_event_recipients").all()).results).toEqual([]);
  expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
});
