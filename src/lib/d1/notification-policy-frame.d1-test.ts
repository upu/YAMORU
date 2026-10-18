import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, it } from "vitest";
import { applyAllMigrations } from "./test-support/migrations";
import { notificationCandidate, notificationPrincipal as principal, resetNotificationFixtures } from "./test-support/notifications";
import { householdAMember, householdBMember } from "./test-support/households";
import { createMaintenanceTask } from "./todos";
import { readHouseholdVersion } from "./conversation-read";
import { refreshAttention } from "./attention";
import { DEFAULT_SETTINGS } from "../../features/integration/notifications/contract";
import { saveNotificationSettings } from "./notification-settings";
import { enqueueNotificationPage } from "./notification-outbox";
import { evaluateNotificationPage, readNotificationPolicyFrame } from "./notification-policy";
const db = env.DB;
beforeAll(() => applyAllMigrations(db));
beforeEach(() => resetNotificationFixtures(db));
async function prepared() {
  const at = new Date();
  const settings = { ...DEFAULT_SETTINGS, enabled: true, connectionId: principal.connectionId, mode: "daily", digestTime: "00:00", quietEnabled: false };
  await saveNotificationSettings(db, householdAMember, settings, 0, at);
  const sources = [await notificationCandidate(db), await notificationCandidate(db)];
  return { at, settings, sources, ids: sources.map((s) => s.candidate.candidate_id), frame: await readNotificationPolicyFrame(db, principal, at) };
}
it("共通設定を読んだ後の変更を、後から読んだ候補stampで通さない", async () => {
  const { at, settings, ids, frame } = await prepared();
  await saveNotificationSettings(db, householdAMember, { ...settings, mode: "individual" }, 1, at);
  await expect(enqueueNotificationPage(db, principal, ids, at, frame)).rejects.toMatchObject({ code: "read_conflict" });
  expect((await db.prepare("SELECT * FROM notification_outbox").all()).results).toEqual([]);
});
it("最初の候補が解消して選択から消えても、同じ古い家庭snapshotで残りを保存しない", async () => {
  const { at, sources, ids, frame } = await prepared();
  await db.prepare("UPDATE task_occurrences SET status='completed' WHERE id=?").bind(sources[0].occurrenceId).run();
  await expect(enqueueNotificationPage(db, principal, ids, at, frame)).rejects.toMatchObject({ code: "read_conflict" });
  expect((await db.prepare("SELECT * FROM notification_outbox").all()).results).toEqual([]);
  expect(await enqueueNotificationPage(db, principal, ids, at)).toEqual(new Set([ids[1]]));
});
it("snapshot後のscope縮小とsession更新を、開始batchで拒否する", async () => {
  const { at, ids, frame } = await prepared();
  await db.prepare("UPDATE oauth_connections SET scopes='household.read'").run();
  await expect(enqueueNotificationPage(db, principal, ids, at, frame)).rejects.toMatchObject({ code: "read_conflict" });
  await db.prepare("UPDATE oauth_connections SET scopes='household.read notifications.manage events.subscribe'").run();
  await db.prepare("UPDATE users SET session_version=session_version+1 WHERE id=?").bind(principal.userId).run();
  await expect(enqueueNotificationPage(db, principal, ids, at, frame)).rejects.toMatchObject({ code: "read_conflict" });
  expect((await db.prepare("SELECT * FROM notification_outbox").all()).results).toEqual([]);
});
it("別の本人・家庭・clientのframeを流用せず、scope不足も拒否する", async () => {
  const { at, ids, frame } = await prepared();
  for (const owner of [{ ...principal, userId: "user-b" }, { ...principal, householdId: "household-b" }, { ...principal, clientId: "other-client" }]) {
    await expect(evaluateNotificationPage(db, owner, ids, at, frame)).rejects.toMatchObject({ code: "not_found" });
  }
  await expect(evaluateNotificationPage(db, { ...principal, scopes: ["household.read"] }, ids, at, frame)).rejects.toMatchObject({ code: "insufficient_scope" });
});
it("二件目まで準備したbatchが失敗したら、元対象のtrigger行も含めて全取消する", async () => {
  const { at, ids, frame } = await prepared();
  const broken = new Proxy(db, { get(target, property) {
    if (property === "batch") return (statements: D1PreparedStatement[]) => target.batch([...statements, target.prepare("INSERT INTO attention_guards(id,valid) VALUES('forced-page-rollback',0)")]);
    const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
  } });
  await expect(enqueueNotificationPage(broken, principal, ids, at, frame)).rejects.toMatchObject({ code: "read_conflict" });
  expect((await db.prepare("SELECT * FROM notification_outbox").all()).results).toEqual([]);
  expect((await db.prepare("SELECT * FROM notification_outbox_sources").all()).results).toEqual([]);
});
it("50件までの照合と他家庭IDの不可視性を保ち、51件は全体を拒否する", async () => {
  const { at, ids, frame } = await prepared();
  await createMaintenanceTask(db, householdBMember, { managedItemId: "item-b", title: "B private maintenance", firstDueAt: "2026-08-10T15:00:00.000Z", firstScheduledFor: "2026-08-01T15:00:00.000Z", recommendedStartOffset: 1, recommendedUntilOffset: 2 });
  await refreshAttention(db, "household-b", await readHouseholdVersion(db, "household-b"), at, "");
  const foreign = await db.prepare("SELECT id FROM attention_candidates WHERE household_id='household-b'").first<{ id: string }>(); if (!foreign) throw new Error("Missing foreign candidate");
  const page = [...ids, foreign.id, ...Array.from({ length: 47 }, (_, index) => `unavailable-${index}`)];
  expect((await evaluateNotificationPage(db, principal, page, at, frame)).get(foreign.id)?.candidate).toBeNull();
  expect(await enqueueNotificationPage(db, principal, page, at, frame)).toEqual(new Set(ids));
  const before = (await db.prepare("SELECT * FROM notification_outbox ORDER BY delivery_id").all()).results;
  await expect(enqueueNotificationPage(db, principal, [...page, "extra"], at, frame)).rejects.toMatchObject({ code: "invalid_input" });
  expect((await db.prepare("SELECT * FROM notification_outbox ORDER BY delivery_id").all()).results).toEqual(before);
});
