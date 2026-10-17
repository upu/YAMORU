import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, it } from "vitest";
import { applyAllMigrations } from "./test-support/migrations";
import { notificationNow as now, notificationPrincipal as principal, resetNotificationFixtures, notificationCandidate } from "./test-support/notifications";
import { saveNotificationSettings, setCandidateControl } from "./notification-settings";
import { recordDelivery, evaluateNotification, listDeliveries, pruneDeliveryHistory, deliveryRecordStatements } from "./notification-deliveries";
import { DEFAULT_SETTINGS } from "../../features/integration/notifications/contract";
import { createNotificationReader } from "../../features/integration/notifications/service";
import { createAttentionReader } from "../../features/integration/attention/service";
import { createHouseholdAMaintenanceTask } from "./test-support/households";
const db = env.DB;
const session = { userId: principal.userId };
beforeAll(() => applyAllMigrations(db));
beforeEach(() => resetNotificationFixtures(db));
async function enabled() {
  await saveNotificationSettings(db, session, { ...DEFAULT_SETTINGS, enabled: true, connectionId: principal.connectionId, mode: "individual", repeatNormalHours: 24, repeatHighHours: 48 }, 0, now);
  return notificationCandidate(db);
}
it("再通知は24時間以上・最大3回で、候補revision変更で回数をリセットしない", async () => {
  const { candidate: c } = await enabled();
  for (let count = 0; count < 4; count++) {
    const at = new Date(now.getTime() + count * 86_400_000);
    expect((await evaluateNotification(db, principal, c.candidate_id, at)).state).toBe("ready");
    await recordDelivery(db, principal, { deliveryId: `d-${String(count)}`, candidateId: c.candidate_id, outcome: "accepted", reason: null }, at);
    expect((await evaluateNotification(db, principal, c.candidate_id, at)).state).not.toBe("ready");
  }
  await db.prepare("UPDATE attention_candidates SET revision=revision+1 WHERE id=?").bind(c.candidate_id).run();
  expect((await evaluateNotification(db, principal, c.candidate_id, new Date("2026-10-22T00:00:00Z"))).reason).toBe("repeat_limit");
});
it("同じ家庭の別利用者の休止は干渉せず、権限不足は配信判定を使えない", async () => {
  const { candidate: c } = await enabled();
  await db.prepare("INSERT INTO household_members(household_id,user_id) VALUES('household-a','user-outsider')").run();
  await setCandidateControl(db, { userId: "user-outsider" }, c.candidate_id, { muted: true, snoozedUntil: null }, now);
  expect((await evaluateNotification(db, principal, c.candidate_id, now)).state).toBe("ready");
  await expect(evaluateNotification(db, { ...principal, scopes: ["household.read", "notifications.manage"] }, c.candidate_id, now)).rejects.toMatchObject({ code: "insufficient_scope" });
});
it("一時延期を同じ配信IDで再開でき、詳細削除後も重複を抑止する", async () => {
  const { candidate: c } = await enabled();
  const input = { deliveryId: "same", candidateId: c.candidate_id, outcome: "deferred", reason: "snoozed" };
  await recordDelivery(db, principal, input, now);
  expect((await evaluateNotification(db, principal, c.candidate_id, now)).state).toBe("ready");
  await recordDelivery(db, principal, { ...input, outcome: "unknown", reason: null }, now);
  await pruneDeliveryHistory(db, new Date("2027-02-01T00:00:00Z"));
  await recordDelivery(db, principal, { ...input, outcome: "unknown", reason: null }, now);
  expect((await listDeliveries(db, session, {}, now)).items).toEqual([]);
  expect((await evaluateNotification(db, principal, c.candidate_id, new Date("2026-10-18T00:00:00Z"))).reason).toBe("delivery_unknown");
});
it("読み取りは本人・接続・scopeで束縛したcursorを返し、解除後は読めない", async () => {
  const { candidate: c } = await enabled();
  for (const id of ["one", "two"]) await recordDelivery(db, principal, { deliveryId: id, candidateId: c.candidate_id, outcome: "failed", reason: "connection_unavailable" }, now);
  const deps = { db, now: () => now, cursorSecret: "notification-test-secret-with-32-bytes" };
  const api = createNotificationReader({ ...deps, authorize: async () => principal });
  const first = await api.deliveryList({ limit: 1 });
  expect(first.items).toHaveLength(1);
  const second = await api.deliveryList({ limit: 1, cursor: first.next_cursor });
  expect(second.items[0].delivery_id).not.toBe(first.items[0].delivery_id);
  expect(first.items[0]).not.toHaveProperty("candidateName");
  expect((await api.notificationSettingsGet()).settings).toMatchObject({ connection_id: "connection-a", time_zone: "Asia/Tokyo", repeat_policy: { normal_hours: 24 } });
  await expect(api.deliveryList({ limit: 2, cursor: first.next_cursor })).rejects.toMatchObject({ code: "invalid_cursor" });
  const denied = createNotificationReader({ ...deps, authorize: async () => ({ ...principal, scopes: ["household.read"] }) });
  await expect(denied.notificationSettingsGet()).rejects.toMatchObject({ code: "insufficient_scope" });
  await db.prepare("UPDATE oauth_connections SET revoked_at=?,revoked_reason='user_revoked' WHERE id=?").bind(now.toISOString(), principal.connectionId).run();
  await expect(api.deliveryList()).rejects.toThrow();
});
it("日次まとめを過ぎた初回検出・内容更新でも既に期限を迎えた候補を翌日へ送らない", async () => {
  await saveNotificationSettings(db, session, { ...DEFAULT_SETTINGS, enabled: true, connectionId: principal.connectionId }, 0, now);
  const { occurrenceId } = await createHouseholdAMaintenanceTask(db);
  const ten = new Date("2026-10-17T01:00:00Z");
  const reader = createAttentionReader({ db, authorize: async () => principal, now: () => ten, cursorSecret: "notification-test-secret-with-32-bytes" });
  const first = (await reader.attentionGet({})).candidates[0];
  expect((await evaluateNotification(db, principal, first.candidate_id, ten)).state).toBe("ready");
  await db.prepare("UPDATE task_occurrences SET rule_snapshot=json_set(rule_snapshot,'$.title','更新後') WHERE id=?").bind(occurrenceId).run();
  await reader.attentionGet({});
  expect((await evaluateNotification(db, principal, first.candidate_id, ten)).state).toBe("ready");
});
it("在庫候補の名前更新でも初回検出時刻を保ち、解消後の再発は新しい区間になる", async () => {
  await saveNotificationSettings(db, session, { ...DEFAULT_SETTINGS, enabled: true, connectionId: principal.connectionId }, 0, now);
  await db.prepare("INSERT INTO consumables(id,household_id,name,stock_status) VALUES('stock','household-a','洗剤','low')").run();
  let clock = new Date("2026-10-16T23:00:00Z");
  const reader = createAttentionReader({ db, authorize: async () => principal, now: () => clock, cursorSecret: "notification-test-secret-with-32-bytes" });
  const first = (await reader.attentionGet({})).candidates[0];
  clock = new Date("2026-10-17T01:00:00Z");
  await db.prepare("UPDATE consumables SET name='新しい洗剤' WHERE id='stock'").run();
  await reader.attentionGet({});
  expect((await evaluateNotification(db, principal, first.candidate_id, clock)).state).toBe("ready");
  expect(await db.prepare("SELECT generated_at,first_detected_at FROM attention_candidates WHERE id=?").bind(first.candidate_id).first())
    .toEqual({ generated_at: clock.toISOString(), first_detected_at: "2026-10-16T23:00:00.000Z" });
  await db.prepare("UPDATE consumables SET stock_status='available' WHERE id='stock'").run();
  await db.prepare("UPDATE consumables SET stock_status='low' WHERE id='stock'").run();
  const next = (await reader.attentionGet({})).candidates[0];
  expect(next.candidate_id).not.toBe(first.candidate_id);
  expect(await evaluateNotification(db, principal, next.candidate_id, clock)).toMatchObject({ state: "deferred", nextAt: "2026-10-18T00:00:00.000Z" });
});
it("高い優先度の再通知は本人が選んだ48時間を守り、不明結果の上書きを原子的に拒否する", async () => {
  const { candidate: c, occurrenceId } = await enabled();
  await db.prepare("UPDATE task_occurrences SET must_complete_by='2026-10-17' WHERE id=?").bind(occurrenceId).run();
  const input = { deliveryId: "high", candidateId: c.candidate_id, outcome: "accepted", reason: null };
  await recordDelivery(db, principal, input, now);
  expect(await evaluateNotification(db, principal, c.candidate_id, new Date("2026-10-18T00:00:00Z"))).toMatchObject({ state: "deferred", nextAt: "2026-10-19T00:00:00.000Z" });
  const unknown = { ...input, deliveryId: "uncertain", outcome: "unknown" };
  await recordDelivery(db, principal, unknown, now);
  await expect(db.batch(deliveryRecordStatements(db, principal, { ...unknown, outcome: "accepted" }, "name", now))).rejects.toThrow();
  expect((await listDeliveries(db, session, {}, now)).items[0].outcome).toBe("unknown");
  expect((await db.prepare("SELECT * FROM attention_guards").all()).results).toEqual([]);
});
