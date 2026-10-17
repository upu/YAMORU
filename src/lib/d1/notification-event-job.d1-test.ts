import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import { applyAllMigrations } from "./test-support/migrations";
import { resetNotificationFixtures, notificationCandidate, notificationPrincipal as principal } from "./test-support/notifications";
import { householdAMember } from "./test-support/households";
import { DEFAULT_SETTINGS } from "../../features/integration/notifications/contract";
import { createEventSubscriptionService } from "../../features/integration/notifications/event-subscriptions";
import { saveNotificationSettings } from "./notification-settings";
import { enqueueNotification, leaseNotification } from "./notification-outbox";
import { freezeNotificationEvent } from "./notification-event-dispatch";
import { deliverFrozenNotificationEvent } from "../../features/integration/notifications/event-job";
import { WebhookEndpointError, type PinnedWebhookTransport } from "../../features/integration/notifications/webhook-transport";
const db = env.DB;
const now = () => new Date();
const master = "fictional-event-job-master-key-at-least-32-characters";
type Post = PinnedWebhookTransport["post"];
beforeAll(() => applyAllMigrations(db));
beforeEach(() => resetNotificationFixtures(db));
async function prepared(count = 3, mode: "daily" | "individual" = "individual") {
  await saveNotificationSettings(db, householdAMember, { ...DEFAULT_SETTINGS, enabled: true, connectionId: principal.connectionId, mode, digestTime: "00:00", quietEnabled: false }, 0, now());
  const source = await notificationCandidate(db);
  const service = createEventSubscriptionService({ db, authorize: async () => principal, secret: master, providerId: "test",
    transport: { post: async (_url, request) => Response.json(JSON.parse(request.body) as unknown) } });
  for (let i = 0; i < count; i++) await service.subscribe({ name: "attention.ready", delivery: { mode: "webhook", url: `https://receiver.example.com/${i}`, secret: `whsec_${btoa("x".repeat(32))}` } });
  await enqueueNotification(db, principal, source.candidate.candidate_id, now());
  const lease = await leaseNotification(db, principal, now());
  if (!lease) throw new Error("Missing lease");
  const frozen = await freezeNotificationEvent(db, principal, lease, now());
  if (!frozen) throw new Error("Missing event");
  return { lease, frozen, ...source };
}
const dependencies = (post: Post, database = db) => ({ db: database, principal, secret: master, providerId: "test", transport: { post }, now });
it("二宛先ずつ署名して送り、受領済みは後の再試行で送り直さない", async () => {
  const { lease, frozen } = await prepared();
  const post = vi.fn<Post>().mockResolvedValue(new Response(null, { status: 202 }));
  post.mockResolvedValueOnce(new Response(null, { status: 503 }));
  expect(await deliverFrozenNotificationEvent(dependencies(post), lease, frozen.recipientIds)).toMatchObject({ state: "retry_wait", started: 3 });
  expect(post).toHaveBeenCalledTimes(3);
  const retriedId = post.mock.calls[0][1].headers["X-MCP-Subscription-Id"];
  await db.prepare("UPDATE notification_outbox SET next_attempt_at='2000-01-01T00:00:00.000Z'").run();
  await db.prepare("UPDATE notification_event_recipients SET next_attempt_at='2000-01-01T00:00:00.000Z'").run();
  const retry = await leaseNotification(db, principal, now());
  if (!retry) throw new Error("Missing retry");
  expect(await deliverFrozenNotificationEvent(dependencies(post), retry, frozen.recipientIds)).toMatchObject({ state: "accepted", started: 1 });
  expect(post).toHaveBeenCalledTimes(4);
  expect(post.mock.calls[3][1].headers["X-MCP-Subscription-Id"]).toBe(retriedId);
  expect(post.mock.calls.every((call) => call[1].body === frozen.body && call[1].headers["webhook-id"] === frozen.eventId)).toBe(true);
});
it("通信が不明になった宛先は繰り返さず、別の宛先の受領を保存する", async () => {
  const { lease, frozen } = await prepared();
  const post = vi.fn<Post>().mockResolvedValue(new Response(null, { status: 202 })).mockRejectedValueOnce(new WebhookEndpointError("timeout", true));
  expect(await deliverFrozenNotificationEvent(dependencies(post), lease, frozen.recipientIds)).toMatchObject({ state: "unknown", started: 3 });
  expect(post).toHaveBeenCalledTimes(3);
  expect((await db.prepare("SELECT state FROM notification_event_recipients").all()).results.map((r) => r.state).sort()).toEqual(["accepted", "accepted", "unknown"]);
});
it("同時送信は最大二件とし、全ての応答を保存してから親を確定する", async () => {
  const { lease, frozen } = await prepared(6);
  let active = 0; let max = 0;
  const post = vi.fn<Post>().mockImplementation(() => {
    active++; max = Math.max(max, active);
    return new Promise<Response>((resolve) => setTimeout(() => { active--; resolve(new Response(null, { status: 202 })); }, 10));
  });
  expect(await deliverFrozenNotificationEvent(dependencies(post), lease, frozen.recipientIds)).toMatchObject({ state: "accepted", started: 6 });
  expect(max).toBe(2);
  expect(active).toBe(0);
});
it("送信後の保存だけを再試行し、POSTは一回で受領を保存する", async () => {
  const { lease, frozen } = await prepared(1); let writes = 0;
  const flaky = { prepare: (sql: string) => db.prepare(sql), batch: (statements: D1PreparedStatement[]) => {
    writes++;
    if (writes === 2) return Promise.reject(new Error("fictional storage unavailable"));
    return db.batch(statements);
  } } as unknown as D1Database;
  const post = vi.fn<Post>().mockResolvedValue(new Response(null, { status: 202 }));
  expect(await deliverFrozenNotificationEvent(dependencies(post, flaky), lease, frozen.recipientIds)).toMatchObject({ state: "accepted", started: 1 });
  expect(post).toHaveBeenCalledTimes(1);
});
it("一件受領後の家族の完了を、その後の宛先にも反映する", async () => {
  const { lease, frozen, occurrenceId } = await prepared(5); let posted = false;
  const post = vi.fn<Post>().mockImplementation(async () => {
    if (!posted) { posted = true; await db.prepare("UPDATE task_occurrences SET status='completed' WHERE id=?").bind(occurrenceId).run(); }
    return new Response(null, { status: 202 });
  });
  expect(await deliverFrozenNotificationEvent(dependencies(post), lease, frozen.recipientIds)).toMatchObject({ state: "accepted" });
  expect(post.mock.calls.length).toBeLessThanOrEqual(2);
  expect((await db.prepare("SELECT count(*) AS n FROM notification_event_recipients WHERE state='cancelled'").first())?.n).toBeGreaterThanOrEqual(3);
});
it("日次まとめへ切り替えたら個別の古い本文を送らない", async () => {
  const { lease, frozen } = await prepared();
  await saveNotificationSettings(db, householdAMember, { ...DEFAULT_SETTINGS, enabled: true, connectionId: principal.connectionId, mode: "daily", digestTime: "00:00", quietEnabled: false }, 1, now());
  const post = vi.fn<Post>().mockResolvedValue(new Response(null, { status: 202 }));
  expect(await deliverFrozenNotificationEvent(dependencies(post), lease, frozen.recipientIds)).toMatchObject({ state: "cancelled", started: 0 });
  expect(post).not.toHaveBeenCalled();
  expect((await db.prepare("SELECT reason FROM notification_delivery_history").first())?.reason).toBe("notification_mode_changed");
});
it("保存した通知方式を後から読み替えず、日次から個別へ変えても古い本文を送らない", async () => {
  const { lease, frozen } = await prepared(1, "daily");
  expect(frozen.mode).toBe("daily");
  expect((JSON.parse(frozen.body) as { data: { notification_mode: string } }).data.notification_mode).toBe("daily");
  await saveNotificationSettings(db, householdAMember, { ...DEFAULT_SETTINGS, enabled: true, connectionId: principal.connectionId, mode: "individual", quietEnabled: false }, 1, now());
  const post = vi.fn<Post>().mockResolvedValue(new Response(null, { status: 202 }));
  expect(await deliverFrozenNotificationEvent(dependencies(post), lease, frozen.recipientIds)).toMatchObject({ state: "cancelled", started: 0 });
  expect(post).not.toHaveBeenCalled();
});
it("通知方式の項目がない旧形式は個別通知として同じ本文を扱う", async () => {
  const { lease, frozen } = await prepared(1);
  const legacy = JSON.parse(frozen.body) as { data: { notification_mode?: string } };
  delete legacy.data.notification_mode;
  const body = JSON.stringify(legacy);
  await db.prepare("UPDATE notification_event_batches SET body=? WHERE delivery_id=?").bind(body, lease.deliveryId).run();
  const post = vi.fn<Post>().mockResolvedValue(new Response(null, { status: 202 }));
  expect(await deliverFrozenNotificationEvent(dependencies(post), lease, frozen.recipientIds)).toMatchObject({ state: "accepted", started: 1 });
  expect(post.mock.calls[0][1].body).toBe(body);
});
it("中断したjobは新たな宛先を開始せず、未送信は同じIDで次回へ残す", async () => {
  const { lease, frozen } = await prepared();
  const post = vi.fn<Post>().mockResolvedValue(new Response(null, { status: 202 }));
  const controller = new AbortController(); controller.abort();
  expect(await deliverFrozenNotificationEvent({ ...dependencies(post), signal: controller.signal }, lease, frozen.recipientIds)).toMatchObject({ state: "retry_wait", started: 0 });
  expect(post).not.toHaveBeenCalled();
  expect((await db.prepare("SELECT state,attempts FROM notification_event_recipients").all()).results).toEqual(Array.from({ length: 3 }, () => ({ state: "pending", attempts: 0 })));
  expect((await db.prepare("SELECT delivery_id FROM notification_outbox").first())?.delivery_id).toBe(lease.deliveryId);
});
it("開始の保存中に中断してもPOSTせず、既知の未送信として結果を保存する", async () => {
  const { lease, frozen } = await prepared(); const controller = new AbortController();
  const interrupted = { prepare: (sql: string) => db.prepare(sql), batch: async (statements: D1PreparedStatement[]) => {
    const result = await db.batch(statements);
    controller.abort();
    return result;
  } } as unknown as D1Database;
  const post = vi.fn<Post>().mockResolvedValue(new Response(null, { status: 202 }));
  expect(await deliverFrozenNotificationEvent({ ...dependencies(post, interrupted), signal: controller.signal }, lease, frozen.recipientIds)).toMatchObject({ state: "retry_wait", started: 1 });
  expect(post).not.toHaveBeenCalled();
  expect((await db.prepare("SELECT count(*) AS n FROM notification_event_recipients WHERE state='retry_wait'").first())?.n).toBe(1);
  expect((await db.prepare("SELECT count(*) AS n FROM notification_event_recipients WHERE state='pending'").first())?.n).toBe(2);
});
it("送信中の接続解除でも受領結果を保存し、その後の未送信を止める", async () => {
  const { lease, frozen } = await prepared(5); let revoked = false;
  const post = vi.fn<Post>().mockImplementation(async () => {
    if (!revoked) { revoked = true; await db.prepare("UPDATE oauth_connections SET revoked_at=?,revoked_reason='user_revoked'").bind(now().toISOString()).run(); }
    return new Response(null, { status: 202 });
  });
  expect(await deliverFrozenNotificationEvent(dependencies(post), lease, frozen.recipientIds)).toMatchObject({ state: "accepted" });
  expect(post.mock.calls.length).toBeLessThanOrEqual(2);
  expect((await db.prepare("SELECT count(*) AS n FROM notification_event_recipients WHERE state='accepted'").first())?.n).toBe(post.mock.calls.length);
  expect((await db.prepare("SELECT count(*) AS n FROM notification_event_recipients WHERE state='cancelled'").first())?.n).toBeGreaterThanOrEqual(3);
});
it("受領後の保存が止まった場合は新たに送信せず、回収でunknownとして残す", async () => {
  const { lease, frozen } = await prepared(4); let writes = 0;
  const failing = { prepare: (sql: string) => db.prepare(sql), batch: (statements: D1PreparedStatement[]) => {
    writes++;
    if (writes >= 3) return Promise.reject(new Error("fictional storage failure"));
    return db.batch(statements);
  } } as unknown as D1Database;
  const post = vi.fn<Post>().mockResolvedValue(new Response(null, { status: 202 }));
  await expect(deliverFrozenNotificationEvent(dependencies(post, failing), lease, frozen.recipientIds)).rejects.toThrow("notification_event_storage_unavailable");
  expect(post.mock.calls.length).toBeLessThanOrEqual(2);
  await db.prepare("UPDATE notification_outbox SET lease_expires_at='2000-01-01T00:00:00.000Z'").run();
  const { recoverNotificationLeases } = await import("./notification-outbox");
  await recoverNotificationLeases(db, principal, now());
  expect((await db.prepare("SELECT count(*) AS n FROM notification_event_recipients WHERE state='unknown'").first())?.n).toBe(2);
  expect((await db.prepare("SELECT count(*) AS n FROM notification_event_recipients WHERE state='pending'").first())?.n).toBe(2);
  expect((await db.prepare("SELECT state FROM notification_outbox").first())?.state).toBe("retry_wait");
});
it("別の家庭・本人・scopeのjobでは送り出せない", async () => {
  const { lease, frozen } = await prepared();
  const post = vi.fn<Post>().mockResolvedValue(new Response(null, { status: 202 }));
  for (const changed of [{ householdId: "household-b" }, { userId: "user-b" }, { scopes: ["household.read"] as const }]) {
    await expect(deliverFrozenNotificationEvent({ ...dependencies(post), principal: { ...principal, ...changed } }, lease, frozen.recipientIds)).rejects.toThrow("notification_event_storage_unavailable");
  }
  expect(post).not.toHaveBeenCalled();
});
