import { expect, seedOwnerHousehold, test } from "./support/fixtures";
import { registerTestClient, TEST_CLIENT_ID } from "../src/lib/d1/test-support/oauth";
import { saveNotificationSettings } from "../src/lib/d1/notification-settings";
import { DEFAULT_SETTINGS } from "../src/features/integration/notifications/contract";

test("ビルド済みWorkerのCronから候補を永続化し、解除後の未送信を取消す", async ({ db, request }) => {
  await seedOwnerHousehold(db);
  await registerTestClient(db);
  const now = new Date();
  await db.prepare(`INSERT INTO oauth_connections(id,household_id,user_id,client_id,client_name,scopes,resource,issuer,user_session_version,created_at,expires_at)
    SELECT 'cron-test','household-a','owner',?,'架空のCron検証','household.read events.subscribe','http://localhost:8787/mcp','http://localhost:8787',session_version,?,?
    FROM users WHERE id='owner'`).bind(TEST_CLIENT_ID, now.toISOString(), new Date(now.getTime() + 86_400_000).toISOString()).run();
  await saveNotificationSettings(db, { userId: "owner" }, { ...DEFAULT_SETTINGS, enabled: true, connectionId: "cron-test", mode: "individual", quietEnabled: false }, 0, now);
  await db.prepare("INSERT INTO consumables(id,household_id,name,stock_status) VALUES('cron-stock','household-a','架空の洗剤','low')").run();
  const firstTick = await request.get("/__scheduled");
  expect(firstTick.status()).toBe(200);
  expect(await firstTick.text()).toBe("Ran scheduled event");
  expect(await db.prepare("SELECT state,candidate_name FROM notification_outbox").first()).toEqual({ state: "pending", candidate_name: "架空の洗剤" });
  await db.prepare("UPDATE oauth_connections SET revoked_at=?,revoked_reason='user_revoked' WHERE id='cron-test'").bind(new Date().toISOString()).run();
  await db.prepare("UPDATE notification_scheduler_progress SET next_run_at='2000-01-01T00:00:00.000Z'").run();
  expect((await request.get("/__scheduled")).status()).toBe(200);
  expect(await db.prepare("SELECT state,reason FROM notification_outbox").first()).toEqual({ state: "cancelled", reason: "connection_unavailable" });
});
