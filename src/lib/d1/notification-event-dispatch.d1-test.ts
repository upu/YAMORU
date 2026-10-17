import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import { applyAllMigrations } from "./test-support/migrations";
import { resetNotificationFixtures, notificationCandidate, notificationPrincipal as principal } from "./test-support/notifications";
import { householdAMember } from "./test-support/households";
import { DEFAULT_SETTINGS } from "../../features/integration/notifications/contract";
import { createEventSubscriptionService } from "../../features/integration/notifications/event-subscriptions";
import { saveNotificationSettings, setCandidateControl } from "./notification-settings";
import { enqueueNotification, leaseNotification, recoverNotificationLeases, reconcilePendingNotifications, beginNotificationSend } from "./notification-outbox";
import { freezeNotificationEvent, beginEventRecipient, finishEventRecipient, settleNotificationEvent } from "./notification-event-dispatch";
import { pruneNotificationOutbox } from "./notification-outbox-retention";
const db = env.DB;
const now = () => new Date();
const master = "fictional-master-secret-at-least-32-bytes";
const url = (n: number) => `https://receiver${n}.example.com/events`;
const input = (n: number, args = {}) => ({ name: "attention.ready", arguments: args, delivery: { mode: "webhook", url: url(n), secret: `whsec_${btoa("x".repeat(32))}` } });
const api = () => createEventSubscriptionService({ db, authorize: async () => principal, secret: master, providerId: "test",
  transport: { post: vi.fn(async (_url: string, request: { body: string }) => Response.json({ challenge: JSON.parse(request.body).challenge })) } });
