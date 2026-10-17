import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, it } from "vitest";
import { applyAllMigrations } from "./test-support/migrations";
import { resetNotificationFixtures, notificationCandidate, notificationPrincipal as principal } from "./test-support/notifications";
import { householdAMember } from "./test-support/households";
import { saveNotificationSettings } from "./notification-settings";
import { DEFAULT_SETTINGS } from "../../features/integration/notifications/contract";
import { enqueueNotification, leaseNotification, beginNotificationSend, finishNotificationSend } from "./notification-outbox";
import { pruneNotificationOutbox } from "./notification-outbox-retention";
const db = env.DB;
beforeAll(() => applyAllMigrations(db));
beforeEach(() => resetNotificationFixtures(db));
async function queued() {
  const now = new Date();
  await saveNotificationSettings(db, householdAMember, { ...DEFAULT_SETTINGS, enabled: true, connectionId: principal.connectionId, mode: "individual", quietEnabled: false }, 0, now);
  const source = await notificationCandidate(db);
  const delivery = await enqueueNotification(db, principal, source.candidate.candidate_id, now);
  if (!delivery) throw new Error("Missing delivery");
  return { ...source, ...delivery };
}
async function delivered(kind: "accepted" | "unknown" | "failed") {
  const source = await queued();
  const lease = await leaseNotification(db, principal, new Date());
  if (!lease) throw new Error("Missing lease");
  await beginNotificationSend(db, principal, lease, new Date());
  await finishNotificationSend(db, principal, lease, { kind }, new Date());
  return source;
}
it("候補の解消と元のTodo削除後も、その通知が指した回を保持する", async () => {
  const source = await queued();
  const expected = { delivery_id: source.deliveryId, household_id: principal.householdId, user_id: principal.userId, connection_id: principal.connectionId,
    kind: "todo_occurrence", entity_id: source.occurrenceId, todo_rule_id: source.ruleId };
  expect(await db.prepare("SELECT * FROM notification_outbox_sources").first()).toMatchObject(expected);
  await db.prepare("UPDATE task_occurrences SET status='completed' WHERE id=?").bind(source.occurrenceId).run();
  await db.prepare("INSERT INTO task_occurrences(id,household_id,task_rule_id,status,scheduled_for,due_at) VALUES('next-occurrence','household-a',?,'pending','2026-11-01T00:00:00.000Z','2026-11-02T00:00:00.000Z')").bind(source.ruleId).run();
  expect((await db.prepare("SELECT * FROM attention_candidates").all()).results).toEqual([]);
  expect(await db.prepare("SELECT * FROM notification_outbox_sources").first()).toMatchObject(expected);
  await db.prepare("DELETE FROM task_rules WHERE id=?").bind(source.ruleId).run();
  expect(await db.prepare("SELECT * FROM notification_outbox_sources").first()).toMatchObject(expected);
});
it("別家庭の親へcontextを移せず、接続の物理削除ではcascadeする", async () => {
  await queued();
  await expect(db.prepare("UPDATE notification_outbox_sources SET household_id='household-b'").run()).rejects.toThrow();
  await db.prepare("DELETE FROM oauth_connections WHERE id=?").bind(principal.connectionId).run();
  expect((await db.prepare("SELECT * FROM notification_outbox_sources").all()).results).toEqual([]);
  expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
});
it("90日後の既知結果は詳細を削除しても、最小重複抑止記録を残す", async () => {
  await delivered("accepted");
  await pruneNotificationOutbox(db, new Date(Date.now() + 91 * 86_400_000));
  expect((await db.prepare("SELECT * FROM notification_outbox").all()).results).toEqual([]);
  expect((await db.prepare("SELECT * FROM notification_outbox_sources").all()).results).toEqual([]);
  expect((await db.prepare("SELECT * FROM notification_delivery_marks").all()).results).toHaveLength(1);
});
it.each(["unknown", "failed"] as const)("%sは名前とcontextを消しても、同じID・状態・時刻で再送を防ぐ", async (kind) => {
  const source = await delivered(kind);
  const before = await db.prepare("SELECT delivery_id,candidate_id,state,attempts,created_at,updated_at,first_sent_at FROM notification_outbox").first();
  await pruneNotificationOutbox(db, new Date(Date.now() + 91 * 86_400_000));
  expect(await db.prepare("SELECT delivery_id,candidate_id,state,attempts,created_at,updated_at,first_sent_at FROM notification_outbox").first()).toEqual(before);
  expect(await db.prepare("SELECT candidate_name FROM notification_outbox").first()).toEqual({ candidate_name: "" });
  expect((await db.prepare("SELECT * FROM notification_outbox_sources").all()).results).toEqual([]);
  await enqueueNotification(db, principal, source.candidate.candidate_id, new Date());
  expect((await db.prepare("SELECT * FROM notification_outbox").all()).results).toHaveLength(1);
  expect(await leaseNotification(db, principal, new Date())).toBeNull();
});
it("まだ送っていない候補のcontextと名前は保存し、将来の通知に備える", async () => {
  await queued();
  const before = await db.prepare("SELECT * FROM notification_outbox").first();
  await pruneNotificationOutbox(db, new Date(Date.now() + 91 * 86_400_000));
  expect(await db.prepare("SELECT * FROM notification_outbox").first()).toEqual(before);
  expect((await db.prepare("SELECT * FROM notification_outbox_sources").all()).results).toHaveLength(1);
});
it("保守の前に非終端へ変わった記録は、元対象の保持期限も解除する", async () => {
  await delivered("unknown");
  await db.prepare("UPDATE notification_outbox SET state='pending'").run();
  expect(await db.prepare("SELECT terminal_at FROM notification_outbox_sources").first()).toEqual({ terminal_at: null });
  await pruneNotificationOutbox(db, new Date(Date.now() + 91 * 86_400_000));
  expect((await db.prepare("SELECT * FROM notification_outbox_sources").all()).results).toHaveLength(1);
});
it("在庫のcontextはTodoの回へ読み替えず、消耗品の元IDを保持する", async () => {
  const source = await queued();
  await db.prepare("INSERT INTO consumables(id,household_id,name,stock_status) VALUES('stock-source','household-a','架空の洗剤','low')").run();
  const { createAttentionReader } = await import("../../features/integration/attention/service");
  const result = await createAttentionReader({ db, authorize: async () => principal, cursorSecret: "fictional-source-context-key-of-at-least-32-characters" }).attentionGet({});
  const stock = result.candidates.find((candidate) => candidate.kind === "consumable");
  if (!stock) throw new Error("Missing stock candidate");
  const delivery = await enqueueNotification(db, principal, stock.candidate_id, new Date());
  expect(delivery?.deliveryId).not.toBe(source.deliveryId);
  expect(await db.prepare("SELECT kind,entity_id,todo_rule_id FROM notification_outbox_sources WHERE delivery_id=?").bind(delivery?.deliveryId).first())
    .toEqual({ kind: "consumable", entity_id: "stock-source", todo_rule_id: null });
});
it("保持期限を過ぎた記録が多くても、一回の削除を100件に制限する", async () => {
  const source = await queued();
  const ids = Array.from({ length: 101 }, (_value, index) => `old-delivery-${String(index).padStart(3, "0")}`);
  await db.prepare(`INSERT INTO notification_outbox(delivery_id,household_id,user_id,connection_id,candidate_id,candidate_name,state,next_attempt_at,created_at,updated_at)
    SELECT j.value,o.household_id,o.user_id,o.connection_id,o.candidate_id,o.candidate_name,'accepted',o.next_attempt_at,o.created_at,'2000-01-01T00:00:00.000Z'
    FROM notification_outbox o CROSS JOIN json_each(?1) j WHERE o.delivery_id=?2`).bind(JSON.stringify(ids), source.deliveryId).run();
  await pruneNotificationOutbox(db, new Date());
  expect((await db.prepare("SELECT * FROM notification_outbox WHERE state='accepted'").all()).results).toHaveLength(1);
  expect((await db.prepare("SELECT * FROM notification_outbox_sources").all()).results).toHaveLength(2);
  await pruneNotificationOutbox(db, new Date());
  expect((await db.prepare("SELECT * FROM notification_outbox").all()).results).toHaveLength(1);
});
