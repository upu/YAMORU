import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import { applyAllMigrations } from "./test-support/migrations";
import { resetNotificationFixtures, notificationCandidate, notificationPrincipal as principal } from "./test-support/notifications";
import { createEventSubscriptionService } from "../../features/integration/notifications/event-subscriptions";
import { decryptWebhookDestination } from "../../features/integration/notifications/event-crypto";
import { eventSubscription, saveEventSubscription, pruneEventSubscriptions } from "./notification-event-subscriptions";
const db = env.DB;
const master = "fictional-event-seal-key-with-at-least-32-characters";
const secret = `whsec_${btoa("z".repeat(32))}`;
const url = "https://receiver.example.com/events?token=fictional-callback-token";
const input = (args: Record<string, unknown> = {}, callback = url) => ({ name: "attention.ready", arguments: args, delivery: { mode: "webhook", url: callback, secret }, cursor: null });
beforeAll(() => applyAllMigrations(db));
beforeEach(() => resetNotificationFixtures(db));
function service(p = principal, post = vi.fn(async (_url: string, request: { body: string }) => Response.json({ challenge: (JSON.parse(request.body) as { challenge: string }).challenge })), sealKey = master) {
  return { post, api: createEventSubscriptionService({ db, authorize: async () => p, secret: sealKey, providerId: "fictional-pinned-provider", transport: { post }, now: () => new Date() }) };
}
it("署名付きchallengeを通した購読を暗号化保存し、同じ条件のrefreshとcacheを冪等にする", async () => {
  const { ruleId } = await notificationCandidate(db);
  const { api, post } = service();
  const first = await api.subscribe(input({ todo_rule_ids: [ruleId] }));
  await db.prepare("UPDATE notification_event_subscriptions SET callback_origin='https://legacy.receiver.example.com' WHERE id=?").bind(first.id).run();
  const second = await api.subscribe(input({ kinds: ["todo_occurrence"], todo_rule_ids: [ruleId, ruleId] }));
  expect(second.id).toBe(first.id);
  expect(post).toHaveBeenCalledTimes(1);
  const row = await db.prepare("SELECT * FROM notification_event_subscriptions").first<{ encrypted_destination: string; state: string }>();
  expect(row?.state).toBe("active");
  expect(row).toMatchObject({ callback_origin: "" });
  expect(JSON.stringify(row)).not.toContain(secret);
  expect(JSON.stringify(row)).not.toContain("fictional-callback-token");
  expect(await decryptWebhookDestination(master, principal, first.id, row?.encrypted_destination ?? "")).toEqual({ url, secret });
  expect(first).toMatchObject({ cursor: null, truncated: false });
  expect(JSON.stringify(first)).not.toContain("destination");
});
it("本人とscope・家庭の対象を確かめる前にcallbackへ接続しない", async () => {
  const denied = service({ ...principal, scopes: ["household.read", "notifications.manage"] });
  await expect(denied.api.subscribe(input())).rejects.toMatchObject({ code: "insufficient_scope" });
  expect(denied.post).not.toHaveBeenCalled();
  const foreign = service({ ...principal, clientId: "https://other.example.com" });
  await expect(foreign.api.subscribe(input())).rejects.toThrow();
  expect(foreign.post).not.toHaveBeenCalled();
  const own = service();
  await expect(own.api.subscribe(input({ todo_rule_ids: ["foreign-rule"] }))).rejects.toMatchObject({ code: "not_found" });
  expect(own.post).not.toHaveBeenCalled();
});
it("challenge不一致と確認中のgrant解除では購読を有効にしない", async () => {
  const wrong = service(principal, vi.fn(async () => Response.json({ challenge: "wrong" })));
  await expect(wrong.api.subscribe(input())).rejects.toMatchObject({ code: "callback_unavailable", reason: "challenge_failed" });
  const revoked = service(principal, vi.fn(async (_url: string, request: { body: string }) => {
    await db.prepare("UPDATE oauth_connections SET revoked_at=?,revoked_reason='user_revoked' WHERE id=?").bind(new Date().toISOString(), principal.connectionId).run();
    return Response.json({ challenge: (JSON.parse(request.body) as { challenge: string }).challenge });
  }));
  await expect(revoked.api.subscribe(input())).rejects.toMatchObject({ code: "connection_unavailable" });
  expect((await db.prepare("SELECT * FROM notification_event_subscriptions").all()).results).toEqual([]);
});
it("解除は冪等で秘密を消し、再購読では検証をやり直す", async () => {
  const { api, post } = service();
  const first = await api.subscribe(input());
  await db.prepare("UPDATE notification_event_subscriptions SET callback_origin='https://legacy.receiver.example.com' WHERE id=?").bind(first.id).run();
  const stop = { name: "attention.ready", arguments: {}, delivery: { mode: "webhook", url } };
  await api.unsubscribe(stop);
  await api.unsubscribe(stop);
  expect(await db.prepare("SELECT state,encrypted_destination,callback_origin FROM notification_event_subscriptions").first()).toEqual({ state: "revoked", encrypted_destination: null, callback_origin: "" });
  expect((await api.subscribe(input())).id).toBe(first.id);
  expect(post).toHaveBeenCalledTimes(2);
});
it("並列作成でも接続ごと20購読の上限を超えない", async () => {
  const { api } = service();
  const results = await Promise.allSettled(Array.from({ length: 21 }, (_value, index) => api.subscribe(input({}, `https://receiver.example.com/events/${index}`))));
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(20);
  expect(await db.prepare("SELECT count(*) AS n FROM notification_event_subscriptions WHERE state='active'").first()).toEqual({ n: 20 });
  expect((await db.prepare("SELECT * FROM attention_guards").all()).results).toEqual([]);
});
it("確認中に届いた解除が、遅い初回購読によって復活しない", async () => {
  const stopped = service();
  const slow = service(principal, vi.fn(async (_url: string, request: { body: string }) => {
    await stopped.api.unsubscribe({ name: "attention.ready", arguments: {}, delivery: { mode: "webhook", url } });
    return Response.json({ challenge: (JSON.parse(request.body) as { challenge: string }).challenge });
  }));
  await expect(slow.api.subscribe(input())).rejects.toMatchObject({ code: "read_conflict" });
  expect(await db.prepare("SELECT state,encrypted_destination FROM notification_event_subscriptions").first()).toEqual({ state: "revoked", encrypted_destination: null });
});
it("順序が逆になった秘密の更新で、新しく保存した値を古い要求が上書きしない", async () => {
  const nextSecret = `whsec_${btoa("y".repeat(32))}`;
  const newer = service();
  let savedId = "";
  const older = service(principal, vi.fn(async (_url: string, request: { body: string }) => {
    const next = input();
    next.delivery.secret = nextSecret;
    savedId = (await newer.api.subscribe(next)).id;
    return Response.json({ challenge: (JSON.parse(request.body) as { challenge: string }).challenge });
  }));
  await expect(older.api.subscribe(input())).rejects.toMatchObject({ code: "read_conflict" });
  const row = await db.prepare("SELECT encrypted_destination FROM notification_event_subscriptions").first<{ encrypted_destination: string }>();
  expect((await decryptWebhookDestination(master, principal, savedId, row?.encrypted_destination ?? "")).secret).toBe(nextSecret);
});
it("要求した短い有効期間を守り、鍵の更新後も短い署名移行期間を保持する", async () => {
  const { api } = service();
  const before = Date.now();
  const first = await api.subscribe({ ...input(), ttlMs: 120_000 });
  expect(Date.parse(first.refreshBefore)).toBeLessThanOrEqual(Date.now() + 120_000);
  expect(Date.parse(first.refreshBefore)).toBeGreaterThanOrEqual(before + 120_000);
  const replacement = `whsec_${btoa("x".repeat(32))}`;
  await api.subscribe({ ...input(), delivery: { ...input().delivery, secret: replacement } });
  const row = await eventSubscription(db, principal, first.id);
  const decoded = await decryptWebhookDestination(master, principal, first.id, row?.encrypted_destination ?? "");
  expect(decoded).toMatchObject({ secret: replacement, previous: { secret } });
});
it("最終batchで古い検証を拒み、解除・期限切れでは秘密を消す", async () => {
  const { api } = service();
  const saved = await api.subscribe(input());
  const row = await eventSubscription(db, principal, saved.id);
  if (!row?.encrypted_destination || !row.key_fingerprint || !row.provider_id) throw new Error("Missing subscription");
  await expect(saveEventSubscription(db, principal, { id: row.id, filter: { kinds: ["todo_occurrence", "consumable"] }, callbackHash: row.callback_hash,
    encryptedDestination: row.encrypted_destination, keyFingerprint: row.key_fingerprint, providerId: row.provider_id, verifiedAt: new Date(Date.now() - 901_000).toISOString(),
    expiresAt: row.expires_at, expectedRevision: row.revision }, new Date())).rejects.toMatchObject({ code: "read_conflict" });
  await pruneEventSubscriptions(db, new Date(Date.now() + 86_401_000));
  expect(await db.prepare("SELECT state,encrypted_destination,key_fingerprint FROM notification_event_subscriptions").first()).toEqual({ state: "expired", encrypted_destination: null, key_fingerprint: null });
  await pruneEventSubscriptions(db, new Date(Date.now() + 92 * 86_400_000));
  expect((await db.prepare("SELECT * FROM notification_event_subscriptions").all()).results).toEqual([]);
});
it("callbackの本文が止まっても要求中断で検証を終え、購読を保存しない", async () => {
  const controller = new AbortController();
  let cancelled = false;
  const api = createEventSubscriptionService({ db, authorize: async () => principal, secret: master, providerId: "fictional-provider", signal: controller.signal,
    transport: { post: async () => { queueMicrotask(() => { controller.abort(); }); return new Response(new ReadableStream({ cancel() { cancelled = true; } })); } } });
  await expect(api.subscribe(input())).rejects.toMatchObject({ code: "callback_unavailable", reason: "timeout" });
  expect(cancelled).toBe(true);
  expect((await db.prepare("SELECT * FROM notification_event_subscriptions").all()).results).toEqual([]);
});
it.each(["http_error", "response_too_large"] as const)("%sの本文を閉じる処理が止まっても検証失敗を返す", async (reason) => {
  const response = new Response(new ReadableStream({ cancel: () => new Promise<void>(() => {}) }),
    reason === "http_error" ? { status: 503 } : { headers: { "content-length": "5000" } });
  const api = createEventSubscriptionService({ db, authorize: async () => principal, secret: master, providerId: "fictional-provider", transport: { post: async () => response } });
  await expect(api.subscribe(input())).rejects.toMatchObject({ code: "callback_unavailable", reason });
  expect((await db.prepare("SELECT * FROM notification_event_subscriptions").all()).results).toEqual([]);
});
it("暗号化鍵を変更して古い暗号文を読めなくても、再検証した同じ購読を修復できる", async () => {
  const first = service();
  const before = await first.api.subscribe(input());
  const nextMaster = `${master}-rotated`;
  const rotated = service(principal, first.post, nextMaster);
  expect((await rotated.api.subscribe(input())).id).toBe(before.id);
  expect(first.post).toHaveBeenCalledTimes(2);
  const row = await eventSubscription(db, principal, before.id);
  expect(await decryptWebhookDestination(nextMaster, principal, before.id, row?.encrypted_destination ?? "")).toEqual({ url, secret });
  await expect(decryptWebhookDestination(master, principal, before.id, row?.encrypted_destination ?? "")).rejects.toThrow();
  const unavailable = service(principal, first.post, "short");
  await expect(unavailable.api.subscribe(input())).rejects.toMatchObject({ code: "key_unavailable" });
  expect(await eventSubscription(db, principal, before.id)).toEqual(row);
});
it("同じURLの別購読に検証cacheがあっても、解除した購読では検証をやり直す", async () => {
  const { api, post } = service();
  await api.subscribe(input());
  await api.subscribe(input({ kinds: ["consumable"] }));
  expect(post).toHaveBeenCalledTimes(1);
  await api.unsubscribe({ name: "attention.ready", delivery: { mode: "webhook", url } });
  await api.subscribe(input());
  expect(post).toHaveBeenCalledTimes(2);
});
it("古い平文originだけを消し、暗号化URL・購読ID・状態・日時は変えない", async () => {
  const { api } = service();
  const saved = await api.subscribe(input());
  await db.prepare("UPDATE notification_event_subscriptions SET callback_origin='https://legacy.receiver.example.com'").run();
  const before = await db.prepare("SELECT * FROM notification_event_subscriptions").first();
  if (!before) throw new Error("Missing subscription");
  await pruneEventSubscriptions(db, new Date());
  const after = await db.prepare("SELECT * FROM notification_event_subscriptions").first();
  expect(after).toMatchObject({ callback_origin: "" });
  expect({ ...after, callback_origin: before.callback_origin }).toEqual(before);
  expect(await decryptWebhookDestination(master, principal, saved.id, String(after?.encrypted_destination))).toEqual({ url, secret });
});
