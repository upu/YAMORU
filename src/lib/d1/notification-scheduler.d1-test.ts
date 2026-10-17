import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, it } from "vitest";
import { applyAllMigrations } from "./test-support/migrations";
import { resetNotificationFixtures, notificationCandidate, notificationPrincipal as principal } from "./test-support/notifications";
import { householdAMember } from "./test-support/households";
import { DEFAULT_SETTINGS } from "../../features/integration/notifications/contract";
import { saveNotificationSettings } from "./notification-settings";
import { enqueueNotification } from "./notification-outbox";
import { runNotificationScheduler } from "../../features/integration/notifications/scheduler";
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
