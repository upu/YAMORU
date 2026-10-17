import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { applyMigrationsThrough, applyMigrationsAfter } from "./test-support/migrations";
import { resetNotificationFixtures, notificationCandidate, notificationPrincipal as principal } from "./test-support/notifications";
import { householdAMember } from "./test-support/households";
import { saveNotificationSettings } from "./notification-settings";
import { DEFAULT_SETTINGS } from "../../features/integration/notifications/contract";
import { enqueueNotification } from "./notification-outbox";
it("0041の行・日時と旧INSERTを維持し、証拠がない元対象を推測せず、triggerもbatchで全取消する", async () => {
  const db = env.DB;
  const now = new Date();
  await applyMigrationsThrough(db, "0041_notification_event_subscriptions");
  await resetNotificationFixtures(db);
  await saveNotificationSettings(db, householdAMember, { ...DEFAULT_SETTINGS, enabled: true, connectionId: principal.connectionId, mode: "individual", quietEnabled: false }, 0, now);
  const original = await notificationCandidate(db);
  const first = await enqueueNotification(db, principal, original.candidate.candidate_id, now);
  if (!first) throw new Error("Missing delivery");
  await db.prepare(`INSERT INTO notification_outbox(delivery_id,household_id,user_id,connection_id,candidate_id,candidate_name,state,next_attempt_at,created_at,updated_at)
    VALUES('legacy-missing','household-a','user-a','connection-a','deleted-candidate','以前の架空通知','unknown',?1,?1,?1)`).bind(now.toISOString()).run();
  const before = (await db.prepare("SELECT * FROM notification_outbox ORDER BY delivery_id").all()).results;
  await applyMigrationsAfter(db, "0041_notification_event_subscriptions");
  expect((await db.prepare("SELECT * FROM notification_outbox ORDER BY delivery_id").all()).results).toEqual(before);
  expect((await db.prepare("SELECT * FROM notification_outbox_sources").all()).results).toHaveLength(1);
  expect(await db.prepare("SELECT kind,entity_id,todo_rule_id FROM notification_outbox_sources").first())
    .toEqual({ kind: "todo_occurrence", entity_id: original.occurrenceId, todo_rule_id: original.ruleId });
  const next = await notificationCandidate(db);
  await enqueueNotification(db, principal, next.candidate.candidate_id, now);
  // 元のINSERT列だけでもtriggerが記録する。既存のWorkerは新表を知る必要がない。
  expect((await db.prepare("SELECT * FROM notification_outbox_sources").all()).results).toHaveLength(2);
  await expect(db.batch([
    db.prepare(`INSERT INTO notification_outbox(delivery_id,household_id,user_id,connection_id,candidate_id,candidate_name,state,next_attempt_at,created_at,updated_at)
      SELECT 'rolled-back',household_id,user_id,connection_id,candidate_id,candidate_name,'accepted',next_attempt_at,created_at,updated_at FROM notification_outbox WHERE delivery_id=?`).bind(first.deliveryId),
    db.prepare("INSERT INTO attention_guards(id,valid) VALUES('forced-context-rollback',0)"),
  ])).rejects.toThrow();
  expect(await db.prepare("SELECT * FROM notification_outbox WHERE delivery_id='rolled-back'").first()).toBeNull();
  expect(await db.prepare("SELECT * FROM notification_outbox_sources WHERE delivery_id='rolled-back'").first()).toBeNull();
  expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
});
