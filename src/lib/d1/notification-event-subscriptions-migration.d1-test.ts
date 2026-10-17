import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { applyMigrationsThrough, applyMigrationsAfter } from "./test-support/migrations";
import { resetNotificationFixtures, notificationCandidate, notificationPrincipal as principal } from "./test-support/notifications";
import { householdAMember, createHouseholdAMaintenanceTask } from "./test-support/households";
import { saveNotificationSettings } from "./notification-settings";
import { DEFAULT_SETTINGS } from "../../features/integration/notifications/contract";
import { enqueueNotification } from "./notification-outbox";
import { createEventSubscriptionService } from "../../features/integration/notifications/event-subscriptions";

it("0040から購読を追加しても旧SQLとoutboxを保持し、所有者FK・状態制約・cascadeを守る", async () => {
  const db = env.DB;
  const now = new Date();
  await applyMigrationsThrough(db, "0040_notification_outbox");
  await resetNotificationFixtures(db);
  const { candidate, occurrenceId } = await notificationCandidate(db);
  await saveNotificationSettings(db, householdAMember, { ...DEFAULT_SETTINGS, enabled: true, connectionId: principal.connectionId, mode: "individual", quietEnabled: false }, 0, now);
  await enqueueNotification(db, principal, candidate.candidate_id, now);
  const outbox = await db.prepare("SELECT * FROM notification_outbox").first();
  const occurrence = await db.prepare("SELECT * FROM task_occurrences WHERE id=?").bind(occurrenceId).first();
  await applyMigrationsAfter(db, "0040_notification_outbox");
  expect(await db.prepare("SELECT * FROM notification_outbox").first()).toEqual(outbox);
  expect(await db.prepare("SELECT * FROM task_occurrences WHERE id=?").bind(occurrenceId).first()).toEqual(occurrence);
  await createHouseholdAMaintenanceTask(db);
  const api = createEventSubscriptionService({ db, authorize: async () => principal, secret: "fictional-test-master-key-of-at-least-32-characters", providerId: "fixture-provider",
    transport: { post: async (_url, input) => Response.json(JSON.parse(input.body) as unknown) } });
  await api.subscribe({ name: "attention.ready", delivery: { mode: "webhook", url: "https://receiver.example.com/events", secret: `whsec_${btoa("x".repeat(32))}` } });
  await expect(db.prepare("UPDATE notification_event_subscriptions SET household_id='household-b'").run()).rejects.toThrow();
  await expect(db.prepare("UPDATE notification_event_subscriptions SET encrypted_destination=NULL").run()).rejects.toThrow();
  await expect(db.prepare("UPDATE notification_event_subscriptions SET state='revoked'").run()).rejects.toThrow();
  await db.prepare("DELETE FROM households WHERE id='household-a'").run();
  expect((await db.prepare("SELECT * FROM notification_event_subscriptions").all()).results).toEqual([]);
  expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
});