beforeAll(() => applyAllMigrations(db));
beforeEach(() => resetNotificationFixtures(db));
async function prepared() {
  await saveNotificationSettings(db, householdAMember, { ...DEFAULT_SETTINGS, enabled: true, connectionId: principal.connectionId, mode: "individual", quietEnabled: false }, 0, now());
  const source = await notificationCandidate(db);
  await enqueueNotification(db, principal, source.candidate.candidate_id, now());
  const lease = await leaseNotification(db, principal, now());
  if (!lease) throw new Error("Missing lease");
  return { lease, ...source };
}
const recipients = async () => (await db.prepare("SELECT subscription_id,state,attempts FROM notification_event_recipients ORDER BY subscription_id").all()).results;
it("全ての一致する宛先を一度だけ固定し、受領済み宛先は別宛先の再試行に巻き込まない", async () => {
  const { lease } = await prepared();
  const service = api();
  const a = await service.subscribe(input(1));
  const b = await service.subscribe(input(2));
  await service.subscribe(input(3, { kinds: ["consumable"] }));
  const frozen = await freezeNotificationEvent(db, principal, lease, now());
  expect(frozen?.recipientIds.sort()).toEqual([a.id, b.id].sort());
  await service.subscribe(input(4));
  expect(await freezeNotificationEvent(db, principal, lease, now())).toEqual(frozen);
  const first = await beginEventRecipient(db, principal, lease, a.id, now());
  expect(first).toMatchObject({ eventId: frozen?.eventId, body: frozen?.body });
  if (!first) throw new Error("Missing attempt");
  await finishEventRecipient(db, principal, lease, first, { kind: "accepted" }, now());
  const second = await beginEventRecipient(db, principal, lease, b.id, now());
  if (!second) throw new Error("Missing attempt");
  await finishEventRecipient(db, principal, lease, second, { kind: "retry" }, now());
  expect(await settleNotificationEvent(db, principal, lease, now())).toMatchObject({ state: "retry_wait" });
  await db.prepare("UPDATE notification_outbox SET next_attempt_at='2000-01-01T00:00:00.000Z'").run();
  await db.prepare("UPDATE notification_event_recipients SET next_attempt_at='2000-01-01T00:00:00.000Z'").run();
  const retry = await leaseNotification(db, principal, now());
  if (!retry) throw new Error("Missing retry");
  expect(await beginEventRecipient(db, principal, retry, a.id, now())).toBeNull();
  const attempt = await beginEventRecipient(db, principal, retry, b.id, now());
  expect(attempt?.body).toBe(frozen?.body);
  if (!attempt) throw new Error("Missing attempt");
  await finishEventRecipient(db, principal, retry, attempt, { kind: "accepted" }, now());
  expect(await settleNotificationEvent(db, principal, retry, now())).toMatchObject({ state: "accepted" });
  expect(await recipients()).toEqual(expect.arrayContaining([{ subscription_id: a.id, state: "accepted", attempts: 1 }, { subscription_id: b.id, state: "accepted", attempts: 2 }]));
});
it("一宛先の中断をunknownとして残し、他の未送信宛先だけを回収する", async () => {
  const { lease } = await prepared();
  const service = api();
  const a = await service.subscribe(input(1)); const b = await service.subscribe(input(2));
  await freezeNotificationEvent(db, principal, lease, now());
  const interrupted = await beginEventRecipient(db, principal, lease, a.id, now());
  await db.prepare("UPDATE notification_outbox SET lease_expires_at='2000-01-01T00:00:00.000Z'").run();
  await recoverNotificationLeases(db, principal, now());
  expect(await db.prepare("SELECT * FROM notification_delivery_marks").first()).toBeNull();
  const next = await leaseNotification(db, principal, now());
  if (!next || !interrupted) throw new Error("Missing lease");
  await expect(finishEventRecipient(db, principal, lease, interrupted, { kind: "accepted" }, now())).rejects.toMatchObject({ code: "lease_lost" });
  expect(await beginEventRecipient(db, principal, next, a.id, now())).toBeNull();
  const attempt = await beginEventRecipient(db, principal, next, b.id, now());
  if (!attempt) throw new Error("Missing attempt");
  await finishEventRecipient(db, principal, next, attempt, { kind: "accepted" }, now());
  expect(await settleNotificationEvent(db, principal, next, now())).toMatchObject({ state: "unknown" });
  expect(await recipients()).toEqual(expect.arrayContaining([{ subscription_id: a.id, state: "unknown", attempts: 1 }, { subscription_id: b.id, state: "accepted", attempts: 1 }]));
});
it("各宛先の開始直前に家族の完了を確認し、受領済み結果は保ったまま未送信分を止める", async () => {
  const { lease, occurrenceId } = await prepared(); const service = api();
  const a = await service.subscribe(input(1)); const b = await service.subscribe(input(2));
  await freezeNotificationEvent(db, principal, lease, now());
  const attempt = await beginEventRecipient(db, principal, lease, a.id, now());
  if (!attempt) throw new Error("Missing attempt");
  await finishEventRecipient(db, principal, lease, attempt, { kind: "accepted" }, now());
  await db.prepare("UPDATE task_occurrences SET status='completed' WHERE id=?").bind(occurrenceId).run();
  expect(await beginEventRecipient(db, principal, lease, b.id, now())).toBeNull();
  expect(await settleNotificationEvent(db, principal, lease, now())).toMatchObject({ state: "accepted" });
  expect(await recipients()).toEqual(expect.arrayContaining([{ subscription_id: b.id, state: "cancelled", attempts: 0 }]));
});
it("鍵更新は送信でき、解除・再購読した同じIDへの古い通知は送れない", async () => {
  const { lease } = await prepared(); const service = api();
  const a = await service.subscribe(input(1)); const b = await service.subscribe(input(2));
  await freezeNotificationEvent(db, principal, lease, now());
  await service.subscribe({ ...input(1), delivery: { ...input(1).delivery, secret: `whsec_${btoa("y".repeat(32))}` } });
  expect(await beginEventRecipient(db, principal, lease, a.id, now())).not.toBeNull();
  await service.unsubscribe({ name: "attention.ready", delivery: { mode: "webhook", url: url(2) } });
  await service.subscribe(input(2));
  expect(await beginEventRecipient(db, principal, lease, b.id, now())).toBeNull();
});
it("スヌーズ中は回数を使わず、解除後もbody・IDを保つ", async () => {
  const { lease, candidate } = await prepared(); const a = await api().subscribe(input(1));
  const frozen = await freezeNotificationEvent(db, principal, lease, now());
  const until = new Date(Date.now() + 3_600_000).toISOString();
  await setCandidateControl(db, householdAMember, candidate.candidate_id, { muted: false, snoozedUntil: until }, now());
  expect(await beginEventRecipient(db, principal, lease, a.id, now())).toBeNull();
  expect(await settleNotificationEvent(db, principal, lease, now())).toMatchObject({ state: "retry_wait", nextAt: until });
  expect((await recipients())[0].attempts).toBe(0);
  await setCandidateControl(db, householdAMember, candidate.candidate_id, { muted: false, snoozedUntil: null }, now());
  await reconcilePendingNotifications(db, principal, now());
  // 定期照合はbackoffを短縮しない。保存bodyも書き換えない。
  expect(await db.prepare("SELECT body FROM notification_event_batches").first()).toEqual({ body: frozen?.body });
});
it("凍結済み配信を旧送信APIで開始して宛先結果を飛ばせない", async () => {
  const { lease } = await prepared(); await api().subscribe(input(1));
  await freezeNotificationEvent(db, principal, lease, now());
  await expect(beginNotificationSend(db, principal, lease, now())).rejects.toMatchObject({ code: "read_conflict" });
});
it("全宛先の受領を保存した後で止まっても、親をunknownへ落とさず回復する", async () => {
  const { lease } = await prepared(); const a = await api().subscribe(input(1));
  await freezeNotificationEvent(db, principal, lease, now());
  const attempt = await beginEventRecipient(db, principal, lease, a.id, now());
  if (!attempt) throw new Error("Missing attempt");
  await finishEventRecipient(db, principal, lease, attempt, { kind: "accepted" }, now());
  await db.prepare("UPDATE notification_outbox SET lease_expires_at='2000-01-01T00:00:00.000Z'").run();
  await recoverNotificationLeases(db, principal, now());
  expect(await db.prepare("SELECT state FROM notification_outbox").first()).toEqual({ state: "accepted" });
  expect(await leaseNotification(db, principal, now())).toBeNull();
});
it("一部の結果が不明のまま接続が解除されても、その証拠を取消しで上書きしない", async () => {
  const { lease } = await prepared(); const service = api();
  const a = await service.subscribe(input(1)); await service.subscribe(input(2));
  await freezeNotificationEvent(db, principal, lease, now());
  const attempt = await beginEventRecipient(db, principal, lease, a.id, now());
  if (!attempt) throw new Error("Missing attempt");
  await finishEventRecipient(db, principal, lease, attempt, { kind: "unknown" }, now());
  await settleNotificationEvent(db, principal, lease, now());
  await db.prepare("UPDATE oauth_connections SET revoked_at=?,revoked_reason='user_revoked'").bind(now().toISOString()).run();
  await reconcilePendingNotifications(db, principal, now());
  expect(await db.prepare("SELECT state FROM notification_outbox").first()).toEqual({ state: "unknown" });
  expect(await recipients()).toEqual(expect.arrayContaining([{ subscription_id: a.id, state: "unknown", attempts: 1 }]));
});
it.each(["household", "subscription"] as const)("開始batch直前の%s競合は全取消し、回数を増やさない", async (which) => {
  const { lease, occurrenceId } = await prepared(); const a = await api().subscribe(input(1));
  await freezeNotificationEvent(db, principal, lease, now());
  const racing = { prepare: (sql: string) => db.prepare(sql), batch: async (statements: D1PreparedStatement[]) => {
    if (which === "household") await db.prepare("UPDATE task_occurrences SET status='completed' WHERE id=?").bind(occurrenceId).run();
    else await api().unsubscribe({ name: "attention.ready", delivery: { mode: "webhook", url: url(1) } });
    return db.batch(statements);
  } } as unknown as D1Database;
  await expect(beginEventRecipient(racing, principal, lease, a.id, now())).rejects.toMatchObject({ code: "read_conflict" });
  expect((await recipients())[0]).toMatchObject({ state: "pending", attempts: 0 });
  expect(await db.prepare("SELECT state,attempts FROM notification_outbox").first()).toEqual({ state: "leased", attempts: 0 });
});
it("別家庭・本人・接続・client・scopeでは配信情報へ到達できない", async () => {
  const { lease } = await prepared(); const a = await api().subscribe(input(1));
  await freezeNotificationEvent(db, principal, lease, now());
  for (const changed of [{ householdId: "household-b" }, { userId: "user-b" }, { connectionId: "other" }, { clientId: "https://other.example.com" }, { scopes: ["household.read"] }]) {
    await expect(freezeNotificationEvent(db, { ...principal, ...changed }, lease, now())).rejects.toThrow();
    await expect(beginEventRecipient(db, { ...principal, ...changed }, lease, a.id, now())).rejects.toThrow();
  }
  expect((await recipients())[0].attempts).toBe(0);
});
it("同じ宛先を並列に開始しても一試行だけで、開始中には親を確定できない", async () => {
  const { lease } = await prepared(); const a = await api().subscribe(input(1));
  await freezeNotificationEvent(db, principal, lease, now());
  const results = await Promise.allSettled(Array.from({ length: 3 }, () => beginEventRecipient(db, principal, lease, a.id, now())));
  expect(results.filter((r) => r.status === "fulfilled" && r.value)).toHaveLength(1);
  expect((await recipients())[0]).toMatchObject({ state: "sending", attempts: 1 });
  await expect(settleNotificationEvent(db, principal, lease, now())).rejects.toMatchObject({ code: "read_conflict" });
});
it("試行上限は宛先ごとに送り出す前にも検査する", async () => {
  const { lease } = await prepared(); const service = api();
  const a = await service.subscribe(input(1)); const b = await service.subscribe(input(2));
  await freezeNotificationEvent(db, principal, lease, now());
  await db.prepare("UPDATE notification_event_recipients SET attempts=8 WHERE subscription_id=?").bind(a.id).run();
  await db.prepare("UPDATE notification_event_recipients SET attempts=1,first_sent_at='2000-01-01T00:00:00.000Z' WHERE subscription_id=?").bind(b.id).run();
  expect(await beginEventRecipient(db, principal, lease, a.id, now())).toBeNull();
  expect(await beginEventRecipient(db, principal, lease, b.id, now())).toBeNull();
  expect(await settleNotificationEvent(db, principal, lease, now())).toMatchObject({ state: "failed" });
});
it("購読の削除後も結果を保持し、90日後にbodyだけ消して再送防止を残す", async () => {
  const { lease } = await prepared(); const a = await api().subscribe(input(1));
  await freezeNotificationEvent(db, principal, lease, now());
  const attempt = await beginEventRecipient(db, principal, lease, a.id, now());
  if (!attempt) throw new Error("Missing attempt");
  await finishEventRecipient(db, principal, lease, attempt, { kind: "unknown" }, now());
  await settleNotificationEvent(db, principal, lease, now());
  await db.prepare("DELETE FROM notification_event_subscriptions").run();
  const before = await recipients();
  await pruneNotificationOutbox(db, new Date(Date.now() + 91 * 86_400_000));
  expect(await db.prepare("SELECT body FROM notification_event_batches").first()).toEqual({ body: null });
  expect(await recipients()).toEqual(before);
  expect(await db.prepare("SELECT state FROM notification_outbox").first()).toEqual({ state: "unknown" });
  await db.prepare("DELETE FROM oauth_connections WHERE id=?").bind(principal.connectionId).run();
  expect(await recipients()).toEqual([]);
  expect(await db.prepare("SELECT * FROM notification_event_batches").first()).toBeNull();
  expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
});
it("凍結直前に購読が増えた場合は不完全な集合を保存しない", async () => {
  const { lease } = await prepared(); await api().subscribe(input(1));
  const racing = { prepare: (sql: string) => db.prepare(sql), batch: async (statements: D1PreparedStatement[]) => {
    await api().subscribe(input(2));
    return db.batch(statements);
  } } as unknown as D1Database;
  await expect(freezeNotificationEvent(racing, principal, lease, now())).rejects.toMatchObject({ code: "read_conflict" });
  expect(await db.prepare("SELECT * FROM notification_event_batches").first()).toBeNull();
  expect(await recipients()).toEqual([]);
  expect((await freezeNotificationEvent(db, principal, lease, now()))?.recipientIds).toHaveLength(2);
});
it("結果保存が失敗しても同じ試行tokenで保存を再試行でき、外へ送り直す必要がない", async () => {
  const { lease } = await prepared(); const a = await api().subscribe(input(1));
  await freezeNotificationEvent(db, principal, lease, now());
  const attempt = await beginEventRecipient(db, principal, lease, a.id, now());
  if (!attempt) throw new Error("Missing attempt");
  const failing = { prepare: (sql: string) => db.prepare(sql), batch: (statements: D1PreparedStatement[]) => db.batch([
    ...statements, db.prepare("INSERT INTO attention_guards(id,valid) VALUES('forced-finish-rollback',0)"),
  ]) } as unknown as D1Database;
  await expect(finishEventRecipient(failing, principal, lease, attempt, { kind: "accepted" }, now())).rejects.toMatchObject({ code: "lease_lost" });
  expect((await recipients())[0]).toMatchObject({ state: "sending", attempts: 1 });
  await finishEventRecipient(db, principal, lease, attempt, { kind: "accepted" }, now());
  await expect(finishEventRecipient(db, principal, lease, attempt, { kind: "unknown" }, now())).rejects.toMatchObject({ code: "lease_lost" });
  expect(await settleNotificationEvent(db, principal, lease, now())).toMatchObject({ state: "accepted" });
});
it("非終端bodyは残し、期限切れbodyが多数でも一回100件まで消す", async () => {
  const { lease } = await prepared(); await api().subscribe(input(1));
  const frozen = await freezeNotificationEvent(db, principal, lease, now());
  const ids = JSON.stringify(Array.from({ length: 101 }, (_value, n) => `old-event-${n}`));
  await db.prepare(`INSERT INTO notification_outbox(delivery_id,household_id,user_id,connection_id,candidate_id,candidate_name,state,next_attempt_at,created_at,updated_at)
    SELECT j.value,o.household_id,o.user_id,o.connection_id,j.value,'','unknown',o.next_attempt_at,o.created_at,'2000-01-01T00:00:00.000Z'
    FROM notification_outbox o CROSS JOIN json_each(?1) j WHERE o.delivery_id=?2`).bind(ids, lease.deliveryId).run();
  await db.prepare(`INSERT INTO notification_event_batches(delivery_id,household_id,user_id,connection_id,event_id,body,frozen_at)
    SELECT o.delivery_id,o.household_id,o.user_id,o.connection_id,o.delivery_id,?1,o.created_at FROM notification_outbox o WHERE o.delivery_id IN (SELECT value FROM json_each(?2))`).bind(frozen?.body, ids).run();
  await pruneNotificationOutbox(db, now());
  expect(await db.prepare("SELECT count(*) AS n FROM notification_event_batches WHERE body IS NOT NULL").first()).toEqual({ n: 2 });
  expect(await db.prepare("SELECT body FROM notification_event_batches WHERE delivery_id=?").bind(lease.deliveryId).first()).toEqual({ body: frozen?.body });
  await pruneNotificationOutbox(db, now());
  expect(await db.prepare("SELECT count(*) AS n FROM notification_event_batches WHERE body IS NOT NULL").first()).toEqual({ n: 1 });
});
