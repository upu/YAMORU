import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { applyMigrationsThrough, applyMigrationsAfter } from "./test-support/migrations";
import { resetNotificationFixtures, notificationCandidate, notificationNow as now, notificationPrincipal as principal } from "./test-support/notifications";
import { householdAMember } from "./test-support/households";
import { saveNotificationSettings, setCandidateControl } from "./notification-settings";
import { recordDelivery, listDeliveries } from "./notification-deliveries";
import { DEFAULT_SETTINGS } from "../../features/integration/notifications/contract";
it("追加migrationは既存行・旧SQLを保ち、家庭FK・cascade・rollbackを守る", async () => {
  const db = env.DB;
  await applyMigrationsThrough(db, "0034_attention_candidates");
  await resetNotificationFixtures(db);
  const { candidate: c, occurrenceId } = await notificationCandidate(db);
  const before = await db.prepare("SELECT * FROM task_occurrences WHERE id=?").bind(occurrenceId).first();
  const candidateBefore = await db.prepare("SELECT * FROM attention_candidates WHERE id=?").bind(c.candidate_id).first();
  await applyMigrationsAfter(db, "0034_attention_candidates");
  expect(await db.prepare("SELECT * FROM task_occurrences WHERE id=?").bind(occurrenceId).first()).toEqual(before);
  expect(await db.prepare("SELECT * FROM attention_candidates WHERE id=?").bind(c.candidate_id).first())
    .toEqual({ ...candidateBefore, first_detected_at: candidateBefore.generated_at });
  // 旧Workerの更新SQLはそのまま使え、内容更新は区間の開始時刻を動かさない。
  await db.prepare("UPDATE attention_candidates SET generated_at=? WHERE id=?").bind("2026-10-17T01:00:00.000Z", c.candidate_id).run();
  expect(await db.prepare("SELECT first_detected_at FROM attention_candidates WHERE id=?").bind(c.candidate_id).first())
    .toEqual({ first_detected_at: candidateBefore.generated_at });
  await saveNotificationSettings(db, householdAMember, { ...DEFAULT_SETTINGS, enabled: true, connectionId: principal.connectionId }, 0, now);
  await setCandidateControl(db, householdAMember, c.candidate_id, { muted: true, snoozedUntil: null }, now);
  await recordDelivery(db, principal, { deliveryId: "migration", candidateId: c.candidate_id, outcome: "accepted", reason: null }, now);
  await expect(db.prepare("UPDATE notification_settings SET household_id='household-b'").run()).rejects.toThrow();
  await expect(db.prepare("UPDATE notification_controls SET household_id='household-b'").run()).rejects.toThrow();
  await expect(db.batch([db.prepare("UPDATE notification_settings SET revision=revision+1"), db.prepare("INSERT INTO attention_guards(id,valid) VALUES('rollback',0)")])).rejects.toThrow();
  expect(await db.prepare("SELECT revision FROM notification_settings").first()).toEqual({ revision: 1 });
  await db.prepare("UPDATE task_occurrences SET status='skipped' WHERE id=?").bind(occurrenceId).run();
  expect((await db.prepare("SELECT * FROM notification_controls").all()).results).toEqual([]);
  expect((await db.prepare("SELECT * FROM notification_delivery_marks").all()).results).toEqual([]);
  expect((await listDeliveries(db, householdAMember, {}, now)).items).toHaveLength(1);
  await db.prepare("DELETE FROM households WHERE id='household-a'").run();
  for (const table of ["notification_settings", "notification_controls", "notification_delivery_history", "notification_delivery_marks"]) {
    expect((await db.prepare(`SELECT * FROM ${table}`).all()).results).toEqual([]);
  }
  expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
});
