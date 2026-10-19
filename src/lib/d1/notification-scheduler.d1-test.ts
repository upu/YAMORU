import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, it } from "vitest";
import { applyAllMigrations } from "./test-support/migrations";
import { resetNotificationFixtures, notificationCandidate, notificationPrincipal as principal } from "./test-support/notifications";
import { householdAMember } from "./test-support/households";
import { DEFAULT_SETTINGS } from "../../features/integration/notifications/contract";
import { saveNotificationSettings } from "./notification-settings";
import { drainStoppedNotificationSchedule, enqueueNotification, leaseNotification } from "./notification-outbox";
import { runNotificationScheduler } from "../../features/integration/notifications/scheduler";
import { claimNotificationSchedule, seedNotificationSchedule } from "./notification-scheduler";
import { parseAllowedClientIds } from "../../features/integration/oauth/config";
import { upsertOAuthClient } from "./oauth-clients";
const db = env.DB;
const now = new Date();
beforeAll(() => applyAllMigrations(db));
beforeEach(() => resetNotificationFixtures(db));
async function enabled() {
  await saveNotificationSettings(db, householdAMember, { ...DEFAULT_SETTINGS, enabled: true, connectionId: principal.connectionId, mode: "individual", quietEnabled: false }, 0, now);
  return notificationCandidate(db);
}
it("外部clientが無効な設定では走査を開始しない", async () => {
  await enabled();
  await runNotificationScheduler({ db, allowedClientIds: [], now: () => now });
  expect((await db.prepare("SELECT * FROM notification_outbox").all()).results).toEqual([]);
});
it.each([undefined, "", "https://additional.example.test/client.json"])("追加許可が%jでも標準許可のChatGPT接続を走査する", async (value) => {
  const clientId = "https://chatgpt.com/oauth/client.json";
  await upsertOAuthClient(db, { id: clientId, clientName: "ChatGPT", clientUri: null, redirectUris: ["https://chatgpt.com/callback"], metadataFetchedAt: now.toISOString() });
  await db.prepare("UPDATE oauth_connections SET client_id=? WHERE id=?").bind(clientId, principal.connectionId).run();
  await enabled();
  expect(await runNotificationScheduler({ db, allowedClientIds: parseAllowedClientIds(value), now: () => now })).toEqual({ processed: 1, failed: 0 });
  expect((await db.prepare("SELECT connection_id FROM notification_outbox").all()).results).toEqual([{ connection_id: principal.connectionId }]);
});
it("保存したcheckpointから大きな候補集合を続け、同じ候補を重複作成しない", async () => {
  await enabled();
  await db.batch([db.prepare("INSERT INTO consumables(id,household_id,name,stock_status) VALUES('s1','household-a','洗剤','low')"),
    db.prepare("INSERT INTO consumables(id,household_id,name,stock_status) VALUES('s2','household-a','石鹸','out')")]);
  let clock = now;
  for (let tick = 0; tick < 5; tick++) {
    await runNotificationScheduler({ db, allowedClientIds: [principal.clientId], now: () => clock, candidateLimit: 1 });
    clock = new Date(clock.getTime() + 300_001);
  }
  expect((await db.prepare("SELECT * FROM notification_outbox").all()).results).toHaveLength(3);
  expect((await db.prepare("SELECT * FROM notification_scheduler_progress").all()).results).toHaveLength(1);
});
it("定期照合で完了と接続失効を反映し、外部送信を開始しない", async () => {
  const { candidate, occurrenceId } = await enabled();
  await enqueueNotification(db, principal, candidate.candidate_id, now);
  await db.prepare("UPDATE task_occurrences SET status='completed' WHERE id=?").bind(occurrenceId).run();
  await runNotificationScheduler({ db, allowedClientIds: [principal.clientId], now: () => now });
  expect(await db.prepare("SELECT state FROM notification_outbox").first()).toEqual({ state: "suppressed" });
  await db.prepare("UPDATE oauth_connections SET revoked_at=?,revoked_reason='user_revoked' WHERE id=?").bind(now.toISOString(), principal.connectionId).run();
  await runNotificationScheduler({ db, allowedClientIds: [principal.clientId], now: () => new Date(now.getTime() + 300_001) });
  expect((await db.prepare("SELECT * FROM notification_outbox WHERE state='sending'").all()).results).toEqual([]);
});
it.each(["revoked", "expired", "session_changed", "membership_lost", "disabled", "muted", "client_disabled"] as const)("%sで未処理配信がない接続を、走査へ登録し続けない", async (reason) => {
  await enabled();
  await seedNotificationSchedule(db, [principal.clientId], now);
  if (reason === "revoked") await db.prepare("UPDATE oauth_connections SET revoked_at=?,revoked_reason='user_revoked'").bind(now.toISOString()).run();
  if (reason === "expired") await db.prepare("UPDATE oauth_connections SET expires_at=?").bind(new Date(now.getTime() - 1).toISOString()).run();
  if (reason === "session_changed") await db.prepare("UPDATE users SET session_version=session_version+1 WHERE id=?").bind(principal.userId).run();
  if (reason === "membership_lost") await db.prepare("DELETE FROM household_members WHERE user_id=? AND household_id=?").bind(principal.userId, principal.householdId).run();
  if (reason === "disabled") await db.prepare("UPDATE notification_settings SET settings=json_set(settings,'$.enabled',0)").run();
  if (reason === "muted") await db.prepare("UPDATE notification_settings SET settings=json_set(settings,'$.muted',1)").run();
  const allowedClientIds = reason === "client_disabled" ? [] : [principal.clientId];
  expect(await runNotificationScheduler({ db, allowedClientIds, now: () => now })).toEqual({ processed: 0, failed: 0 });
  expect((await db.prepare("SELECT * FROM notification_scheduler_progress").all()).results).toEqual([]);
});
it("解除した接続は未送信分を取り消してから走査を終了する", async () => {
  const { candidate } = await enabled();
  await enqueueNotification(db, principal, candidate.candidate_id, now);
  await db.prepare("UPDATE oauth_connections SET revoked_at=?,revoked_reason='user_revoked'").bind(now.toISOString()).run();
  await runNotificationScheduler({ db, allowedClientIds: [principal.clientId], now: () => now });
  expect(await db.prepare("SELECT state FROM notification_outbox").first()).toEqual({ state: "cancelled" });
  expect((await db.prepare("SELECT * FROM notification_scheduler_progress").all()).results).toEqual([]);
});
it.each(["household.read", "events.subscribe"] as const)("refreshで%sを外した接続も、未送信分の後処理を完了する", async (scope) => {
  const { candidate } = await enabled();
  await enqueueNotification(db, principal, candidate.candidate_id, now);
  await db.prepare("UPDATE oauth_connections SET scopes=?").bind(principal.scopes.filter((value) => value !== scope).join(" ")).run();
  expect(await runNotificationScheduler({ db, allowedClientIds: [principal.clientId], now: () => now })).toEqual({ processed: 1, failed: 0 });
  expect(await db.prepare("SELECT state FROM notification_outbox").first()).toEqual({ state: "cancelled" });
  expect((await db.prepare("SELECT * FROM notification_scheduler_progress").all()).results).toEqual([]);
});
it("通知の接続先を変更すると、前の接続の空の走査枠を使わない", async () => {
  await enabled();
  await seedNotificationSchedule(db, [principal.clientId], now);
  await db.prepare(`INSERT INTO oauth_connections(id,household_id,user_id,client_id,client_name,scopes,resource,issuer,user_session_version,created_at,expires_at)
    SELECT 'replacement',household_id,user_id,client_id,client_name,scopes,resource,issuer,user_session_version,created_at,expires_at FROM oauth_connections WHERE id=?`).bind(principal.connectionId).run();
  await saveNotificationSettings(db, householdAMember, { ...DEFAULT_SETTINGS, enabled: true, connectionId: "replacement", mode: "individual", quietEnabled: false }, 1, now);
  await runNotificationScheduler({ db, allowedClientIds: [principal.clientId], now: () => now, connectionLimit: 1 });
  expect((await db.prepare("SELECT connection_id FROM notification_scheduler_progress").all()).results).toEqual([{ connection_id: "replacement" }]);
  expect((await db.prepare("SELECT connection_id FROM notification_outbox").all()).results).toEqual([{ connection_id: "replacement" }]);
});
it("scopeを失った接続の後処理も、置換済みのCron leaseでは変更できない", async () => {
  const { candidate } = await enabled();
  await enqueueNotification(db, principal, candidate.candidate_id, now);
  await seedNotificationSchedule(db, [principal.clientId], now);
  const old = await claimNotificationSchedule(db, now, [principal.clientId]);
  if (!old) throw new Error("Missing schedule lease");
  await db.prepare("UPDATE oauth_connections SET scopes='notifications.manage'").run();
  await db.prepare("UPDATE notification_scheduler_progress SET lease_token='replacement-lease'").run();
  await expect(drainStoppedNotificationSchedule(db, { ...principal, scopes: ["notifications.manage"] }, old, now, "connection_unavailable"))
    .rejects.toMatchObject({ code: "lease_lost" });
  expect(await db.prepare("SELECT state FROM notification_outbox").first()).toEqual({ state: "pending" });
});
it("解除後も期限前の配信leaseは保持し、期限切れの回収を終えてから走査を終了する", async () => {
  const { candidate } = await enabled();
  await enqueueNotification(db, principal, candidate.candidate_id, now);
  expect(await leaseNotification(db, principal, now)).not.toBeNull();
  await db.prepare("UPDATE oauth_connections SET revoked_at=?,revoked_reason='user_revoked'").bind(now.toISOString()).run();
  await runNotificationScheduler({ db, allowedClientIds: [principal.clientId], now: () => now });
  expect((await db.prepare("SELECT * FROM notification_scheduler_progress").all()).results).toHaveLength(1);
  await db.prepare("UPDATE notification_outbox SET lease_expires_at='2000-01-01T00:00:00.000Z'").run();
  await runNotificationScheduler({ db, allowedClientIds: [principal.clientId], now: () => new Date(now.getTime() + 300_001) });
  expect(await db.prepare("SELECT state FROM notification_outbox").first()).toEqual({ state: "cancelled" });
  expect((await db.prepare("SELECT * FROM notification_scheduler_progress").all()).results).toEqual([]);
});
it("古い接続の保守が100件ずつでも、有効接続の走査枠を使い潰さない", async () => {
  await enabled();
  const ids = Array.from({ length: 105 }, (_value, index) => `old-${index}`);
  await db.prepare(`INSERT INTO oauth_connections(id,household_id,user_id,client_id,client_name,scopes,resource,issuer,user_session_version,created_at,expires_at,revoked_at,revoked_reason)
    SELECT j.value,c.household_id,c.user_id,c.client_id,c.client_name,c.scopes,c.resource,c.issuer,c.user_session_version,c.created_at,c.expires_at,?2,'user_revoked'
    FROM oauth_connections c CROSS JOIN json_each(?1) j WHERE c.id=?3`).bind(JSON.stringify(ids), now.toISOString(), principal.connectionId).run();
  await db.prepare(`INSERT INTO notification_scheduler_progress(connection_id,household_id,user_id,next_run_at)
    SELECT id,household_id,user_id,'2000-01-01T00:00:00.000Z' FROM oauth_connections WHERE revoked_at IS NOT NULL`).run();
  expect(await runNotificationScheduler({ db, allowedClientIds: [principal.clientId], now: () => now, connectionLimit: 1 })).toEqual({ processed: 1, failed: 0 });
  expect((await db.prepare("SELECT * FROM notification_outbox WHERE connection_id=?").bind(principal.connectionId).all()).results).toHaveLength(1);
});
