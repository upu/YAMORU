import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { applyMigrationsAfter, applyMigrationsThrough } from "./test-support/migrations";
import { resetNotificationFixtures, notificationCandidate, notificationPrincipal as principal } from "./test-support/notifications";
import { householdAMember } from "./test-support/households";
import { createEventSubscriptionService } from "../../features/integration/notifications/event-subscriptions";
import { DEFAULT_SETTINGS } from "../../features/integration/notifications/contract";
import { saveNotificationSettings } from "./notification-settings";
import { enqueueNotification, leaseNotification } from "./notification-outbox";
import { freezeNotificationEvent } from "./notification-event-dispatch";
const db = env.DB;
it("0045の行・旧SQLを保持し、まとめの不変本文・所有者・一件の確保と原子性を守る", async () => {
  const now = new Date();
  await applyMigrationsThrough(db, "0045_integration_command_confirmation");
  await resetNotificationFixtures(db);
  await saveNotificationSettings(db, householdAMember, { ...DEFAULT_SETTINGS, enabled: true, connectionId: principal.connectionId, mode: "daily", digestTime: "00:00", quietEnabled: false }, 0, now);
  const source = await notificationCandidate(db);
  const service = createEventSubscriptionService({ db, authorize: async () => principal, secret: "fictional-digest-master-secret-at-least-32-bytes", providerId: "test",
    transport: { post: async (_url, request) => Response.json(JSON.parse(request.body) as unknown) } });
  await service.subscribe({ name: "attention.ready", delivery: { mode: "webhook", url: "https://receiver.example.com/digest", secret: `whsec_${btoa("x".repeat(32))}` } });
  await enqueueNotification(db, principal, source.candidate.candidate_id, now);
  const lease = await leaseNotification(db, principal, now);
  if (!lease) throw new Error("Missing lease");
  await freezeNotificationEvent(db, principal, lease, now);
  const tablesBefore = ["notification_outbox", "notification_outbox_sources", "notification_event_batches", "notification_event_recipients", "notification_event_subscriptions"];
  const readRows = () => Promise.all(tablesBefore.map(async (table) => (await db.prepare(`SELECT * FROM ${table}`).all()).results));
  const rowsBefore = await readRows();
  await applyMigrationsAfter(db, "0045_integration_command_confirmation");
  expect(await readRows()).toEqual(rowsBefore);
  const tables = (await db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE 'notification_event_group%' ORDER BY name").all<{ name: string }>()).results.map((row) => row.name);
  expect(tables).toEqual(["notification_event_group_claims", "notification_event_group_items", "notification_event_groups"]);
  const insertGroup = (id: string) => db.prepare(`INSERT INTO notification_event_groups(id,household_id,user_id,connection_id,subscription_id,lifecycle,event_id,body,item_count,next_attempt_at,frozen_at,updated_at)
    SELECT ?,household_id,user_id,connection_id,subscription_id,lifecycle,?,'{"data":{"notification_mode":"daily"}}',1,?,?,? FROM notification_event_recipients`)
    .bind(id, `evt_${id}`, now.toISOString(), now.toISOString(), now.toISOString());
  const insertItem = (id: string) => db.prepare(`INSERT INTO notification_event_group_items(group_id,delivery_id,subscription_id,household_id,user_id,connection_id,lifecycle)
    SELECT ?,delivery_id,subscription_id,household_id,user_id,connection_id,lifecycle FROM notification_event_recipients`).bind(id);
  const insertClaim = (id: string) => db.prepare(`INSERT INTO notification_event_group_claims(delivery_id,subscription_id,group_id)
    SELECT delivery_id,subscription_id,group_id FROM notification_event_group_items WHERE group_id=?`).bind(id);
  await db.batch([insertGroup("digest-a"), insertItem("digest-a"), insertClaim("digest-a")]);
  // 同じrecipientを二つのgroupが所有できず、先行する本文・所属も全取消する。
  await expect(db.batch([insertGroup("digest-conflict"), insertItem("digest-conflict"), insertClaim("digest-conflict")])).rejects.toThrow();
  expect((await db.prepare("SELECT id FROM notification_event_groups ORDER BY id").all()).results).toEqual([{ id: "digest-a" }]);
  for (const change of ["event_id='other-event'", "body='{}'", "item_count=2", "frozen_at='changed'", "household_id='household-b'", "body=NULL"]) {
    await expect(db.prepare(`UPDATE notification_event_groups SET ${change} WHERE id='digest-a'`).run()).rejects.toThrow();
  }
  await expect(db.prepare("UPDATE notification_event_group_items SET household_id='household-b'").run()).rejects.toThrow("event group item is immutable");
  await expect(db.prepare("UPDATE notification_event_group_claims SET group_id='other'").run()).rejects.toThrow("event group claim is immutable");
  await expect(db.prepare(`INSERT INTO notification_event_groups(id,household_id,user_id,connection_id,subscription_id,lifecycle,event_id,body,item_count,next_attempt_at,frozen_at,updated_at)
    SELECT 'foreign',household_id,'user-b',connection_id,subscription_id,lifecycle,'evt_foreign','{}',1,next_attempt_at,frozen_at,updated_at FROM notification_event_groups`).run()).rejects.toThrow("event group owner mismatch");
  // 確保の解放は過去の所属や宛先別結果を消さない。
  await db.batch([insertGroup("digest-b"), db.prepare("DELETE FROM notification_event_group_claims WHERE group_id='digest-a'"), insertItem("digest-b"), insertClaim("digest-b")]);
  expect((await db.prepare("SELECT group_id FROM notification_event_group_items ORDER BY group_id").all()).results).toEqual([{ group_id: "digest-a" }, { group_id: "digest-b" }]);
  expect((await db.prepare("SELECT group_id FROM notification_event_group_claims").all()).results).toEqual([{ group_id: "digest-b" }]);
  await insertGroup("digest-owner").run();
  await expect(db.prepare(`INSERT INTO notification_event_group_items(group_id,delivery_id,subscription_id,household_id,user_id,connection_id,lifecycle)
    SELECT 'digest-owner',delivery_id,subscription_id,'household-b',user_id,connection_id,lifecycle FROM notification_event_recipients`).run()).rejects.toThrow("FOREIGN KEY constraint failed");
  await insertItem("digest-owner").run();
  await db.prepare("DELETE FROM notification_event_groups WHERE id='digest-owner'").run();
  expect((await db.prepare("SELECT * FROM notification_event_group_items").all()).results).toHaveLength(2);
  // 旧Workerの結果更新と購読清掃を続けられ、既存の時刻やgroupの証拠は失わない。
  await db.prepare("UPDATE notification_event_recipients SET state='accepted',updated_at=?").bind(now.toISOString()).run();
  await db.prepare("UPDATE notification_outbox SET state='accepted',lease_token=NULL,lease_expires_at=NULL,updated_at=?").bind(now.toISOString()).run();
  const groupBefore = (await db.prepare("SELECT * FROM notification_event_groups ORDER BY id").all()).results;
  await db.prepare("DELETE FROM notification_event_subscriptions").run();
  expect((await db.prepare("SELECT * FROM notification_event_groups ORDER BY id").all()).results).toEqual(groupBefore);
  expect((await db.prepare("SELECT * FROM notification_event_group_items").all()).results).toHaveLength(2);
  await db.prepare("UPDATE notification_event_groups SET state='accepted',terminal_at=?,updated_at=? WHERE id='digest-a'").bind(now.toISOString(), now.toISOString()).run();
  await db.prepare("UPDATE notification_event_groups SET body=NULL WHERE id='digest-a'").run();
  expect(await db.prepare("SELECT event_id,body,frozen_at,terminal_at FROM notification_event_groups WHERE id='digest-a'").first()).toEqual({ event_id: "evt_digest-a", body: null, frozen_at: now.toISOString(), terminal_at: now.toISOString() });
  await expect(db.prepare("UPDATE notification_event_groups SET body='{}' WHERE id='digest-a'").run()).rejects.toThrow();
  // 親配信の削除で所属・確保だけがcascadeし、部分削除を本文の短縮と誤認しない。
  await db.prepare("DELETE FROM notification_outbox").run();
  expect((await db.prepare("SELECT item_count FROM notification_event_groups").all()).results).toEqual([{ item_count: 1 }, { item_count: 1 }]);
  expect((await db.prepare("SELECT * FROM notification_event_group_items").all()).results).toEqual([]);
  expect((await db.prepare("SELECT * FROM notification_event_group_claims").all()).results).toEqual([]);
  await db.prepare("DELETE FROM households WHERE id='household-a'").run();
  expect((await db.prepare("SELECT * FROM notification_event_groups").all()).results).toEqual([]);
  expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
});
