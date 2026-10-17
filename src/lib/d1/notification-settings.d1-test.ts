import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, it } from "vitest";
import { applyAllMigrations } from "./test-support/migrations";
import { resetHouseholdFixtures, householdAMember, householdBMember, createHouseholdAMaintenanceTask } from "./test-support/households";
import { getNotificationSettings, saveNotificationSettings, setCandidateControl } from "./notification-settings";
import { evaluateNotification, recordDelivery, listDeliveries } from "./notification-deliveries";
import { DEFAULT_SETTINGS } from "../../features/integration/notifications/contract";
import { createAttentionReader } from "../../features/integration/attention/service";
import { registerTestClient, TEST_CLIENT_ID } from "./test-support/oauth";

const db = env.DB;
const now = new Date("2026-10-17T00:00:00Z");
const a = householdAMember;
const principal = { userId: a.userId, householdId: "household-a", clientId: TEST_CLIENT_ID, connectionId: "connection-a", scopes: ["household.read", "notifications.manage", "events.subscribe"] };
beforeAll(() => applyAllMigrations(db));
beforeEach(async () => {
  await resetHouseholdFixtures(db);
  await registerTestClient(db);
  await db.prepare(`INSERT INTO oauth_connections(id,household_id,user_id,client_id,client_name,scopes,resource,issuer,user_session_version,created_at,expires_at)
    VALUES('connection-a','household-a','user-a',?,'Assistant','household.read notifications.manage events.subscribe','https://yamoru.example.test/mcp','https://yamoru.example.test',0,'2026-10-01T00:00:00.000Z','2027-01-01T00:00:00.000Z')`).bind(TEST_CLIENT_ID).run();
});
async function candidate() {
  const task = await createHouseholdAMaintenanceTask(db);
  const reader = createAttentionReader({ db, authorize: async () => principal, now: () => now, cursorSecret: "notification-test-secret-with-32-bytes" });
  const response = await reader.attentionGet({});
  return { ...task, candidate: response.candidates[0] };
}
async function enable(patch = {}) {
  return saveNotificationSettings(db, a, { ...DEFAULT_SETTINGS, enabled: true, connectionId: "connection-a", mode: "individual", ...patch }, 0, now);
}
it("本人ごとの既定値と変更、古いrevisionと他人の通知先を拒否する", async () => {
  expect(await getNotificationSettings(db, a)).toMatchObject({ revision: 0, settings: DEFAULT_SETTINGS });
  await enable();
  expect(await getNotificationSettings(db, householdBMember)).toMatchObject({ revision: 0, settings: DEFAULT_SETTINGS });
  await expect(enable()).rejects.toThrow();
  await expect(saveNotificationSettings(db, householdBMember, { ...DEFAULT_SETTINGS, enabled: true, connectionId: "connection-a" }, 0, now)).rejects.toThrow();
  await expect(getNotificationSettings(db, null)).rejects.toThrow();
  await expect(getNotificationSettings(db, { userId: "user-outsider" })).rejects.toThrow();
});
it("スヌーズ・muteは家庭の期限や家族の設定に触れず解除できる", async () => {
  const { candidate: c, occurrenceId } = await candidate();
  await enable();
  const original = await db.prepare("SELECT * FROM task_occurrences WHERE id=?").bind(occurrenceId).first();
  await setCandidateControl(db, a, c.candidate_id, { muted: false, snoozedUntil: "2026-10-18T00:00:00.000Z" }, now);
  expect(await evaluateNotification(db, principal, c.candidate_id, now)).toMatchObject({ state: "deferred", reason: "snoozed", nextAt: "2026-10-18T00:00:00.000Z" });
  await expect(setCandidateControl(db, householdBMember, c.candidate_id, { muted: true, snoozedUntil: null }, now)).rejects.toThrow();
  await setCandidateControl(db, a, c.candidate_id, { muted: true, snoozedUntil: null }, now);
  expect(await evaluateNotification(db, principal, c.candidate_id, now)).toMatchObject({ state: "cancelled", reason: "muted" });
  await setCandidateControl(db, a, c.candidate_id, { muted: false, snoozedUntil: null }, now);
  expect(await evaluateNotification(db, principal, c.candidate_id, now)).toMatchObject({ state: "ready" });
  expect(await db.prepare("SELECT * FROM task_occurrences WHERE id=?").bind(occurrenceId).first()).toEqual(original);
});
it("直前の静かな時間変更が即時に効き、延期は通知済みにならない", async () => {
  const { candidate: c } = await candidate();
  await enable();
  expect((await evaluateNotification(db, principal, c.candidate_id, now)).state).toBe("ready");
  const current = await getNotificationSettings(db, a);
  await saveNotificationSettings(db, a, { ...current.settings, quietStart: "08:00", quietEnd: "10:00" }, current.revision, now);
  expect(await evaluateNotification(db, principal, c.candidate_id, now)).toMatchObject({ state: "deferred", nextAt: "2026-10-17T01:00:00.000Z" });
  const later = new Date("2026-10-17T01:00:00Z");
  expect((await evaluateNotification(db, principal, c.candidate_id, later)).state).toBe("ready");
  await recordDelivery(db, principal, { deliveryId: "delivery-1", candidateId: c.candidate_id, outcome: "accepted", reason: null }, later);
  expect((await evaluateNotification(db, principal, c.candidate_id, later)).reason).toBe("already_delivered");
});
it("配信受領と案内報告を既読にせず、同じIDを二回数えず、unknownを再送しない", async () => {
  const { candidate: c } = await candidate();
  await enable({ repeatHighHours: 24, repeatNormalHours: 24 });
  const input = { deliveryId: "delivery-1", candidateId: c.candidate_id, outcome: "accepted", reason: null };
  await recordDelivery(db, principal, input, now);
  await recordDelivery(db, principal, input, now);
  expect(await listDeliveries(db, a, {})).toMatchObject({ items: [{ outcome: "accepted" }] });
  await recordDelivery(db, principal, { ...input, outcome: "reported" }, now);
  expect((await listDeliveries(db, a, {})).items[0]).not.toHaveProperty("read_at");
  await recordDelivery(db, principal, { ...input, deliveryId: "delivery-2", outcome: "unknown" }, new Date("2026-10-18T00:00:00Z"));
  expect((await evaluateNotification(db, principal, c.candidate_id, new Date("2026-10-19T00:00:00Z"))).reason).toBe("delivery_unknown");
  expect((await listDeliveries(db, householdBMember, {})).items).toEqual([]);
});
it("接続解除と権限の縮小後は配信できない", async () => {
  const { candidate: c } = await candidate();
  await enable();
  await db.prepare("UPDATE oauth_connections SET scopes='household.read notifications.manage' WHERE id='connection-a'").run();
  expect((await evaluateNotification(db, principal, c.candidate_id, now)).reason).toBe("connection_unavailable");
  await db.prepare("UPDATE oauth_connections SET revoked_at=?,revoked_reason='user_revoked' WHERE id='connection-a'").bind(now.toISOString()).run();
  expect((await evaluateNotification(db, principal, c.candidate_id, now)).state).toBe("cancelled");
});
