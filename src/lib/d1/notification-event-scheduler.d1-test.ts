import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import { applyAllMigrations } from "./test-support/migrations";
import { notificationCandidate, notificationPrincipal as principal, resetNotificationFixtures } from "./test-support/notifications";
import { createHouseholdAMaintenanceTask, householdAMember, householdBMember } from "./test-support/households";
import { createMaintenanceTask } from "./todos";
import { DEFAULT_SETTINGS } from "../../features/integration/notifications/contract";
import { createEventSubscriptionService } from "../../features/integration/notifications/event-subscriptions";
import { runNotificationScheduler } from "../../features/integration/notifications/scheduler";
import { saveNotificationSettings } from "./notification-settings";
import { enqueueNotification, leaseNotification } from "./notification-outbox";
import { freezeNotificationEvent, settleNotificationEvent } from "./notification-event-dispatch";
import { beginDailyNotificationGroup, freezeDailyNotificationGroup } from "./notification-event-groups";
import { WebhookEndpointError, type PinnedWebhookTransport } from "../../features/integration/notifications/webhook-transport";
import { claimScheduledEventWork, reconcileNotificationGroups } from "./notification-event-work";
import { claimNotificationSchedule, seedNotificationSchedule } from "./notification-scheduler";
const db = env.DB;
function inspectedDatabase(beforeBatch?: (sql: string[]) => Promise<void>) {
  const originals = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  const sqlByStatement = new WeakMap<D1PreparedStatement, string>();
  let queries = 0;
  function wrap(statement: D1PreparedStatement, sql: string): D1PreparedStatement {
    const proxy = new Proxy(statement, { get(target, property) {
      if (property === "bind") return (...values: unknown[]) => wrap(target.bind(...values), sql);
      const value = Reflect.get(target, property);
      if (["first", "all", "run", "raw"].includes(String(property))) return (...args: unknown[]) => { queries++; return Reflect.apply(value, target, args); };
      return typeof value === "function" ? value.bind(target) : value;
    } });
    originals.set(proxy, statement); sqlByStatement.set(proxy, sql); return proxy;
  }
  const database = new Proxy(db, { get(target, property) {
    if (property === "prepare") return (sql: string) => wrap(target.prepare(sql), sql);
    if (property === "batch") return async (statements: D1PreparedStatement[]) => {
      queries++; await beforeBatch?.(statements.map((s) => sqlByStatement.get(s) ?? ""));
      return target.batch(statements.map((s) => originals.get(s) ?? s));
    };
    const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
  } });
  return { database, queries: () => queries };
}
beforeAll(() => applyAllMigrations(db));
beforeEach(() => resetNotificationFixtures(db));
async function prepared(mode: "daily" | "individual" = "daily", count = 2, subscriptions = 1) {
  const clock = { at: new Date() }; const secret = "fictional-scheduled-events-master-at-least-32-bytes";
  await saveNotificationSettings(db, householdAMember, { ...DEFAULT_SETTINGS, enabled: true, connectionId: principal.connectionId, mode, digestTime: "00:00", quietEnabled: false }, 0, clock.at);
  const sources = [];
  for (let index = 0; index < count; index++) sources.push(await notificationCandidate(db));
  const api = createEventSubscriptionService({ db, authorize: async () => principal, secret, providerId: "test",
    transport: { post: async (_url, request) => Response.json(JSON.parse(request.body) as unknown) } });
  for (let index = 0; index < subscriptions; index++) await api.subscribe({ name: "attention.ready", delivery: { mode: "webhook", url: `https://receiver.example.com/scheduled/${index}`, secret: `whsec_${btoa("x".repeat(32))}` } });
  const post = vi.fn<PinnedWebhookTransport["post"]>().mockResolvedValue(new Response(null, { status: 204 }));
  const dependencies = { db, allowedClientIds: [principal.clientId], now: () => clock.at, events: { secret, providerId: "test", transport: { post } } };
  return { sources, dependencies, post, clock, api };
}
async function queued() {
  const fixture = await prepared(); const { sources, clock } = fixture; const leases = [];
  for (const source of sources) await enqueueNotification(db, principal, source.candidate.candidate_id, clock.at);
  for (let index = 0; index < sources.length; index++) {
    const lease = await leaseNotification(db, principal, clock.at); if (!lease) throw new Error("Missing lease");
    await freezeNotificationEvent(db, principal, lease, clock.at); leases.push(lease);
  }
  const subscription = await db.prepare("SELECT id FROM notification_event_subscriptions").first<{ id: string }>(); if (!subscription) throw new Error("Missing subscription");
  const group = await freezeDailyNotificationGroup(db, principal, leases, subscription.id, clock.at); if (!group) throw new Error("Missing group");
  return { ...fixture, group, leases };
}
async function release(fixture: Awaited<ReturnType<typeof queued>>) {
  for (const lease of fixture.leases) await settleNotificationEvent(db, principal, lease, fixture.clock.at);
}
async function frozenPage() {
  const fixture = await prepared("daily", 10, 20);
  const leases = [];
  for (const source of fixture.sources) await enqueueNotification(db, principal, source.candidate.candidate_id, fixture.clock.at);
  for (let index = 0; index < fixture.sources.length; index++) {
    const lease = await leaseNotification(db, principal, fixture.clock.at); if (!lease) throw new Error("Missing lease");
    await freezeNotificationEvent(db, principal, lease, fixture.clock.at);
    leases.push(lease);
  }
  for (const lease of leases) await settleNotificationEvent(db, principal, lease, fixture.clock.at);
  return fixture;
}
it("定期走査から日次二件を一通で送り、元の配信ごとに受領を確定する", async () => {
  const { dependencies, sources, post } = await prepared();
  expect(await runNotificationScheduler(dependencies)).toEqual({ processed: 1, failed: 0 });
  expect(post).toHaveBeenCalledTimes(1);
  const group = await db.prepare("SELECT body,state FROM notification_event_groups").first<{ body: string; state: string }>();
  if (!group) throw new Error("Missing scheduled group");
  expect(group.state).toBe("accepted");
  expect(JSON.parse(group.body).data.items).toEqual(expect.arrayContaining(sources.map((s) => expect.objectContaining({ candidate_id: s.candidate.candidate_id, source: { kind: "todo_occurrence", entity_id: s.occurrenceId, todo_rule_id: s.ruleId } }))));
  expect((await db.prepare("SELECT state FROM notification_outbox").all()).results).toEqual([{ state: "accepted" }, { state: "accepted" }]);
  expect((await db.prepare("SELECT outcome FROM notification_delivery_marks").all()).results).toEqual([{ outcome: "accepted" }, { outcome: "accepted" }]);
});
it("providerを渡さない既存経路は走査だけを続ける", async () => {
  const { dependencies, post } = await prepared();
  const withoutEvents = { db: dependencies.db, allowedClientIds: dependencies.allowedClientIds, now: dependencies.now };
  expect(await runNotificationScheduler(withoutEvents)).toEqual({ processed: 1, failed: 0 });
  expect(post).not.toHaveBeenCalled();
  expect((await db.prepare("SELECT state FROM notification_outbox").all()).results).toEqual([{ state: "pending" }, { state: "pending" }]);
});
it("個別方式は元の配信ごとに送り、日次groupへ読み替えない", async () => {
  const { dependencies, post } = await prepared("individual");
  expect(await runNotificationScheduler(dependencies)).toEqual({ processed: 1, failed: 0 });
  expect(post).toHaveBeenCalledTimes(2);
  expect((await db.prepare("SELECT * FROM notification_event_groups").all()).results).toEqual([]);
  expect((await db.prepare("SELECT state FROM notification_outbox").all()).results).toEqual([{ state: "accepted" }, { state: "accepted" }]);
});
it("送信前の中断で保存済みgroupが残っても、全親leaseを取り直して同じ本文を送る", async () => {
  const fixture = await queued(); await release(fixture);
  expect(await runNotificationScheduler(fixture.dependencies)).toEqual({ processed: 1, failed: 0 });
  expect(fixture.post).toHaveBeenCalledTimes(1);
  expect(fixture.post).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ body: fixture.group.body }));
  expect((await db.prepare("SELECT state FROM notification_outbox").all()).results).toEqual([{ state: "accepted" }, { state: "accepted" }]);
});
it("一件の親を別処理が確保中なら、同じgroupの残りだけを確保・送信しない", async () => {
  const fixture = await queued(); await release(fixture);
  const held = await leaseNotification(db, principal, fixture.clock.at); if (!held) throw new Error("Missing held parent");
  expect(await runNotificationScheduler(fixture.dependencies)).toEqual({ processed: 1, failed: 0 });
  expect(fixture.post).not.toHaveBeenCalled();
  expect((await db.prepare("SELECT delivery_id,lease_token FROM notification_outbox WHERE state='leased'").all()).results).toEqual([{ delivery_id: held.deliveryId, lease_token: held.leaseToken }]);
  expect(await db.prepare("SELECT state FROM notification_event_groups WHERE id=?").bind(fixture.group.id).first()).toEqual({ state: "pending" });
});
it("家族の完了で保存済みの本文を取りやめ、残る未送信の一件だけをまとめ直す", async () => {
  const fixture = await queued(); await release(fixture);
  await db.prepare("UPDATE task_occurrences SET status='completed' WHERE id=?").bind(fixture.sources[0].occurrenceId).run();
  expect(await runNotificationScheduler(fixture.dependencies)).toEqual({ processed: 1, failed: 0 });
  expect(fixture.post).toHaveBeenCalledTimes(1);
  const call = fixture.post.mock.calls.at(0); if (!call) throw new Error("Missing request");
  expect(JSON.parse(call[1].body).data.items).toEqual([expect.objectContaining({ candidate_id: fixture.sources[1].candidate.candidate_id })]);
  expect(await db.prepare("SELECT state,body FROM notification_event_groups WHERE id=?").bind(fixture.group.id).first()).toEqual({ state: "cancelled", body: fixture.group.body });
});
it("scopeを失った接続でも、現在のCron権限で未送信groupを取りやめて終了する", async () => {
  const fixture = await queued(); await release(fixture);
  await db.prepare("UPDATE oauth_connections SET scopes='household.read'").run();
  expect(await runNotificationScheduler(fixture.dependencies)).toEqual({ processed: 1, failed: 0 });
  expect(fixture.post).not.toHaveBeenCalled();
  expect(await db.prepare("SELECT state FROM notification_event_groups WHERE id=?").bind(fixture.group.id).first()).toEqual({ state: "cancelled" });
  expect((await db.prepare("SELECT * FROM notification_event_group_claims").all()).results).toEqual([]);
  expect((await db.prepare("SELECT * FROM notification_scheduler_progress").all()).results).toEqual([]);
});
it("開始後の期限切れをgroupと各候補のunknownへ回復し、送り直さない", async () => {
  const fixture = await queued();
  expect(await beginDailyNotificationGroup(db, principal, fixture.group.id, fixture.leases, fixture.clock.at)).not.toBeNull();
  await db.prepare("UPDATE notification_event_groups SET attempt_expires_at='2000-01-01T00:00:00.000Z'").run();
  await db.prepare("UPDATE notification_outbox SET lease_expires_at='2000-01-01T00:00:00.000Z'").run();
  expect(await runNotificationScheduler(fixture.dependencies)).toEqual({ processed: 1, failed: 0 });
  expect(fixture.post).not.toHaveBeenCalled();
  expect(await db.prepare("SELECT state FROM notification_event_groups WHERE id=?").bind(fixture.group.id).first()).toEqual({ state: "unknown" });
  expect((await db.prepare("SELECT state FROM notification_outbox").all()).results).toEqual([{ state: "unknown" }, { state: "unknown" }]);
});
it("通信開始後のtimeoutは未確定として保存し、次のCronでも自動再送しない", async () => {
  const fixture = await prepared(); fixture.post.mockRejectedValue(new WebhookEndpointError("timeout", true));
  expect(await runNotificationScheduler(fixture.dependencies)).toEqual({ processed: 1, failed: 0 });
  expect(fixture.post).toHaveBeenCalledTimes(1);
  expect((await db.prepare("SELECT state FROM notification_outbox").all()).results).toEqual([{ state: "unknown" }, { state: "unknown" }]);
  fixture.clock.at = new Date(fixture.clock.at.getTime() + 300_001);
  await runNotificationScheduler(fixture.dependencies);
  expect(fixture.post).toHaveBeenCalledTimes(1);
});
it("全親の確保中にCronの世代が変わったら、全件の確保を取り消す", async () => {
  const fixture = await queued(); await release(fixture);
  await seedNotificationSchedule(db, [principal.clientId], fixture.clock.at);
  const schedule = await claimNotificationSchedule(db, fixture.clock.at, [principal.clientId]); if (!schedule) throw new Error("Missing schedule");
  const before = (await db.prepare("SELECT * FROM notification_outbox ORDER BY delivery_id").all()).results;
  const racing = new Proxy(db, { get(target, property) {
    if (property === "batch") return async (statements: D1PreparedStatement[]) => {
      await target.prepare("UPDATE notification_scheduler_progress SET lease_token='new-schedule'").run();
      return target.batch(statements);
    };
    const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
  } });
  await expect(claimScheduledEventWork(racing, principal, schedule, fixture.clock.at)).rejects.toMatchObject({ code: "lease_lost" });
  expect((await db.prepare("SELECT * FROM notification_outbox ORDER BY delivery_id").all()).results).toEqual(before);
});
it("権限縮小後のgroup清掃も、置き換えられたCronでは保存できない", async () => {
  const fixture = await queued(); await release(fixture);
  await seedNotificationSchedule(db, [principal.clientId], fixture.clock.at);
  const schedule = await claimNotificationSchedule(db, fixture.clock.at, [principal.clientId]); if (!schedule) throw new Error("Missing schedule");
  await db.prepare("UPDATE oauth_connections SET scopes='household.read'").run();
  await db.prepare("UPDATE notification_scheduler_progress SET lease_token='new-schedule'").run();
  await expect(reconcileNotificationGroups(db, { ...principal, scopes: ["household.read"] }, schedule, fixture.clock.at, "connection_unavailable")).rejects.toMatchObject({ code: "lease_lost" });
  expect(await db.prepare("SELECT state FROM notification_event_groups WHERE id=?").bind(fixture.group.id).first()).toEqual({ state: "pending" });
  expect((await db.prepare("SELECT * FROM notification_event_group_claims").all()).results).toHaveLength(2);
});
it("購読の失効後は元本文を送らず、宛先の証拠を保って取りやめる", async () => {
  const fixture = await queued(); await release(fixture);
  await db.prepare("UPDATE notification_event_subscriptions SET verified_at='1999-12-31T00:00:00.000Z',expires_at='2000-01-01T00:00:00.000Z'").run();
  expect(await runNotificationScheduler(fixture.dependencies)).toEqual({ processed: 1, failed: 0 });
  expect(fixture.post).not.toHaveBeenCalled();
  expect(await db.prepare("SELECT state,body FROM notification_event_groups WHERE id=?").bind(fixture.group.id).first()).toEqual({ state: "cancelled", body: fixture.group.body });
  expect((await db.prepare("SELECT state FROM notification_event_recipients").all()).results).toEqual([{ state: "cancelled" }, { state: "cancelled" }]);
});
it("購読がまだない間は未送信として待ち、購読後も同じ配信IDを使う", async () => {
  const fixture = await prepared(); await db.prepare("DELETE FROM notification_event_subscriptions").run();
  expect(await runNotificationScheduler(fixture.dependencies)).toEqual({ processed: 1, failed: 0 });
  expect(fixture.post).not.toHaveBeenCalled();
  const ids = (await db.prepare("SELECT delivery_id FROM notification_outbox ORDER BY delivery_id").all()).results;
  expect((await db.prepare("SELECT state,reason FROM notification_outbox").all()).results).toEqual([{ state: "pending", reason: "awaiting_subscription" }, { state: "pending", reason: "awaiting_subscription" }]);
  await fixture.api.subscribe({ name: "attention.ready", delivery: { mode: "webhook", url: "https://receiver.example.com/scheduled/0", secret: `whsec_${btoa("x".repeat(32))}` } });
  fixture.clock.at = new Date(fixture.clock.at.getTime() + 300_001);
  expect(await runNotificationScheduler(fixture.dependencies)).toEqual({ processed: 1, failed: 0 });
  expect(fixture.post).toHaveBeenCalledTimes(1);
  expect((await db.prepare("SELECT delivery_id FROM notification_outbox ORDER BY delivery_id").all()).results).toEqual(ids);
});
it("POST前にCronの確保を失ったら開始を全取消し、新しい世代を上書きしない", async () => {
  const fixture = await queued(); await release(fixture); let replaced = false;
  const inspected = inspectedDatabase(async (sql) => {
    if (!replaced && sql.some((s) => s.includes("UPDATE notification_event_recipients SET state='sending'"))) {
      replaced = true; await db.prepare("UPDATE notification_scheduler_progress SET lease_token='replacement'").run();
    }
  });
  expect(await runNotificationScheduler({ ...fixture.dependencies, db: inspected.database })).toEqual({ processed: 1, failed: 1 });
  expect(replaced).toBe(true); expect(fixture.post).not.toHaveBeenCalled();
  expect((await db.prepare("SELECT state,attempts FROM notification_event_recipients").all()).results).toEqual([{ state: "pending", attempts: 0 }, { state: "pending", attempts: 0 }]);
  expect(await db.prepare("SELECT lease_token FROM notification_scheduler_progress").first()).toEqual({ lease_token: "replacement" });
});
it.each(["daily", "individual"] as const)("%sの最大20購読でも延べ10件ずつ継続し、呼出枠と受領済みを守る", async (mode) => {
  const fixture = await prepared(mode, 10, 20); const inspected = inspectedDatabase();
  const counts = [];
  for (let tick = 0; tick < 2; tick++) {
    const before = inspected.queries();
    expect(await runNotificationScheduler({ ...fixture.dependencies, db: inspected.database })).toEqual({ processed: 1, failed: 0 });
    counts.push(inspected.queries() - before);
    fixture.clock.at = new Date(fixture.clock.at.getTime() + 300_001);
  }
  expect(counts.every((count) => count < 1000), `D1 calls: ${counts.join(",")}`).toBe(true);
  expect(await db.prepare("SELECT count(*) AS count FROM notification_event_recipients WHERE state='accepted'").first()).toEqual({ count: 20 });
  expect(await db.prepare("SELECT count(*) AS count FROM notification_event_recipients WHERE state='pending'").first()).toEqual({ count: 180 });
  expect(fixture.post).toHaveBeenCalledTimes(mode === "daily" ? 2 : 20);
}, 30_000);
it("二つの家庭を定期走査しても、一回のD1呼出枠を超えず両方へ送る", async () => {
  const fixture = await prepared("daily", 10, 20);
  for (let index = 0; index < 15; index++) await createHouseholdAMaintenanceTask(db);
  const other = { ...principal, householdId: "household-b", userId: "user-b", connectionId: "connection-b" };
  await db.prepare(`INSERT INTO oauth_connections(id,household_id,user_id,client_id,client_name,scopes,resource,issuer,user_session_version,created_at,expires_at)
    SELECT 'connection-b','household-b','user-b',client_id,client_name,scopes,resource,issuer,0,created_at,expires_at FROM oauth_connections WHERE id=?`).bind(principal.connectionId).run();
  await saveNotificationSettings(db, householdBMember, { ...DEFAULT_SETTINGS, enabled: true, connectionId: other.connectionId, mode: "daily", digestTime: "00:00", quietEnabled: false }, 0, fixture.clock.at);
  for (let index = 0; index < 25; index++) await createMaintenanceTask(db, householdBMember, { managedItemId: "item-b", title: `B maintenance ${index}`,
    firstDueAt: "2026-08-10T15:00:00.000Z", firstScheduledFor: "2026-08-01T15:00:00.000Z", recommendedStartOffset: 1, recommendedUntilOffset: 2 });
  const api = createEventSubscriptionService({ db, authorize: async () => other, secret: fixture.dependencies.events.secret, providerId: "test",
    transport: { post: async (_url, request) => Response.json(JSON.parse(request.body) as unknown) } });
  for (let index = 0; index < 20; index++) await api.subscribe({ name: "attention.ready", delivery: { mode: "webhook", url: `https://receiver.example.com/other/${index}`, secret: `whsec_${btoa("x".repeat(32))}` } });
  const inspected = inspectedDatabase();
  for (let tick = 0; tick < 2; tick++) {
    const before = inspected.queries();
    expect(await runNotificationScheduler({ ...fixture.dependencies, db: inspected.database })).toEqual({ processed: 2, failed: 0 });
    expect(inspected.queries() - before, `D1 calls at tick${tick}: ${inspected.queries() - before}`).toBeLessThan(1000);
    fixture.clock.at = new Date(fixture.clock.at.getTime() + 300_001);
  }
  expect(fixture.post).toHaveBeenCalledTimes(4);
  expect((await db.prepare("SELECT household_id,count(*) AS count FROM notification_event_recipients WHERE state='accepted' GROUP BY household_id ORDER BY household_id").all()).results).toEqual([{ household_id: "household-a", count: 20 }, { household_id: "household-b", count: 20 }]);
  await db.prepare("UPDATE notification_event_subscriptions SET verified_at='1999-12-31T00:00:00.000Z',expires_at='2000-01-01T00:00:00.000Z'").run();
  const beforeCleanup = inspected.queries();
  expect(await runNotificationScheduler({ ...fixture.dependencies, db: inspected.database })).toEqual({ processed: 2, failed: 0 });
  expect(inspected.queries() - beforeCleanup, `cleanup D1 calls: ${inspected.queries() - beforeCleanup}`).toBeLessThan(1000);
  expect(fixture.post).toHaveBeenCalledTimes(4);
  expect((await db.prepare("SELECT household_id,count(*) AS count FROM notification_event_recipients WHERE state='cancelled' GROUP BY household_id ORDER BY household_id").all()).results)
    .toEqual([{ household_id: "household-a", count: 10 }, { household_id: "household-b", count: 10 }]);
}, 30_000);
it.each(["mode_changed", "expired"] as const)("20購読の%sでも一度に全宛先を再照合せず、上限内で次回へ残す", async (reason) => {
  const fixture = await frozenPage();
  if (reason === "mode_changed") await saveNotificationSettings(db, householdAMember, { ...DEFAULT_SETTINGS, enabled: true, connectionId: principal.connectionId,
    mode: "individual", digestTime: "00:00", quietEnabled: false }, 1, fixture.clock.at);
  else await db.prepare("UPDATE notification_event_subscriptions SET verified_at='1999-12-31T00:00:00.000Z',expires_at='2000-01-01T00:00:00.000Z'").run();
  const inspected = inspectedDatabase();
  for (let tick = 0; tick < 2; tick++) {
    const before = inspected.queries();
    expect(await runNotificationScheduler({ ...fixture.dependencies, db: inspected.database })).toEqual({ processed: 1, failed: 0 });
    expect(inspected.queries() - before, `D1 calls: ${inspected.queries() - before}`).toBeLessThan(1000);
    expect(fixture.post).not.toHaveBeenCalled();
    expect(await db.prepare("SELECT count(*) AS count FROM notification_event_recipients WHERE state='cancelled'").first())
      .toEqual({ count: 10 * (tick + 1) });
    expect(await db.prepare("SELECT count(*) AS count FROM notification_event_recipients WHERE state='pending'").first())
      .toEqual({ count: 200 - 10 * (tick + 1) });
    expect(await db.prepare("SELECT count(*) AS count FROM notification_outbox WHERE state IN ('leased','sending')").first()).toEqual({ count: 0 });
    fixture.clock.at = new Date(fixture.clock.at.getTime() + 300_001);
  }
}, 30_000);
it("古い方式の照合と現在方式の送信は同じ延べ10件の枠を共有する", async () => {
  const fixture = await prepared("daily", 2, 10); const leases = [];
  for (const source of fixture.sources) await enqueueNotification(db, principal, source.candidate.candidate_id, fixture.clock.at);
  for (let index = 0; index < 2; index++) {
    if (index === 1) await saveNotificationSettings(db, householdAMember, { ...DEFAULT_SETTINGS, enabled: true, connectionId: principal.connectionId,
      mode: "individual", quietEnabled: false }, 1, fixture.clock.at);
    const lease = await leaseNotification(db, principal, fixture.clock.at); if (!lease) throw new Error("Missing lease");
    await freezeNotificationEvent(db, principal, lease, fixture.clock.at); leases.push(lease);
  }
  for (const lease of leases) await settleNotificationEvent(db, principal, lease, fixture.clock.at);
  expect(await runNotificationScheduler(fixture.dependencies)).toEqual({ processed: 1, failed: 0 });
  expect(fixture.post).not.toHaveBeenCalled();
  expect(await db.prepare("SELECT count(*) AS count FROM notification_event_recipients WHERE state='cancelled'").first()).toEqual({ count: 10 });
  expect(await db.prepare("SELECT count(*) AS count FROM notification_event_recipients WHERE state='pending'").first()).toEqual({ count: 10 });
  expect(await db.prepare("SELECT count(*) AS count FROM notification_outbox WHERE state IN ('leased','sending')").first()).toEqual({ count: 0 });
});
