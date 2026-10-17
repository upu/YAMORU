import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { applyMigrationsThrough, applyMigrationsAfter } from "./test-support/migrations";
import { resetNotificationFixtures, notificationPrincipal as principal } from "./test-support/notifications";
it("0043の本文・ID・日時を保ち、旧SQLでも終端時刻を同期し、失敗時は全取消する", async () => {
  const db = env.DB;
  await applyMigrationsThrough(db, "0043_notification_event_recipients");
  await resetNotificationFixtures(db);
  await db.prepare(`INSERT INTO notification_outbox(delivery_id,household_id,user_id,connection_id,candidate_id,candidate_name,state,next_attempt_at,created_at,updated_at)
    VALUES('active',?1,?2,?3,'active-candidate','','pending','2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z','2026-10-02T00:00:00.000Z'),
    ('terminal',?1,?2,?3,'old-candidate','','unknown','2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z','2026-10-02T00:00:00.000Z')`)
    .bind(principal.householdId, principal.userId, principal.connectionId).run();
  const insert = () => db.prepare(`INSERT INTO notification_event_batches(delivery_id,household_id,user_id,connection_id,event_id,body,frozen_at)
    SELECT delivery_id,household_id,user_id,connection_id,delivery_id,'{}',created_at FROM notification_outbox`);
  await insert().run();
  const before = (await db.prepare("SELECT * FROM notification_event_batches ORDER BY delivery_id").all()).results;
  await applyMigrationsAfter(db, "0043_notification_event_recipients");
  const after = (await db.prepare("SELECT * FROM notification_event_batches ORDER BY delivery_id").all()).results;
  expect(after.map((row) => { const copy = { ...row }; delete copy.terminal_at; return copy; })).toEqual(before);
  expect(after.map((r) => r.terminal_at)).toEqual([null, "2026-10-02T00:00:00.000Z"]);
  await db.prepare("UPDATE notification_outbox SET state='failed',updated_at='2026-10-03T00:00:00.000Z' WHERE delivery_id='active'").run();
  expect((await db.prepare("SELECT terminal_at FROM notification_event_batches WHERE delivery_id='active'").first())?.terminal_at).toBe("2026-10-03T00:00:00.000Z");
  await db.prepare("UPDATE notification_outbox SET state='pending' WHERE delivery_id='active'").run();
  expect((await db.prepare("SELECT terminal_at FROM notification_event_batches WHERE delivery_id='active'").first())?.terminal_at).toBeNull();
  await expect(db.batch([db.prepare("UPDATE notification_outbox SET state='accepted' WHERE delivery_id='active'"), db.prepare("INSERT INTO attention_guards(id,valid) VALUES('forced-body-rollback',0)")])).rejects.toThrow();
  expect((await db.prepare("SELECT terminal_at FROM notification_event_batches WHERE delivery_id='active'").first())?.terminal_at).toBeNull();
  await db.prepare("DELETE FROM notification_event_batches").run();
  await insert().run();
  expect((await db.prepare("SELECT terminal_at FROM notification_event_batches WHERE delivery_id='terminal'").first())?.terminal_at).toBe("2026-10-02T00:00:00.000Z");
  expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
});
