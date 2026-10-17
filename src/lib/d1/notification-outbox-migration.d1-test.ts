import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { applyMigrationsThrough, applyMigrationsAfter } from "./test-support/migrations";
import { resetNotificationFixtures, notificationCandidate, notificationPrincipal as principal } from "./test-support/notifications";
import { householdAMember, createHouseholdAMaintenanceTask } from "./test-support/households";
import { saveNotificationSettings } from "./notification-settings";
import { DEFAULT_SETTINGS } from "../../features/integration/notifications/contract";
import { enqueueNotification } from "./notification-outbox";
import { seedNotificationSchedule } from "./notification-scheduler";

it("0039から追加しても既存行と旧WorkerのSQLを保ち、本人FK・状態制約・cascadeを守る", async () => {
  const db = env.DB;
  const now = new Date();
  await applyMigrationsThrough(db, "0039_integration_mcp_limits");
  await resetNotificationFixtures(db);
  const { candidate, occurrenceId } = await notificationCandidate(db);
  const before = await db.prepare("SELECT * FROM task_occurrences WHERE id=?").bind(occurrenceId).first();
  const connection = await db.prepare("SELECT * FROM oauth_connections WHERE id=?").bind(principal.connectionId).first();
  await applyMigrationsAfter(db, "0039_integration_mcp_limits");
  expect(await db.prepare("SELECT * FROM task_occurrences WHERE id=?").bind(occurrenceId).first()).toEqual(before);
  expect(await db.prepare("SELECT * FROM oauth_connections WHERE id=?").bind(principal.connectionId).first()).toEqual(connection);
  await createHouseholdAMaintenanceTask(db);
  await saveNotificationSettings(db, householdAMember, { ...DEFAULT_SETTINGS, enabled: true, connectionId: principal.connectionId, mode: "individual", quietEnabled: false }, 0, now);
  await enqueueNotification(db, principal, candidate.candidate_id, now);
  await seedNotificationSchedule(db, [principal.clientId], now);
  await expect(db.prepare("UPDATE notification_outbox SET household_id='household-b'").run()).rejects.toThrow();
  await expect(db.prepare("UPDATE notification_outbox SET state='leased'").run()).rejects.toThrow();
  await expect(db.prepare("UPDATE notification_scheduler_progress SET user_id='user-outsider'").run()).rejects.toThrow();
  // 候補の解消は送信証拠を消さない。次の処理が最新状態を判定する。
  await db.prepare("UPDATE task_occurrences SET status='skipped' WHERE id=?").bind(occurrenceId).run();
  expect((await db.prepare("SELECT * FROM attention_candidates WHERE id=?").bind(candidate.candidate_id).all()).results).toEqual([]);
  expect((await db.prepare("SELECT * FROM notification_outbox").all()).results).toHaveLength(1);
  await db.prepare("DELETE FROM households WHERE id='household-a'").run();
  expect((await db.prepare("SELECT * FROM notification_outbox").all()).results).toEqual([]);
  expect((await db.prepare("SELECT * FROM notification_scheduler_progress").all()).results).toEqual([]);
  expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
});
