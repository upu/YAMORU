import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, it } from "vitest";
import { applyAllMigrations } from "./test-support/migrations";
import { notificationPrincipal, resetNotificationFixtures, notificationCandidate } from "./test-support/notifications";
import { householdAMember } from "./test-support/households";
import { addFamilyMember, familyMember, interruptBeforeBatch } from "./test-support/integration-commands";
import { createCommandService } from "../../features/integration/commands/service";
import { createNotificationReader } from "../../features/integration/notifications/service";
import { createAttentionReader } from "../../features/integration/attention/service";
import { DEFAULT_SETTINGS } from "../../features/integration/notifications/contract";
import { saveNotificationSettings, getCandidateControl } from "./notification-settings";
import { completeTask } from "./todos";
import { todoCompleteHandler } from "../../features/integration/commands/todo-complete";
import { canonicalJson, type NormalizedCommand } from "../../features/integration/commands/contract";
import { meaningfulDigestOf } from "../../features/integration/commands/confirmation";
import { enqueueNotification, leaseNotification, beginNotificationSend, finishNotificationSend } from "./notification-outbox";

const db = env.DB;
const principal = { ...notificationPrincipal, scopes: [...notificationPrincipal.scopes, "household.write"] as typeof notificationPrincipal.scopes };
const secret = "fictional-notification-reply-secret-32-bytes";
const commitInput = (p: Record<string, unknown>) => ({ operation_id: p.operation_id, preview_id: p.preview_id, fingerprint: p.fingerprint });
beforeAll(() => applyAllMigrations(db));
beforeEach(() => resetNotificationFixtures(db));
async function fixture(count = 1) {
  const now = new Date();
  await db.prepare("UPDATE oauth_connections SET scopes=scopes||' household.write' WHERE id='connection-a'").run();
  await saveNotificationSettings(db, householdAMember, { ...DEFAULT_SETTINGS, enabled: true, connectionId: principal.connectionId, mode: "individual", quietEnabled: false }, 0, now);
  const sources = [];
  for (let index = 0; index < count; index++) sources.push(await notificationCandidate(db));
  const candidates = await createAttentionReader({ db, now: () => now, authorize: async () => principal, cursorSecret: secret }).attentionGet({ limit: 50 });
  const selected = candidates.candidates.filter((c) => sources.some((s) => s.occurrenceId === c.entity_id));
  const service = createCommandService({ db, now: () => now });
  const p = await service.prepare(principal, { operation_id: crypto.randomUUID(), command: "notification.claim", payload: {
    candidate_ids: selected.map((c) => c.candidate_id), candidate_revisions: Object.fromEntries(selected.map((c) => [c.candidate_id, c.revision])),
  } });
  const claimed = (await service.commit(principal, commitInput(p))).result as { delivery_id: string; lease_token: string; candidates: { candidate_id: string; delivery_id: string }[] };
  expect(claimed.candidates).toHaveLength(count);
  const ack = await service.prepare(principal, { operation_id: crypto.randomUUID(), command: "notification.ack", payload: { delivery_id: claimed.delivery_id, lease_token: claimed.lease_token, outcome: "reported" } });
  await service.commit(principal, commitInput(ack));
  const reference = { delivery_id: claimed.delivery_id, candidate_id: sources[0].candidate.candidate_id };
  const reader = createNotificationReader({ db, now: () => now, authorize: async () => principal, cursorSecret: secret });
  const request = (command = "todo.complete", target = { kind: "todo_occurrence", id: sources[0].occurrenceId }, payload = {}) => ({
    operation_id: crypto.randomUUID(), command, target, payload, notification_reference: reference,
  });
  return { now, sources, service, reader, claimed, reference, request };
}
it("通知の集合から元の回と現在状態を取得し、親の配信IDでも同じ回を返す", async () => {
  const f = await fixture();
  const context = await f.reader.notificationContextGet({ delivery_id: f.claimed.delivery_id });
  expect(context.selection_required).toBe(false);
  expect(context.items[0].source).toMatchObject({ kind: "todo_occurrence", id: f.sources[0].occurrenceId, todo_rule_id: f.sources[0].ruleId });
  expect(context.selected).toMatchObject({ notification_reference: f.reference, entity: { id: f.sources[0].occurrenceId, state: { status: "pending" } } });
  expect(JSON.stringify(context)).not.toMatch(/lease_token|lease_expires_at|callback|ciphertext/);
  const parent = f.claimed.candidates[0].delivery_id;
  expect((await f.reader.notificationContextGet({ delivery_id: parent })).selected?.entity.id).toBe(f.sources[0].occurrenceId);
});
it("明確な完了を一回だけ保存し、同じ操作の再取得・再送は元の結果を返す", async () => {
  const f = await fixture(); const request = f.request();
  const p = await f.service.prepare(principal, request);
  expect(p.confirmation).toMatchObject({ state: "not_needed" });
  expect(p.schedule_effect).toHaveProperty("notification_reference", f.reference);
  const first = await f.service.commit(principal, commitInput(p));
  expect((await f.service.commit(principal, commitInput(p))).result).toEqual(first.result);
  expect((await f.service.get(principal, { operation_id: request.operation_id })).result).toEqual(first.result);
  expect((await f.reader.notificationContextGet(f.reference)).selected?.entity.state.status).toBe("completed");
});
it("通知の延期は本人設定だけを変え、予定変更は元の回の期限だけを変える", async () => {
  const f = await fixture();
  const before = await db.prepare("SELECT due_at,scheduled_for FROM task_occurrences WHERE id=?").bind(f.sources[0].occurrenceId).first();
  const current = await createAttentionReader({ db, now: () => f.now, authorize: async () => principal, cursorSecret: secret }).attentionGet({ candidate_ids: [f.reference.candidate_id] });
  const until = new Date(f.now.getTime() + 86_400_000).toISOString();
  const snooze = await f.service.prepare(principal, f.request("notification.snooze", { kind: "attention_candidate", id: f.reference.candidate_id }, { candidate_id: f.reference.candidate_id, candidate_revision: current.candidates[0].revision, until }));
  await f.service.commit(principal, commitInput(snooze));
  expect((await getCandidateControl(db, principal, f.reference.candidate_id)).snoozedUntil).toBe(until);
  expect(await db.prepare("SELECT due_at,scheduled_for FROM task_occurrences WHERE id=?").bind(f.sources[0].occurrenceId).first()).toEqual(before);
  const later = new Date(f.now.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
  const reschedule = await f.service.prepare(principal, f.request("todo.reschedule", undefined, { new_due_on: later }));
  await f.service.commit(principal, commitInput(reschedule));
  expect((await db.prepare("SELECT due_at,scheduled_for FROM task_occurrences WHERE id=?").bind(f.sources[0].occurrenceId).first())?.scheduled_for).toBe(before?.scheduled_for);
});
it("複数件の通知は自動で一つに絞らず、指定した候補だけを解決する", async () => {
  const f = await fixture(2);
  const all = await f.reader.notificationContextGet({ delivery_id: f.claimed.delivery_id });
  expect(all.selection_required).toBe(true); expect(all.selected).toBeNull(); expect(all.items).toHaveLength(2);
  expect((await f.reader.notificationContextGet(f.reference)).selected?.entity.id).toBe(f.sources[0].occurrenceId);
});
it("期限切れの複数件通知では空の選択を要求せず、対象を選び直す", async () => {
  const f = await fixture(2);
  await db.prepare("UPDATE notification_poll_claims SET terminal_at=?").bind(new Date(f.now.getTime() - 91 * 86_400_000).toISOString()).run();
  const result = await f.reader.notificationContextGet({ delivery_id: f.claimed.delivery_id });
  expect(result.selection_required).toBe(false); expect(result.selected).toBeNull(); expect(result.recovery).toBe("select_current_target");
  expect(result.items.every((item) => item.source === null && item.name === null)).toBe(true);
});
it("複数件のうち一件の詳細が消えても、残った一件へ勝手に絞らない", async () => {
  const f = await fixture(2);
  await db.prepare("DELETE FROM notification_outbox WHERE candidate_id=?").bind(f.sources[0].candidate.candidate_id).run();
  const result = await f.reader.notificationContextGet({ delivery_id: f.claimed.delivery_id });
  expect(result.selection_required).toBe(true); expect(result.selected).toBeNull();
});
it("家族が完了した古い通知は完了済みを返し、生成された次回への操作を拒否する", async () => {
  const f = await fixture(); await addFamilyMember(db);
  const next = await completeTask(db, familyMember, { occurrenceId: f.sources[0].occurrenceId, occurredAt: f.now.toISOString(), performedByUserId: null, idempotencyKey: crypto.randomUUID() });
  expect(next).not.toBeNull();
  if (!next) throw new Error("Expected next occurrence");
  expect((await f.reader.notificationContextGet(f.reference)).selected?.entity).toMatchObject({ id: f.sources[0].occurrenceId, state: { status: "completed" } });
  await expect(f.service.prepare(principal, f.request())).rejects.toMatchObject({ code: "already_resolved" });
  await expect(f.service.prepare(principal, f.request("todo.complete", { kind: "todo_occurrence", id: next }))).rejects.toMatchObject({ code: "not_found" });
  expect((await db.prepare("SELECT status FROM task_occurrences WHERE id=?").bind(next).first())?.status).toBe("pending");
});
it.each(["expired", "deleted"] as const)("%sの通知は対象の選び直しを返し、変更を準備しない", async (kind) => {
  const f = await fixture();
  if (kind === "expired") await db.prepare("UPDATE notification_outbox_sources SET terminal_at=? WHERE entity_id=?").bind(new Date(f.now.getTime() - 91 * 86_400_000).toISOString(), f.sources[0].occurrenceId).run();
  else await db.prepare("DELETE FROM task_rules WHERE id=?").bind(f.sources[0].ruleId).run();
  const result = await f.reader.notificationContextGet(f.reference);
  expect(result.selected).toBeNull(); expect(result.recovery).toBe("select_current_target");
  await expect(f.service.prepare(principal, f.request())).rejects.toMatchObject({ code: "not_found" });
});
it("batch直前にsourceが消えたら業務更新と成功receiptを全取消する", async () => {
  const f = await fixture(); const request = f.request(); const p = await f.service.prepare(principal, request);
  const raced = interruptBeforeBatch(db, async () => { await db.prepare("DELETE FROM notification_outbox_sources").run(); });
  const service = createCommandService({ db: raced, now: () => f.now });
  await expect(service.commit(principal, commitInput(p))).rejects.toMatchObject({ code: "not_found" });
  expect((await db.prepare("SELECT status FROM task_occurrences WHERE id=?").bind(f.sources[0].occurrenceId).first())?.status).toBe("pending");
  expect((await db.prepare("SELECT status FROM integration_operations WHERE operation_id=?").bind(request.operation_id).first())?.status).not.toBe("succeeded");
});
it("通知から昨日の完了・訂正・安全な取消を同じ元の回へ適用する", async () => {
  const f = await fixture();
  const yesterday = new Date(f.now.getTime() - 86_400_000).toISOString();
  const p = await f.service.prepare(principal, f.request("todo.complete", undefined, { occurred_at: yesterday }));
  const result = (await f.service.commit(principal, commitInput(p))).result as { completion_log_id: string; next_occurrence: { id: string }; occurred_at: string };
  expect(result.occurred_at).toBe(yesterday);
  const target = { kind: "completion_log", id: result.completion_log_id };
  const corrected = new Date(f.now.getTime() - 2 * 86_400_000).toISOString();
  const correction = await f.service.prepare(principal, f.request("todo.correct", target, { completion_log_id: target.id, changes: { occurred_at: corrected } }));
  await f.service.commit(principal, commitInput(correction));
  const undo = await f.service.prepare(principal, f.request("todo.undo", target, { completion_log_id: target.id }));
  await f.service.commit(principal, commitInput(undo));
  expect((await f.reader.notificationContextGet(f.reference)).selected?.entity.state.status).toBe("pending");
});
it.each(["todo.correct", "todo.undo"])("%sで同じ家庭の別の完了記録へ通知を転用しない", async (command) => {
  const f = await fixture(2);
  await completeTask(db, householdAMember, { occurrenceId: f.sources[1].occurrenceId, occurredAt: f.now.toISOString(), performedByUserId: null, idempotencyKey: crypto.randomUUID() });
  const log = await db.prepare("SELECT id FROM activity_logs WHERE task_occurrence_id=? AND action='completed'").bind(f.sources[1].occurrenceId).first<{ id: string }>();
  if (!log) throw new Error("Expected another completion");
  const payload = { completion_log_id: log.id, ...(command === "todo.correct" ? { changes: { occurred_at: new Date(f.now.getTime() - 60_000).toISOString() } } : {}) };
  await expect(f.service.prepare(principal, f.request(command, { kind: "completion_log", id: log.id }, payload))).rejects.toMatchObject({ code: "not_found" });
});
it.each(["other_household", "other_user", "other_connection", "other_client"] as const)("%sから本人の通知を読めず、共有Todoへの返答も準備できない", async (kind) => {
  const f = await fixture(); await addFamilyMember(db);
  const other = { ...principal, connectionId: "connection-b", ...(kind === "other_user" ? { userId: familyMember.userId } : {}),
    ...(kind === "other_household" ? { householdId: "household-b", userId: "user-b" } : {}) };
  await db.prepare(`INSERT INTO oauth_connections(id,household_id,user_id,client_id,client_name,scopes,resource,issuer,user_session_version,created_at,expires_at)
    SELECT ?,?,?,client_id,client_name,scopes,resource,issuer,user_session_version,created_at,expires_at FROM oauth_connections WHERE id='connection-a'`)
    .bind(other.connectionId, other.householdId, other.userId).run();
  if (kind === "other_client") other.clientId = "https://other.example.test/client.json";
  const reader = createNotificationReader({ db, now: () => f.now, authorize: async () => other, cursorSecret: secret });
  await expect(reader.notificationContextGet(f.reference)).rejects.toMatchObject({ code: "not_found" });
  await expect(f.service.prepare(other, f.request())).rejects.toMatchObject({ code: "not_found" });
});
it.each(["revoked", "expired", "membership", "session", "scope"] as const)("%s後は通知照合と変更・保存結果の取得を拒否する", async (kind) => {
  const f = await fixture(); const request = f.request(); const p = await f.service.prepare(principal, request);
  if (kind === "revoked") await db.prepare("UPDATE oauth_connections SET revoked_at=?,revoked_reason='user_revoked'").bind(f.now.toISOString()).run();
  if (kind === "expired") await db.prepare("UPDATE oauth_connections SET expires_at=?").bind(new Date(f.now.getTime() - 60_000).toISOString()).run();
  if (kind === "membership") await db.prepare("DELETE FROM household_members WHERE user_id='user-a'").run();
  if (kind === "session") await db.prepare("UPDATE users SET session_version=1 WHERE id='user-a'").run();
  if (kind === "scope") await db.prepare("UPDATE oauth_connections SET scopes='household.read household.write'").run();
  await expect(f.reader.notificationContextGet(f.reference)).rejects.toMatchObject({ code: "not_found" });
  await expect(f.service.commit(principal, commitInput(p))).rejects.toMatchObject({ code: "not_found" });
  await expect(f.service.get(principal, { operation_id: request.operation_id })).rejects.toMatchObject({ code: "not_found" });
  expect((await db.prepare("SELECT status FROM task_occurrences WHERE id=?").bind(f.sources[0].occurrenceId).first())?.status).toBe("pending");
});
it("通知権限だけの接続はスヌーズでき、家庭の変更にはwrite権限を要求する", async () => {
  const f = await fixture();
  const notifyOnly = { ...principal, scopes: ["household.read", "notifications.manage"] as typeof principal.scopes };
  await db.prepare("UPDATE oauth_connections SET scopes='household.read notifications.manage'").run();
  const reader = createNotificationReader({ db, now: () => f.now, authorize: async () => notifyOnly, cursorSecret: secret });
  expect((await reader.notificationContextGet(f.reference)).selected?.entity.id).toBe(f.sources[0].occurrenceId);
  await expect(f.service.prepare(notifyOnly, f.request())).rejects.toMatchObject({ code: "insufficient_scope" });
  const candidate = await createAttentionReader({ db, now: () => f.now, authorize: async () => notifyOnly, cursorSecret: secret }).attentionGet({ candidate_ids: [f.reference.candidate_id] });
  const p = await f.service.prepare(notifyOnly, f.request("notification.snooze", { kind: "attention_candidate", id: f.reference.candidate_id }, {
    candidate_id: f.reference.candidate_id, candidate_revision: candidate.candidates[0].revision, until: new Date(f.now.getTime() + 86_400_000).toISOString(),
  }));
  expect((await f.service.commit(notifyOnly, commitInput(p))).status).toBe("succeeded");
});
it.each(["source_expired", "header_expired", "scope_lost"] as const)("%sがbatch直前でも完了と次回を残さない", async (kind) => {
  const f = await fixture(); const request = f.request(); const p = await f.service.prepare(principal, request);
  const raced = interruptBeforeBatch(db, async () => {
    if (kind === "scope_lost") await db.prepare("UPDATE oauth_connections SET scopes='household.read household.write'").run();
    else if (kind === "header_expired") await db.prepare("UPDATE notification_poll_claims SET terminal_at='2020-01-01T00:00:00.000Z'").run();
    else await db.prepare("UPDATE notification_outbox_sources SET terminal_at='2020-01-01T00:00:00.000Z'").run();
  });
  await expect(createCommandService({ db: raced, now: () => f.now }).commit(principal, commitInput(p))).rejects.toMatchObject({ code: kind === "scope_lost" ? "connection_revoked" : "not_found" });
  expect((await db.prepare("SELECT status FROM task_occurrences WHERE id=?").bind(f.sources[0].occurrenceId).first())?.status).toBe("pending");
  expect((await db.prepare("SELECT count(*) AS n FROM activity_logs WHERE action='completed'").first())?.n).toBe(0);
});
it("旧handlerの再計画は参照付きpreviewと一致せず、rollback時の実行条件を満たさない", async () => {
  const f = await fixture(); const p = await f.service.prepare(principal, f.request());
  const normalized = p.normalized_command as NormalizedCommand;
  const legacyPlan = await todoCompleteHandler.plan({ db, householdId: principal.householdId, userId: principal.userId, principal, now: f.now }, normalized);
  const stored = await db.prepare("SELECT preview FROM integration_operations WHERE operation_id=?").bind(p.operation_id).first<{ preview: string }>();
  expect(canonicalJson(legacyPlan.preview)).not.toBe(stored?.preview);
  expect(legacyPlan.preview.schedule_effect).not.toHaveProperty("notification_reference");
  const withReference = { ...legacyPlan.preview, schedule_effect: { ...legacyPlan.preview.schedule_effect, notification_reference: f.reference } };
  expect(await meaningfulDigestOf(normalized, withReference)).toBe(await meaningfulDigestOf(normalized, legacyPlan.preview));
});
it("消耗品の通知は元の在庫だけを読み、観測・補充・訂正をTodoと混同しない", async () => {
  const f = await fixture();
  await db.prepare("INSERT INTO consumables(id,household_id,name,stock_status) VALUES('reply-stock','household-a','架空の洗剤','low')").run();
  const page = await createAttentionReader({ db, now: () => f.now, authorize: async () => principal, cursorSecret: secret }).attentionGet({ limit: 50 });
  const candidate = page.candidates.find((c) => c.entity_id === "reply-stock");
  if (!candidate) throw new Error("Expected stock candidate");
  const delivery = await enqueueNotification(db, principal, candidate.candidate_id, f.now);
  const lease = await leaseNotification(db, principal, f.now);
  expect(delivery && lease).toBeTruthy();
  if (!delivery || !lease) throw new Error("Expected stock delivery and lease");
  await beginNotificationSend(db, principal, lease, f.now); await finishNotificationSend(db, principal, lease, { kind: "accepted" }, f.now);
  const reference = { delivery_id: delivery.deliveryId, candidate_id: candidate.candidate_id };
  expect((await f.reader.notificationContextGet(reference)).selected?.entity).toMatchObject({ kind: "consumable", id: "reply-stock" });
  const input = { operation_id: crypto.randomUUID(), command: "stock.observe", notification_reference: reference, target: { kind: "consumable", id: "reply-stock" }, payload: { observed_at: f.now.toISOString(), stock_status: "out" } };
  const observed = await f.service.prepare(principal, input); await f.service.commit(principal, commitInput(observed));
  const refill = await f.service.prepare(principal, { ...input, operation_id: crypto.randomUUID(), command: "stock.refill", payload: { refilled_at: f.now.toISOString() } });
  await f.service.commit(principal, commitInput(refill));
  const record = await db.prepare("SELECT id FROM consumable_stock_events WHERE consumable_id='reply-stock' AND kind='refill'").first<{ id: string }>();
  if (!record) throw new Error("Expected refill record");
  const correction = await f.service.prepare(principal, { ...input, operation_id: crypto.randomUUID(), command: "stock.correct", payload: { record_id: record.id, record_revision: 0, changes: { refilled_at: new Date(f.now.getTime() - 60_000).toISOString() } } });
  await f.service.commit(principal, commitInput(correction));
  expect((await db.prepare("SELECT status FROM task_occurrences WHERE id=?").bind(f.sources[0].occurrenceId).first())?.status).toBe("pending");
});
