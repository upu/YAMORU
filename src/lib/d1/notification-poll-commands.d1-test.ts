import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, it } from "vitest";
import { applyAllMigrations } from "./test-support/migrations";
import { notificationCandidate, notificationPrincipal, resetNotificationFixtures } from "./test-support/notifications";
import { createHouseholdAMaintenanceTask, householdAMember, householdBMember } from "./test-support/households";
import { createMaintenanceTask } from "./todos";
import { refreshAttention } from "./attention";
import { readHouseholdVersion } from "./conversation-read";
import { interruptBeforeBatch } from "./test-support/integration-commands";
import { createCommandService } from "../../features/integration/commands/service";
import { DEFAULT_SETTINGS } from "../../features/integration/notifications/contract";
import { saveNotificationSettings } from "./notification-settings";
import { runNotificationScheduler } from "../../features/integration/notifications/scheduler";
import { beginNotificationSend, enqueueNotification, finishNotificationSend, leaseNotification } from "./notification-outbox";
import { createAttentionReader } from "../../features/integration/attention/service";
import { pruneNotificationPollClaims } from "./notification-poll-recovery";
import { recoverNotificationPollClaims } from "./notification-poll-recovery";
import { claimNotificationSchedule, seedNotificationSchedule } from "./notification-scheduler";
const db = env.DB;
const principal = { ...notificationPrincipal, scopes: ["household.read", "events.subscribe"] as typeof notificationPrincipal.scopes };
type Claim = { delivery_id: string; lease_token: string; lease_expires_at: string; candidates: { candidate_id: string; delivery_id: string }[]; skipped_reasons: { candidate_id: string; reason: string }[] };
beforeAll(() => applyAllMigrations(db));
beforeEach(() => resetNotificationFixtures(db));
async function bulkSources(count: number, now: Date) {
  const tasks = [];
  for (let index = 0; index < count; index++) tasks.push(await createHouseholdAMaintenanceTask(db));
  const page = await createAttentionReader({ db, authorize: async () => principal, now: () => now, cursorSecret: "fictional-poll-cursor-secret-at-least-32-bytes" }).attentionGet({ limit: 50 });
  return tasks.map((task) => {
    const candidate = page.candidates.find((c) => c.entity_id === task.occurrenceId); if (!candidate) throw new Error("Missing candidate");
    return { ...task, candidate };
  });
}
async function fixture(count = 2) {
  const now = new Date();
  await saveNotificationSettings(db, householdAMember, { ...DEFAULT_SETTINGS, enabled: true, connectionId: principal.connectionId, quietEnabled: false }, 0, now);
  const sources = [];
  if (count <= 20) for (let index = 0; index < count; index++) sources.push(await notificationCandidate(db));
  else sources.push(...await bulkSources(count, now));
  const service = createCommandService({ db, now: () => now });
  const payload = { candidate_ids: sources.map((s) => s.candidate.candidate_id), candidate_revisions: Object.fromEntries(sources.map((s) => [s.candidate.candidate_id, s.candidate.revision])) };
  return { now, sources, service, payload };
}
const commitInput = (prepared: Record<string, unknown>) => ({ operation_id: prepared.operation_id, preview_id: prepared.preview_id, fingerprint: prepared.fingerprint });
async function claim(f: Awaited<ReturnType<typeof fixture>>) {
  const prepared = await f.service.prepare(principal, { command: "notification.claim", operation_id: crypto.randomUUID(), payload: f.payload });
  return (await f.service.commit(principal, commitInput(prepared))).result as Claim;
}
async function ack(f: Awaited<ReturnType<typeof fixture>>, c: Claim, outcome: "reported" | "unknown") {
  const prepared = await f.service.prepare(principal, { command: "notification.ack", operation_id: crypto.randomUUID(), payload: { delivery_id: c.delivery_id, lease_token: c.lease_token, outcome } });
  return f.service.commit(principal, commitInput(prepared));
}
it("prepareでは確保せず、commitで同じ集合を5分確保し、再送は元の結果を返す", async () => {
  const f = await fixture();
  const prepared = await f.service.prepare(principal, { command: "notification.claim", operation_id: crypto.randomUUID(), payload: f.payload });
  expect(await db.prepare("SELECT count(*) AS n FROM notification_outbox").first()).toEqual({ n: 0 });
  expect(await db.prepare("SELECT count(*) AS n FROM notification_poll_claims").first()).toEqual({ n: 0 });
  const first = await f.service.commit(principal, commitInput(prepared)); const c = first.result as Claim;
  expect(c.candidates).toHaveLength(2); expect(c.skipped_reasons).toEqual([]);
  expect(c.lease_expires_at).toBe(new Date(f.now.getTime() + 300_000).toISOString());
  expect((await db.prepare("SELECT state FROM notification_outbox").all()).results).toEqual([{ state: "sending" }, { state: "sending" }]);
  expect((await f.service.commit(principal, commitInput(prepared))).result).toEqual(first.result);
});
it.each(["reported", "unknown"] as const)("%sの報告を全親と履歴へ一括保存し、重複ackは同じ結果、別outcomeは競合する", async (outcome) => {
  const f = await fixture(); const c = await claim(f);
  const first = await ack(f, c, outcome); const second = await ack(f, c, outcome);
  expect(second.result).toEqual(first.result);
  expect((await db.prepare("SELECT outcome FROM notification_delivery_marks").all()).results).toEqual([{ outcome }, { outcome }]);
  expect((await db.prepare("SELECT state FROM notification_outbox").all()).results).toEqual([{ state: outcome }, { state: outcome }]);
  await expect(ack(f, c, outcome === "reported" ? "unknown" : "reported")).rejects.toMatchObject({ code: "already_resolved" });
});
it("他の確保とEvent固定済みを横取りせず、全件見送りも業務状態を変えない", async () => {
  const f = await fixture(); const c = await claim(f);
  const another = await claim(f); expect(another.candidates).toEqual([]); expect(another.delivery_id).toBeNull();
  expect(another.skipped_reasons).toHaveLength(2);
  expect((await db.prepare("SELECT lease_token FROM notification_outbox").all()).results).toEqual([{ lease_token: c.lease_token }, { lease_token: c.lease_token }]);
});
it("pendingの配信IDを保ち、候補のrevision不一致と解消を見送る", async () => {
  const f = await fixture(); const old = await enqueueNotification(db, principal, f.payload.candidate_ids[0], f.now);
  f.payload.candidate_revisions[f.payload.candidate_ids[1]] = "stale";
  const c = await claim(f); expect(c.candidates).toEqual([expect.objectContaining({ delivery_id: old?.deliveryId, candidate_id: f.payload.candidate_ids[0] })]);
  expect(c.skipped_reasons).toEqual([{ candidate_id: f.payload.candidate_ids[1], reason: "stale_candidate" }]);
});
it("prepare後に家族が完了したら、部分確保を残さず古いpreviewを拒否する", async () => {
  const f = await fixture(); const p = await f.service.prepare(principal, { command: "notification.claim", operation_id: crypto.randomUUID(), payload: f.payload });
  await db.prepare("UPDATE task_occurrences SET status='completed' WHERE id=?").bind(f.sources[1].occurrenceId).run();
  await expect(f.service.commit(principal, commitInput(p))).rejects.toMatchObject({ code: "stale_preview" });
  expect(await db.prepare("SELECT count(*) AS n FROM notification_outbox").first()).toEqual({ n: 0 });
});
it("最後の文の失敗では確保・source・受付成功を全取消する", async () => {
  const f = await fixture(); const p = await f.service.prepare(principal, { command: "notification.claim", operation_id: crypto.randomUUID(), payload: f.payload });
  const broken = new Proxy(db, { get(target, property) {
    if (property === "batch") return (statements: D1PreparedStatement[]) => target.batch([...statements, target.prepare("INSERT INTO attention_guards(id,valid) VALUES('forced-poll-rollback',0)")]);
    const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
  } });
  await expect(createCommandService({ db: broken, now: () => f.now }).commit(principal, commitInput(p))).rejects.toMatchObject({ code: "temporarily_unavailable" });
  for (const table of ["notification_outbox", "notification_outbox_sources", "notification_poll_claims"]) expect(await db.prepare(`SELECT count(*) AS n FROM ${table}`).first()).toEqual({ n: 0 });
  expect((await f.service.get(principal, { operation_id: p.operation_id })).status).toBe("prepared");
});
it("二件目の親を別処理が確保したら、先行する親の確保も全取消する", async () => {
  const f = await fixture();
  for (const id of f.payload.candidate_ids) await enqueueNotification(db, principal, id, f.now);
  const rows = (await db.prepare("SELECT * FROM notification_outbox ORDER BY delivery_id").all<{ delivery_id: string }>()).results;
  const p = await f.service.prepare(principal, { command: "notification.claim", operation_id: crypto.randomUUID(), payload: f.payload });
  const racing = interruptBeforeBatch(db, async () => { await db.prepare("UPDATE notification_outbox SET state='leased',lease_token='other',lease_expires_at=?,revision=revision+1 WHERE delivery_id=?")
    .bind(new Date(f.now.getTime() + 300_000).toISOString(), rows[1].delivery_id).run(); });
  await expect(createCommandService({ db: racing, now: () => f.now }).commit(principal, commitInput(p))).rejects.toMatchObject({ code: "stale_preview" });
  expect(await db.prepare("SELECT count(*) AS n FROM notification_poll_claims").first()).toEqual({ n: 0 });
  expect(await db.prepare("SELECT * FROM notification_outbox WHERE delivery_id=?").bind(rows[0].delivery_id).first()).toEqual(rows[0]);
});
it("通知設定権限だけのprepare/commit/getを拒否し、batch直前のscope縮小も拒否する", async () => {
  const f = await fixture(); const manage = { ...principal, scopes: ["household.read", "notifications.manage"] as typeof principal.scopes };
  await expect(f.service.prepare(manage, { command: "notification.claim", operation_id: crypto.randomUUID(), payload: f.payload })).rejects.toMatchObject({ code: "insufficient_scope" });
  const p = await f.service.prepare(principal, { command: "notification.claim", operation_id: crypto.randomUUID(), payload: f.payload });
  await expect(f.service.commit(manage, commitInput(p))).rejects.toMatchObject({ code: "insufficient_scope" });
  await expect(f.service.get(manage, { operation_id: p.operation_id })).rejects.toMatchObject({ code: "insufficient_scope" });
  const racing = interruptBeforeBatch(db, async () => { await db.prepare("UPDATE oauth_connections SET scopes='household.read notifications.manage'").run(); });
  await expect(createCommandService({ db: racing, now: () => f.now }).commit(principal, commitInput(p))).rejects.toMatchObject({ code: "connection_revoked" });
  expect(await db.prepare("SELECT count(*) AS n FROM notification_outbox").first()).toEqual({ n: 0 });
});
it("ackで別接続・別本人・別家庭・違うtokenを受け付けない", async () => {
  const f = await fixture(); const c = await claim(f);
  for (const bad of [{ ...principal, connectionId: "different" }, { ...principal, userId: "user-b" }, { ...principal, householdId: "household-b" }, { ...principal, clientId: "different" }]) {
    await expect(f.service.prepare(bad, { command: "notification.ack", operation_id: crypto.randomUUID(), payload: { delivery_id: c.delivery_id, lease_token: c.lease_token, outcome: "reported" } })).rejects.toMatchObject({ code: "not_found" });
  }
  await expect(ack(f, { ...c, lease_token: "wrong" }, "reported")).rejects.toMatchObject({ code: "not_found" });
});
it("期限切れはCronでunknownに回復し、古いreportedで上書きも自動再確保もしない", async () => {
  const f = await fixture(); const c = await claim(f);
  await db.prepare("UPDATE notification_poll_claims SET created_at='1999-01-01T00:00:00.000Z',lease_expires_at='2000-01-01T00:00:00.000Z'").run();
  await db.prepare("UPDATE notification_outbox SET lease_expires_at='2000-01-01T00:00:00.000Z'").run();
  expect(await runNotificationScheduler({ db, allowedClientIds: [principal.clientId], now: () => f.now })).toEqual({ processed: 1, failed: 0 });
  expect(await db.prepare("SELECT state FROM notification_poll_claims").first()).toEqual({ state: "unknown" });
  await expect(ack(f, c, "reported")).rejects.toMatchObject({ code: "already_resolved" });
  expect((await claim(f)).candidates).toEqual([]);
});
it("51件・重複ID・対応しないrevision辞書は入力全体を拒否する", async () => {
  const f = await fixture();
  for (const payload of [{ ...f.payload, candidate_ids: Array.from({ length: 51 }, (_, i) => `candidate-${i}`) }, { ...f.payload, candidate_ids: [f.payload.candidate_ids[0], f.payload.candidate_ids[0]] }, { ...f.payload, candidate_revisions: {} }]) {
    await expect(f.service.prepare(principal, { command: "notification.claim", operation_id: crypto.randomUUID(), payload })).rejects.toMatchObject({ code: "invalid_input" });
  }
});
it("Eventの固定本文がある親を定期取得へ切り替えない", async () => {
  const f = await fixture(1); await enqueueNotification(db, principal, f.payload.candidate_ids[0], f.now);
  const lease = await leaseNotification(db, principal, f.now); if (!lease) throw new Error("Missing lease");
  // 購読がない場合も、固定済みの履歴がある状態を明示的に作る。
  await db.prepare(`INSERT INTO notification_event_batches(delivery_id,household_id,user_id,connection_id,event_id,body,frozen_at)
    VALUES(?,'household-a','user-a','connection-a','evt_fixed','{}',?)`).bind(lease.deliveryId, f.now.toISOString()).run();
  await db.prepare("UPDATE notification_outbox SET state='pending',lease_token=NULL,lease_expires_at=NULL").run();
  const c = await claim(f); expect(c.candidates).toEqual([]); expect(c.skipped_reasons[0].reason).toBe("event_delivery");
});
it("既知の失敗で停止した配信を、処理中と区別して案内し新しいIDで再確保しない", async () => {
  const f = await fixture(1); await enqueueNotification(db, principal, f.payload.candidate_ids[0], f.now);
  const lease = await leaseNotification(db, principal, f.now); if (!lease) throw new Error("Missing lease");
  await beginNotificationSend(db, principal, lease, f.now); await finishNotificationSend(db, principal, lease, { kind: "failed" }, f.now);
  const c = await claim(f); expect(c.candidates).toEqual([]);
  expect(c.skipped_reasons).toEqual([{ candidate_id: f.payload.candidate_ids[0], reason: "delivery_failed" }]);
  expect((await db.prepare("SELECT delivery_id,state FROM notification_outbox").all()).results).toEqual([{ delivery_id: lease.deliveryId, state: "failed" }]);
});
it("50件を一括で確保・報告し、家庭の予定と元の作成日時を保持する", async () => {
  const f = await fixture(50); const original = (await db.prepare("SELECT * FROM task_occurrences ORDER BY id").all()).results;
  const c = await claim(f); expect(c.candidates).toHaveLength(50);
  await ack(f, c, "reported");
  expect(await db.prepare("SELECT count(*) AS n FROM notification_delivery_marks WHERE outcome='reported'").first()).toEqual({ n: 50 });
  expect((await db.prepare("SELECT * FROM task_occurrences ORDER BY id").all()).results).toEqual(original);
  expect(await db.prepare("SELECT created_at FROM notification_poll_claims").first()).toEqual({ created_at: f.now.toISOString() });
}, 30_000);
it("他家庭の実在する候補は不可視とする", async () => {
  const f = await fixture();
  await createMaintenanceTask(db, householdBMember, { managedItemId: "item-b", title: "B fixture", firstDueAt: "2026-08-10T15:00:00.000Z", firstScheduledFor: "2026-08-01T15:00:00.000Z", recommendedStartOffset: 1, recommendedUntilOffset: 2 });
  await refreshAttention(db, "household-b", await readHouseholdVersion(db, "household-b"), f.now, "");
  const foreign = await db.prepare("SELECT id,revision FROM attention_candidates WHERE household_id='household-b'").first<{ id: string; revision: number }>(); if (!foreign) throw new Error("Missing B candidate");
  f.payload.candidate_ids.push(foreign.id); f.payload.candidate_revisions[foreign.id] = JSON.stringify([1, foreign.id, foreign.revision]);
  const c = await claim(f); expect(c.skipped_reasons).toContainEqual({ candidate_id: foreign.id, reason: "candidate_resolved" });
});
it("静かな時間には確保せず、期限を前倒ししない", async () => {
  const f = await fixture(1);
  const hour = f.now.toLocaleString("en-US", { timeZone: "Asia/Tokyo", hour: "2-digit", hour12: false });
  const start = `${String(Number(hour) % 24).padStart(2, "0")}:00`; const end = `${String((Number(hour) + 1) % 24).padStart(2, "0")}:00`;
  await saveNotificationSettings(db, householdAMember, { ...DEFAULT_SETTINGS, enabled: true, connectionId: principal.connectionId, quietEnabled: true, quietStart: start, quietEnd: end }, 1, f.now);
  const c = await claim(f);
  expect(c.candidates).toEqual([]); expect(c.skipped_reasons[0].reason).toBe("scheduled_or_quiet");
  expect(await db.prepare("SELECT count(*) AS n FROM notification_outbox").first()).toEqual({ n: 0 });
});
it.each(["disabled", "revoked", "session"] as const)("ackの%sをprepare時とcommit直前で拒否する", async (kind) => {
  const f = await fixture(); const c = await claim(f);
  const request = { command: "notification.ack", operation_id: crypto.randomUUID(), payload: { delivery_id: c.delivery_id, lease_token: c.lease_token, outcome: "reported" } };
  const p = await f.service.prepare(principal, request);
  const change = async () => {
    if (kind === "disabled") await saveNotificationSettings(db, householdAMember, { ...DEFAULT_SETTINGS, enabled: false }, 1, f.now);
    if (kind === "revoked") await db.prepare("UPDATE oauth_connections SET revoked_at=?,revoked_reason='user_revoked'").bind(f.now.toISOString()).run();
    if (kind === "session") await db.prepare("UPDATE users SET session_version=session_version+1 WHERE id=?").bind(principal.userId).run();
  };
  const racing = interruptBeforeBatch(db, change);
  const code = kind === "disabled" ? "invalid_input" : "connection_revoked";
  await expect(createCommandService({ db: racing, now: () => f.now }).commit(principal, commitInput(p))).rejects.toMatchObject({ code });
  await expect(f.service.prepare(principal, { ...request, operation_id: crypto.randomUUID() })).rejects.toMatchObject({ code });
  expect(await db.prepare("SELECT count(*) AS n FROM notification_delivery_marks").first()).toEqual({ n: 0 });
  expect(await db.prepare("SELECT state FROM notification_poll_claims").first()).toEqual({ state: "claimed" });
});
it("ackの二件目が別世代になった競合では、先行する結果・履歴も全取消する", async () => {
  const f = await fixture(); const c = await claim(f);
  const p = await f.service.prepare(principal, { command: "notification.ack", operation_id: crypto.randomUUID(), payload: { delivery_id: c.delivery_id, lease_token: c.lease_token, outcome: "reported" } });
  const racing = interruptBeforeBatch(db, async () => { await db.prepare("UPDATE notification_outbox SET lease_token='new-owner',revision=revision+1 WHERE delivery_id=?").bind(c.candidates[1].delivery_id).run(); });
  await expect(createCommandService({ db: racing, now: () => f.now }).commit(principal, commitInput(p))).rejects.toMatchObject({ code: "already_resolved" });
  expect(await db.prepare("SELECT count(*) AS n FROM notification_delivery_marks").first()).toEqual({ n: 0 });
  expect((await db.prepare("SELECT state FROM notification_outbox").all()).results).toEqual([{ state: "sending" }, { state: "sending" }]);
});
it("途中失敗したackは元の確保と未成功の受付を保持し、同じ操作で再試行できる", async () => {
  const f = await fixture(); const c = await claim(f);
  const p = await f.service.prepare(principal, { command: "notification.ack", operation_id: crypto.randomUUID(), payload: { delivery_id: c.delivery_id, lease_token: c.lease_token, outcome: "reported" } });
  const guard = db.prepare("INSERT INTO attention_guards(id,valid) VALUES('ack-failure',0)");
  await expect(createCommandService({ db, now: () => f.now, commitGuard: guard }).commit(principal, commitInput(p))).rejects.toMatchObject({ code: "temporarily_unavailable" });
  expect(await db.prepare("SELECT count(*) AS n FROM notification_delivery_marks").first()).toEqual({ n: 0 });
  expect(await f.service.commit(principal, commitInput(p))).toMatchObject({ status: "succeeded" });
});
it("終端から90日後に100件ずつ確保表だけを削除し、最小配信証拠を保つ", async () => {
  const f = await fixture(1); const c = await claim(f); await ack(f, c, "unknown");
  const old = new Date(f.now.getTime() - 91 * 86_400_000).toISOString();
  await db.prepare("UPDATE notification_poll_claims SET terminal_at=?").bind(old).run();
  await db.prepare(`INSERT INTO notification_poll_claims(id,household_id,user_id,connection_id,state,item_count,idempotency_key,created_at,terminal_at)
    WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<100)
    SELECT 'empty-'||i,'household-a','user-a','connection-a','empty',0,'old-empty-'||i,?,? FROM n`).bind(old, old).run();
  await pruneNotificationPollClaims(db, f.now);
  expect(await db.prepare("SELECT count(*) AS n FROM notification_poll_claims").first()).toEqual({ n: 1 });
  expect(await db.prepare("SELECT count(*) AS n FROM notification_delivery_marks WHERE outcome='unknown'").first()).toEqual({ n: 1 });
});
it("親がなくscopeを失った確保も現在のCronだけでunknownへ回収する", async () => {
  const f = await fixture(); await claim(f);
  await db.prepare("UPDATE notification_poll_claims SET created_at='1999-01-01T00:00:00.000Z',lease_expires_at='2000-01-01T00:00:00.000Z'").run();
  await db.prepare("DELETE FROM notification_outbox").run();
  await db.prepare("UPDATE oauth_connections SET scopes='household.read'").run();
  await seedNotificationSchedule(db, [principal.clientId], f.now);
  const lease = await claimNotificationSchedule(db, f.now, [principal.clientId]); if (!lease) throw new Error("Missing maintenance lease");
  await db.prepare("UPDATE notification_scheduler_progress SET lease_token='replacement'").run();
  await expect(recoverNotificationPollClaims(db, { ...principal, scopes: ["household.read"] }, lease, f.now)).rejects.toMatchObject({ code: "lease_lost" });
  expect(await db.prepare("SELECT state FROM notification_poll_claims").first()).toEqual({ state: "claimed" });
  await db.prepare("UPDATE notification_scheduler_progress SET lease_token=NULL,lease_expires_at=NULL").run();
  expect(await runNotificationScheduler({ db, allowedClientIds: [principal.clientId], now: () => f.now })).toEqual({ processed: 1, failed: 0 });
  expect(await db.prepare("SELECT state,item_count FROM notification_poll_claims").first()).toEqual({ state: "unknown", item_count: 2 });
  expect((await db.prepare("SELECT * FROM notification_scheduler_progress").all()).results).toEqual([]);
});
it("既知のackはlease期限後も元の結果を返し、日時や履歴を作り直さない", async () => {
  const f = await fixture(1); const c = await claim(f); const first = await ack(f, c, "reported");
  const before = (await db.prepare("SELECT * FROM notification_delivery_marks").all()).results;
  const service = createCommandService({ db, now: () => new Date(f.now.getTime() + 600_000) });
  const p = await service.prepare(principal, { command: "notification.ack", operation_id: crypto.randomUUID(), payload: { delivery_id: c.delivery_id, lease_token: c.lease_token, outcome: "reported" } });
  expect((await service.commit(principal, commitInput(p))).result).toEqual(first.result);
  expect((await db.prepare("SELECT * FROM notification_delivery_marks").all()).results).toEqual(before);
});
