import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { applyMigrationsAfter, applyMigrationsThrough } from "./test-support/migrations";
import { notificationCandidate, notificationPrincipal as p, resetNotificationFixtures } from "./test-support/notifications";
import { enqueueNotification, leaseNotification, beginNotificationSend, finishNotificationSend } from "./notification-outbox";
import { saveNotificationSettings } from "./notification-settings";
import { householdAMember } from "./test-support/households";
import { DEFAULT_SETTINGS } from "../../features/integration/notifications/contract";
const db = env.DB;
it("0046の行と旧SQLを保持し、確保の家庭・本人・接続一致と一意性・cascadeを守る", async () => {
  await applyMigrationsThrough(db, "0046_notification_event_groups"); await resetNotificationFixtures(db);
  const now = new Date();
  await saveNotificationSettings(db, householdAMember, { ...DEFAULT_SETTINGS, enabled: true, connectionId: p.connectionId, quietEnabled: false }, 0, now);
  const source = await notificationCandidate(db); await enqueueNotification(db, p, source.candidate.candidate_id, now);
  const before = (await db.prepare("SELECT * FROM notification_outbox").all()).results;
  await applyMigrationsAfter(db, "0046_notification_event_groups");
  expect((await db.prepare("SELECT * FROM notification_outbox").all()).results).toEqual(before);
  const lease = await leaseNotification(db, p, now); if (!lease) throw new Error("Missing legacy lease");
  expect(await beginNotificationSend(db, p, lease, now)).toMatchObject({ state: "sending" });
  await finishNotificationSend(db, p, lease, { kind: "unknown" }, now);
  const insert = (id: string) => db.prepare(`INSERT INTO notification_poll_claims(id,household_id,user_id,connection_id,state,item_count,lease_token,lease_expires_at,idempotency_key,created_at)
    VALUES(?,'household-a','user-a','connection-a','claimed',1,'fictional-token','2030-01-01T00:00:00.000Z',?,'2026-01-01T00:00:00.000Z')`).bind(id, id);
  const member = (id: string) => db.prepare("INSERT INTO notification_poll_claim_items(claim_id,delivery_id,household_id,user_id,connection_id) VALUES(?,?,'household-a','user-a','connection-a')").bind(id, lease.deliveryId);
  await db.batch([insert("poll-a"), member("poll-a")]);
  await expect(db.batch([insert("poll-b"), member("poll-b")])).rejects.toThrow();
  expect((await db.prepare("SELECT id FROM notification_poll_claims").all()).results).toEqual([{ id: "poll-a" }]);
  await expect(db.prepare("UPDATE notification_poll_claim_items SET household_id='household-b'").run()).rejects.toThrow();
  await expect(db.prepare("UPDATE notification_poll_claims SET user_id='user-b'").run()).rejects.toThrow();
  for (const sql of ["item_count=51", "item_count=0", "lease_token=NULL", "state='reported'", "lease_expires_at='2000-01-01T00:00:00.000Z'"]) await expect(db.prepare(`UPDATE notification_poll_claims SET ${sql}`).run()).rejects.toThrow();
  for (const [sql, index] of [
    ["SELECT id FROM notification_poll_claims WHERE connection_id='connection-a' AND state='claimed' AND lease_expires_at<'2027-01-01' ORDER BY lease_expires_at,id LIMIT 1", "notification_poll_claims_expired_idx"],
    ["SELECT id FROM notification_poll_claims WHERE terminal_at IS NOT NULL AND terminal_at<'2027-01-01' ORDER BY terminal_at,id LIMIT 100", "notification_poll_claims_retention_idx"],
  ]) expect(JSON.stringify((await db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all()).results)).toContain(index);
  await db.prepare("DELETE FROM notification_outbox").run();
  expect((await db.prepare("SELECT * FROM notification_poll_claim_items").all()).results).toEqual([]);
  expect(await db.prepare("SELECT item_count FROM notification_poll_claims").first()).toEqual({ item_count: 1 });
  await db.prepare("DELETE FROM households WHERE id='household-a'").run();
  expect((await db.prepare("SELECT * FROM notification_poll_claims").all()).results).toEqual([]);
  expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
});
