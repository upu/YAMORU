import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import { applyAllMigrations } from "./test-support/migrations";
import { notificationCandidate, notificationPrincipal as principal, resetNotificationFixtures } from "./test-support/notifications";
import { householdAMember } from "./test-support/households";
import { DEFAULT_SETTINGS } from "../../features/integration/notifications/contract";
import { createEventSubscriptionService } from "../../features/integration/notifications/event-subscriptions";
import { saveNotificationSettings, setCandidateControl } from "./notification-settings";
import { enqueueNotification, leaseNotification, recoverNotificationLeases, type NotificationLease } from "./notification-outbox";
import { beginEventRecipient, freezeNotificationEvent } from "./notification-event-dispatch";
import { beginDailyNotificationGroup, finishDailyNotificationGroup, freezeDailyNotificationGroup, recoverNotificationEventGroups } from "./notification-event-groups";
import { deliverFrozenDailyNotificationEvents } from "../../features/integration/notifications/event-job";
import { attentionEventPayloadSchema } from "../../features/integration/mcp/server-events";
import { pruneNotificationOutbox } from "./notification-outbox-retention";
const db = env.DB;
const now = () => new Date();
beforeAll(() => applyAllMigrations(db));
beforeEach(() => resetNotificationFixtures(db));
async function prepared(count = 2) {
  await saveNotificationSettings(db, householdAMember, { ...DEFAULT_SETTINGS, enabled: true, connectionId: principal.connectionId, mode: "daily", digestTime: "00:00", quietEnabled: false }, 0, now());
  const sources = [];
  for (let i = 0; i < count; i++) sources.push(await notificationCandidate(db));
  const api = createEventSubscriptionService({ db, authorize: async () => principal, secret: "fictional-digest-secret-at-least-32-bytes", providerId: "test",
    transport: { post: async (_url, request) => Response.json(JSON.parse(request.body) as unknown) } });
  const input = (path: string, args = {}) => ({ name: "attention.ready", arguments: args, delivery: { mode: "webhook", url: `https://receiver.example.com/${path}`, secret: `whsec_${btoa("x".repeat(32))}` } });
  const all = await api.subscribe(input("all"));
  const filtered = await api.subscribe(input("filtered", { todo_rule_ids: [sources[0].ruleId] }));
  for (const source of sources) await enqueueNotification(db, principal, source.candidate.candidate_id, now());
  const leases: NotificationLease[] = [];
  for (let i = 0; i < count; i++) {
    const lease = await leaseNotification(db, principal, now());
    if (!lease) throw new Error("Missing lease");
    await freezeNotificationEvent(db, principal, lease, now()); leases.push(lease);
  }
  return { leases, sources, all, filtered, api, input };
}
async function groupFor(leases: NotificationLease[], subscriptionId: string) {
  const group = await freezeDailyNotificationGroup(db, principal, leases, subscriptionId, now());
  if (!group) throw new Error("Missing group");
  return group;
}
const rows = async () => (await db.prepare("SELECT delivery_id,subscription_id,state,attempts,first_sent_at,next_attempt_at FROM notification_event_recipients ORDER BY delivery_id,subscription_id").all()).results;
it("二件を一つの固定本文にまとめ、filterの異なる宛先は別本文・別IDにする", async () => {
  const { leases, sources, all, filtered } = await prepared();
  const group = await groupFor(leases, all.id); const other = await groupFor(leases, filtered.id);
  expect(JSON.parse(group.body).data).toMatchObject({ notification_mode: "daily", group_id: group.id, candidate_ids: expect.arrayContaining(sources.map((s) => s.candidate.candidate_id)) });
  expect(JSON.parse(group.body).data.items).toHaveLength(2);
  expect(attentionEventPayloadSchema.safeParse(JSON.parse(group.body).data).success).toBe(true);
  expect(JSON.parse(other.body).data.items).toEqual([expect.objectContaining({ candidate_id: sources[0].candidate.candidate_id, source: { kind: "todo_occurrence", entity_id: sources[0].occurrenceId, todo_rule_id: sources[0].ruleId } })]);
  expect(other.eventId).not.toBe(group.eventId);
  expect(await freezeDailyNotificationGroup(db, principal, leases, all.id, now())).toBeNull();
  expect(await beginEventRecipient(db, principal, leases[0], all.id, now())).toBeNull();
  expect((await rows()).every((row) => row.attempts === 0)).toBe(true);
});
it("全件を同じtokenで開始・保存し、再試行は同じID・本文と各件の回数を保つ", async () => {
  const { leases, all } = await prepared(); const group = await groupFor(leases, all.id);
  const attempt = await beginDailyNotificationGroup(db, principal, group.id, leases, now());
  if (!attempt) throw new Error("Missing attempt");
  expect((await db.prepare("SELECT DISTINCT attempt_token FROM notification_event_recipients WHERE subscription_id=?").bind(all.id).all()).results).toEqual([{ attempt_token: attempt.token }]);
  expect(await finishDailyNotificationGroup(db, principal, group.id, leases, attempt, { kind: "retry" }, now())).toMatchObject({ state: "retry_wait" });
  expect(await beginDailyNotificationGroup(db, principal, group.id, leases, now())).toBeNull();
  const later = new Date(Date.now() + 60_000);
  const retry = await beginDailyNotificationGroup(db, principal, group.id, leases, later);
  expect(retry).toMatchObject({ eventId: group.eventId, body: group.body });
  if (!retry) throw new Error("Missing retry");
  await expect(finishDailyNotificationGroup(db, principal, group.id, leases, attempt, { kind: "accepted" }, later)).rejects.toMatchObject({ code: "lease_lost" });
  await finishDailyNotificationGroup(db, principal, group.id, leases, retry, { kind: "accepted" }, later);
  expect((await rows()).filter((r) => r.subscription_id === all.id)).toEqual(expect.arrayContaining(leases.map((l) => expect.objectContaining({ delivery_id: l.deliveryId, state: "accepted", attempts: 2 }))));
  expect(await beginDailyNotificationGroup(db, principal, group.id, leases, later)).toBeNull();
});
it("送信直前の家族の完了で本文全体を取りやめ、有効な未送信分だけを新しくまとめる", async () => {
  const { leases, sources, all } = await prepared(); const group = await groupFor(leases, all.id);
  await db.prepare("UPDATE task_occurrences SET status='completed' WHERE id=?").bind(sources[0].occurrenceId).run();
  expect(await beginDailyNotificationGroup(db, principal, group.id, leases, now())).toBeNull();
  expect(await db.prepare("SELECT state,body FROM notification_event_groups WHERE id=?").bind(group.id).first()).toEqual({ state: "cancelled", body: group.body });
  expect((await db.prepare("SELECT * FROM notification_event_group_claims").all()).results).toEqual([]);
  const regrouped = await groupFor(leases, all.id);
  expect(regrouped.eventId).not.toBe(group.eventId);
  expect(JSON.parse(regrouped.body).data.items).toEqual([expect.objectContaining({ candidate_id: sources[1].candidate.candidate_id })]);
  expect((await rows()).filter((r) => r.subscription_id === all.id).map((r) => r.attempts)).toEqual([0, 0]);
});
it("スヌーズと購読世代の変更で、古い本文を送らない", async () => {
  const { leases, sources, all, api, input } = await prepared(); const group = await groupFor(leases, all.id);
  await setCandidateControl(db, householdAMember, sources[0].candidate.candidate_id, { muted: false, snoozedUntil: new Date(Date.now() + 3_600_000).toISOString() }, now());
  expect(await beginDailyNotificationGroup(db, principal, group.id, leases, now())).toBeNull();
  const second = await groupFor(leases, all.id);
  await api.unsubscribe({ name: "attention.ready", delivery: { mode: "webhook", url: "https://receiver.example.com/all" } }); await api.subscribe(input("all"));
  expect(await beginDailyNotificationGroup(db, principal, second.id, leases, now())).toBeNull();
  expect((await rows()).every((r) => r.attempts === 0)).toBe(true);
});
it("一件のlease喪失と保存中の制約違反で、全件の開始・結果を部分保存しない", async () => {
  const { leases, all } = await prepared(); const group = await groupFor(leases, all.id);
  await expect(beginDailyNotificationGroup(db, principal, group.id, [{ ...leases[0], leaseToken: "wrong" }, leases[1]], now())).rejects.toMatchObject({ code: "lease_lost" });
  expect((await rows()).every((r) => r.attempts === 0)).toBe(true);
  const attempt = await beginDailyNotificationGroup(db, principal, group.id, leases, now()); if (!attempt) throw new Error("Missing attempt");
  const before = await rows();
  const broken = new Proxy(db, { get(target, property) {
    if (property === "batch") return (statements: D1PreparedStatement[]) => target.batch([...statements, target.prepare("INSERT INTO attention_guards(id,valid) VALUES('forced-group-rollback',0)")]);
    const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
  } });
  await expect(finishDailyNotificationGroup(broken, principal, group.id, leases, attempt, { kind: "accepted" }, now())).rejects.toMatchObject({ code: "lease_lost" });
  expect(await rows()).toEqual(before);
  await finishDailyNotificationGroup(db, principal, group.id, leases, attempt, { kind: "accepted" }, now());
});
it("開始後の中断は全件をunknownへ回復し、他宛先の未送信分と結果を分ける", async () => {
  const { leases, all } = await prepared(); const group = await groupFor(leases, all.id);
  const attempt = await beginDailyNotificationGroup(db, principal, group.id, leases, now()); if (!attempt) throw new Error("Missing attempt");
  await db.prepare("UPDATE notification_event_groups SET attempt_expires_at='2000-01-01T00:00:00.000Z'").run();
  await recoverNotificationEventGroups(db, principal, now());
  await expect(finishDailyNotificationGroup(db, principal, group.id, leases, attempt, { kind: "accepted" }, now())).rejects.toMatchObject({ code: "lease_lost" });
  expect((await rows()).filter((r) => r.subscription_id === all.id).map((r) => r.state)).toEqual(["unknown", "unknown"]);
  await db.prepare("UPDATE notification_outbox SET lease_expires_at='2000-01-01T00:00:00.000Z'").run();
  await recoverNotificationLeases(db, principal, now());
  expect(await freezeDailyNotificationGroup(db, principal, [], all.id, now())).toBeNull();
  expect((await db.prepare("SELECT state FROM notification_event_recipients WHERE subscription_id<>?").bind(all.id).all()).results).toEqual([{ state: "pending" }]);
});
it("同時の凍結で同じrecipientを二重にまとめない", async () => {
  const { leases, all } = await prepared();
  const results = await Promise.allSettled([freezeDailyNotificationGroup(db, principal, leases, all.id, now()), freezeDailyNotificationGroup(db, principal, leases, all.id, now())]);
  const created = results.filter((r) => r.status === "fulfilled" && r.value !== null);
  expect(created).toHaveLength(1);
  for (const result of results) if (result.status === "rejected") expect(result.reason).toMatchObject({ code: "read_conflict" });
  expect((await db.prepare("SELECT * FROM notification_event_groups").all()).results).toHaveLength(1);
  expect((await db.prepare("SELECT * FROM notification_event_group_claims").all()).results).toHaveLength(2);
});
it("まとめ一通につき一度だけ署名付きPOSTし、宛先ごとの全件結果を保存する", async () => {
  const { leases, all, filtered } = await prepared();
  const groups = [await groupFor(leases, all.id), await groupFor(leases, filtered.id)];
  const post = vi.fn(async () => new Response(null, { status: 204 }));
  const result = await deliverFrozenDailyNotificationEvents({ db, principal, secret: "fictional-digest-secret-at-least-32-bytes", providerId: "test", transport: { post }, now }, leases, groups.map((g) => g.id));
  expect(result.started).toBe(2); expect(result.outcomes.map((r) => r.state)).toEqual(["accepted", "accepted"]);
  expect(post).toHaveBeenCalledTimes(2);
  for (const group of groups) expect(post).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ body: group.body, headers: expect.objectContaining({ "webhook-id": group.eventId, "webhook-signature": expect.stringContaining("v1,") }) }));
  expect((await rows()).map((r) => r.state)).toEqual(["accepted", "accepted", "accepted"]);
});
it("POST後の保存だけを三度再試行し、同じ本文を送り直さない", async () => {
  const { leases, all } = await prepared(); const group = await groupFor(leases, all.id);
  const post = vi.fn(async () => new Response(null, { status: 204 })); let failures = 0;
  const broken = new Proxy(db, { get(target, property) {
    if (property === "batch") return (statements: D1PreparedStatement[]) => {
      if (post.mock.calls.length) { failures++; return Promise.reject(new Error("fictional result storage failure")); }
      return target.batch(statements);
    };
    const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
  } });
  await expect(deliverFrozenDailyNotificationEvents({ db: broken, principal, secret: "fictional-digest-secret-at-least-32-bytes", providerId: "test", transport: { post }, now }, leases, [group.id])).rejects.toThrow("notification_event_storage_unavailable");
  expect(post).toHaveBeenCalledTimes(1); expect(failures).toBe(3);
  expect((await rows()).filter((r) => r.subscription_id === all.id).map((r) => r.state)).toEqual(["sending", "sending"]);
});
it("通知方式の変更後は日次本文を個別として送らない", async () => {
  const { leases, all } = await prepared(); const group = await groupFor(leases, all.id);
  await saveNotificationSettings(db, householdAMember, { ...DEFAULT_SETTINGS, enabled: true, connectionId: principal.connectionId, mode: "individual", quietEnabled: false }, 1, now());
  expect(await beginDailyNotificationGroup(db, principal, group.id, leases, now())).toBeNull();
  expect((await rows()).filter((r) => r.subscription_id === all.id).map((r) => r.state)).toEqual(["cancelled", "cancelled"]);
  expect(await db.prepare("SELECT body FROM notification_event_groups WHERE id=?").bind(group.id).first()).toEqual({ body: group.body });
});
it("親の物理削除で所属が減っても、古い本文の残りだけを送らない", async () => {
  const { leases, all } = await prepared(); const group = await groupFor(leases, all.id);
  await db.prepare("DELETE FROM notification_outbox WHERE delivery_id=?").bind(leases[0].deliveryId).run();
  expect(await beginDailyNotificationGroup(db, principal, group.id, leases, now())).toBeNull();
  expect(await db.prepare("SELECT state,body,item_count FROM notification_event_groups WHERE id=?").bind(group.id).first()).toEqual({ state: "cancelled", body: group.body, item_count: 2 });
  expect((await rows()).every((r) => r.attempts === 0)).toBe(true);
});
it("上限の異なる宛先結果を再編成しても、回数・初回時刻・backoffをリセットしない", async () => {
  const { leases, all } = await prepared();
  await db.prepare("UPDATE notification_event_recipients SET attempts=7,first_sent_at=? WHERE subscription_id=? AND delivery_id=?").bind(now().toISOString(), all.id, leases[0].deliveryId).run();
  const group = await groupFor(leases, all.id);
  const attempt = await beginDailyNotificationGroup(db, principal, group.id, leases, now()); if (!attempt) throw new Error("Missing attempt");
  expect(await finishDailyNotificationGroup(db, principal, group.id, leases, attempt, { kind: "retry" }, now())).toMatchObject({ state: "cancelled" });
  const before = (await rows()).find((r) => r.delivery_id === leases[1].deliveryId && r.subscription_id === all.id);
  expect(before).toMatchObject({ state: "retry_wait", attempts: 1 });
  expect(await freezeDailyNotificationGroup(db, principal, leases, all.id, now())).toBeNull();
  const later = new Date(Date.now() + 60_000);
  const regrouped = await freezeDailyNotificationGroup(db, principal, leases, all.id, later); if (!regrouped) throw new Error("Missing regrouped event");
  expect(JSON.parse(regrouped.body).data.items).toHaveLength(1);
  expect((await rows()).find((r) => r.delivery_id === leases[1].deliveryId && r.subscription_id === all.id)).toEqual(before);
  expect((await rows()).find((r) => r.delivery_id === leases[0].deliveryId && r.subscription_id === all.id)).toMatchObject({ state: "failed", attempts: 8 });
});
it("送る前の24時間上限を打ち切り、別IDで回避しない", async () => {
  const { leases, all } = await prepared();
  await db.prepare("UPDATE notification_event_recipients SET attempts=1,first_sent_at=? WHERE subscription_id=?").bind(new Date(Date.now() - 86_400_000).toISOString(), all.id).run();
  const group = await groupFor(leases, all.id);
  expect(await beginDailyNotificationGroup(db, principal, group.id, leases, now())).toBeNull();
  expect((await rows()).filter((r) => r.subscription_id === all.id).map((r) => ({ state: r.state, attempts: r.attempts }))).toEqual([{ state: "failed", attempts: 1 }, { state: "failed", attempts: 1 }]);
  expect(await freezeDailyNotificationGroup(db, principal, leases, all.id, now())).toBeNull();
});
it("他家庭・同家庭の別本人・scope不足を拒否し、jobの処理量を制限する", async () => {
  const { leases, all, filtered } = await prepared(); const group = await groupFor(leases, all.id);
  await db.prepare("INSERT INTO household_members(household_id,user_id) VALUES('household-a','user-outsider')").run();
  for (const owner of [{ ...principal, householdId: "household-b" }, { ...principal, userId: "user-outsider" }]) {
    await expect(beginDailyNotificationGroup(db, owner, group.id, leases, now())).rejects.toMatchObject({ code: "not_found" });
  }
  await expect(beginDailyNotificationGroup(db, { ...principal, scopes: ["household.read"] }, group.id, leases, now())).rejects.toMatchObject({ code: "insufficient_scope" });
  const oversized = Array.from({ length: 11 }, (_, i) => ({ ...leases[0], deliveryId: `fictional-${i}` }));
  await expect(freezeDailyNotificationGroup(db, principal, oversized, all.id, now())).rejects.toThrow("invalid_group_leases");
  const other = await groupFor(leases, filtered.id);
  // schema上の将来上限50と、一jobの安全な処理枠10は別に保つ。
  await db.prepare("INSERT INTO notification_event_groups(id,household_id,user_id,connection_id,subscription_id,lifecycle,event_id,body,item_count,next_attempt_at,frozen_at,updated_at) SELECT 'large',household_id,user_id,connection_id,subscription_id,lifecycle,'evt_large','{}',10,next_attempt_at,frozen_at,updated_at FROM notification_event_groups WHERE id=?").bind(group.id).run();
  await expect(deliverFrozenDailyNotificationEvents({ db, principal, secret: "fictional-digest-secret-at-least-32-bytes", providerId: "test", transport: { post: vi.fn() }, now }, leases, ["large", other.id])).rejects.toThrow("invalid_group_budget");
  expect((await rows()).every((r) => r.attempts === 0)).toBe(true);
});
it("開始batchまでの家族の変更をguardで拒否し、一件もsendingにしない", async () => {
  const { leases, sources, all } = await prepared(); const group = await groupFor(leases, all.id); let changed = false;
  const racing = new Proxy(db, { get(target, property) {
    if (property === "batch") return async (statements: D1PreparedStatement[]) => {
      if (!changed) { changed = true; await target.prepare("UPDATE task_occurrences SET status='completed' WHERE id=?").bind(sources[1].occurrenceId).run(); }
      return target.batch(statements);
    };
    const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
  } });
  await expect(beginDailyNotificationGroup(racing, principal, group.id, leases, now())).rejects.toMatchObject({ code: "read_conflict" });
  expect((await rows()).every((r) => r.attempts === 0 && r.state === "pending")).toBe(true);
  expect(await db.prepare("SELECT state FROM notification_event_groups WHERE id=?").bind(group.id).first()).toEqual({ state: "pending" });
});
it("別の宛先で既に受領した結果は、未送信groupの取りやめでも保つ", async () => {
  const { leases, sources, all, filtered } = await prepared(); const sent = await groupFor(leases, filtered.id);
  const attempt = await beginDailyNotificationGroup(db, principal, sent.id, leases, now()); if (!attempt) throw new Error("Missing attempt");
  await finishDailyNotificationGroup(db, principal, sent.id, leases, attempt, { kind: "accepted" }, now());
  const group = await groupFor(leases, all.id);
  await db.prepare("UPDATE task_occurrences SET status='completed' WHERE id=?").bind(sources[0].occurrenceId).run();
  expect(await beginDailyNotificationGroup(db, principal, group.id, leases, now())).toBeNull();
  expect((await rows()).find((r) => r.subscription_id === filtered.id)).toMatchObject({ state: "accepted", attempts: 1 });
  expect(await db.prepare("SELECT state,body FROM notification_event_groups WHERE id=?").bind(sent.id).first()).toEqual({ state: "accepted", body: sent.body });
});
it("最大10件の固定・開始・送信・保存・親確定がD1の通常呼出枠に収まる", async () => {
  const { leases, all } = await prepared(10); let statements = 0;
  const counted = new Proxy(db, { get(target, property) {
    if (property === "prepare") return (sql: string) => { statements++; return target.prepare(sql); };
    const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
  } });
  const group = await freezeDailyNotificationGroup(counted, principal, leases, all.id, now()); if (!group) throw new Error("Missing group");
  const post = vi.fn(async () => new Response(null, { status: 204 }));
  await deliverFrozenDailyNotificationEvents({ db: counted, principal, secret: "fictional-digest-secret-at-least-32-bytes", providerId: "test", transport: { post }, now }, leases, [group.id]);
  expect(post).toHaveBeenCalledTimes(1);
  expect(statements).toBeLessThan(1000);
  expect((await rows()).filter((r) => r.subscription_id === all.id).map((r) => r.state)).toEqual(Array.from({ length: 10 }, () => "accepted"));
});
it("終端本文だけを90日後に100件ずつ消し、unknownの最小証拠と非終端を残す", async () => {
  const { leases, all } = await prepared(); const group = await groupFor(leases, all.id);
  const cutoff = new Date(Date.now() - 91 * 86_400_000).toISOString();
  await db.prepare(`INSERT INTO notification_event_groups(id,household_id,user_id,connection_id,subscription_id,lifecycle,event_id,body,item_count,state,next_attempt_at,frozen_at,updated_at,terminal_at)
    WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<101)
    SELECT 'old-'||i,g.household_id,g.user_id,g.connection_id,g.subscription_id,g.lifecycle,'evt_old-'||i,g.body,g.item_count,'unknown',g.next_attempt_at,g.frozen_at,?,? FROM n,notification_event_groups g WHERE g.id=?`)
    .bind(cutoff, cutoff, group.id).run();
  await pruneNotificationOutbox(db, now());
  expect(await db.prepare("SELECT count(*) AS count FROM notification_event_groups WHERE body IS NULL AND state='unknown'").first()).toEqual({ count: 100 });
  expect(await db.prepare("SELECT body FROM notification_event_groups WHERE id=?").bind(group.id).first()).toEqual({ body: group.body });
  await pruneNotificationOutbox(db, now());
  expect(await db.prepare("SELECT count(*) AS count FROM notification_event_groups WHERE body IS NULL AND state='unknown'").first()).toEqual({ count: 101 });
  const plans = [
    "SELECT id FROM notification_event_groups WHERE terminal_at IS NOT NULL AND terminal_at<'2026-01-01' AND body IS NOT NULL ORDER BY terminal_at,id LIMIT 100",
    "SELECT id FROM notification_event_groups WHERE state IN ('accepted','cancelled') AND terminal_at<'2026-01-01' ORDER BY terminal_at,id LIMIT 100",
    "SELECT id FROM notification_event_groups WHERE connection_id='connection-a' AND state='sending' AND attempt_expires_at<'2026-01-01' ORDER BY attempt_expires_at,id LIMIT 100",
  ];
  for (const [index, query] of plans.entries()) {
    const plan = (await db.prepare(`EXPLAIN QUERY PLAN ${query}`).all<{ detail: string }>()).results.map((r) => r.detail).join(" ");
    expect(plan).toContain(["notification_event_groups_retention_idx", "notification_event_groups_prune_idx", "notification_event_groups_recovery_idx"][index]);
  }
});
