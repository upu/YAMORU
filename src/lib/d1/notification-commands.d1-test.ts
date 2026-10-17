import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, it } from "vitest";
import { applyAllMigrations } from "./test-support/migrations";
import { notificationNow as now, notificationPrincipal as principal, resetNotificationFixtures, notificationCandidate } from "./test-support/notifications";
import { createCommandService } from "../../features/integration/commands/service";
import { getCandidateControl, getNotificationSettings, saveNotificationSettings } from "./notification-settings";
import { DEFAULT_SETTINGS } from "../../features/integration/notifications/contract";
import { householdAMember } from "./test-support/households";
import { interruptBeforeBatch } from "./test-support/integration-commands";
const db = env.DB;
const service = createCommandService({ db, now: () => now });
beforeAll(() => applyAllMigrations(db));
beforeEach(() => resetNotificationFixtures(db));
function request(patch = {}) { return { operation_id: crypto.randomUUID(), command: "notification.configure", payload: { settings_revision: 0, enabled: true, connection_id: "connection-a", ...patch } }; }
const commitInput = (preview) => ({ operation_id: preview.operation_id, preview_id: preview.preview_id, fingerprint: preview.fingerprint });
it("通知権限だけでprepare/commitでき、同じIDの再送は同じ結果になる", async () => {
  const input = request({ digest_time: "10:00" });
  const preview = await service.prepare(principal, input);
  expect((await getNotificationSettings(db, householdAMember)).revision).toBe(0);
  const first = await service.commit(principal, commitInput(preview));
  expect(preview.diff.after).toMatchObject({ connection_id: "connection-a", digest_time: "10:00", time_zone: "Asia/Tokyo" });
  expect(first.result.settings).not.toHaveProperty("connectionId");
  expect(first).toMatchObject({ status: "succeeded", result: { settings_revision: 1, shared_schedule_changed: false } });
  expect(await service.commit(principal, commitInput(preview))).toMatchObject({ replayed: true, result: first.result });
  expect((await getNotificationSettings(db, householdAMember)).settings.digestTime).toBe("10:00");
  await expect(service.prepare(principal, { ...input, payload: { ...input.payload, digest_time: "11:00" } })).rejects.toMatchObject({ code: "idempotency_conflict" });
});
it("attentionの再取得前に元の内容が変わった候補のrevisionを拒否する", async () => {
  const { candidate, occurrenceId } = await notificationCandidate(db);
  await db.prepare("UPDATE task_occurrences SET rule_snapshot=json_set(rule_snapshot,'$.title','更新後の用事') WHERE id=?").bind(occurrenceId).run();
  await expect(service.prepare(principal, { operation_id: crypto.randomUUID(), command: "notification.snooze", payload: {
    candidate_id: candidate.candidate_id, candidate_revision: candidate.revision, until: "2026-10-18T00:00:00.000Z",
  } })).rejects.toMatchObject({ code: "stale_preview" });
});
it("設定の競合、権限不足、解除と期限切れを拒否し、設定を部分保存しない", async () => {
  await expect(service.prepare({ ...principal, scopes: ["household.read", "household.write"] }, request())).rejects.toMatchObject({ code: "insufficient_scope" });
  const preview = await service.prepare(principal, request());
  await saveNotificationSettings(db, householdAMember, { ...DEFAULT_SETTINGS, digestTime: "12:00" }, 0, now);
  await expect(service.commit(principal, commitInput(preview))).rejects.toMatchObject({ code: "stale_preview" });
  expect((await getNotificationSettings(db, householdAMember)).settings.enabled).toBe(false);
  const again = await service.prepare(principal, request({ settings_revision: 1 }));
  await db.prepare("UPDATE oauth_connections SET revoked_at=?,revoked_reason='user_revoked' WHERE id=?").bind(now.toISOString(), principal.connectionId).run();
  await expect(service.commit(principal, commitInput(again))).rejects.toThrow();
  expect((await getNotificationSettings(db, householdAMember)).revision).toBe(1);
});
it("候補revisionを確認して本人だけスヌーズし、再送や完了済み候補を扱う", async () => {
  const { candidate } = await notificationCandidate(db);
  const input = { operation_id: crypto.randomUUID(), command: "notification.snooze", payload: { candidate_id: candidate.candidate_id, candidate_revision: candidate.revision, until: "2026-10-18T00:00:00.000Z" } };
  const preview = await service.prepare(principal, input);
  expect(preview.normalized_command.payload).toMatchObject({ until: input.payload.until });
  expect(preview.diff.after).toEqual({ muted: false, until: input.payload.until });
  const committed = await service.commit(principal, commitInput(preview));
  expect(committed.result).toMatchObject({ until: input.payload.until });
  expect(committed.result).not.toHaveProperty("snoozedUntil");
  await service.commit(principal, commitInput(preview));
  expect(await getCandidateControl(db, principal, candidate.candidate_id)).toMatchObject({ revision: 1, snoozedUntil: "2026-10-18T00:00:00.000Z" });
  await expect(service.prepare(principal, { ...input, operation_id: crypto.randomUUID(), payload: { ...input.payload, candidate_revision: "old" } })).rejects.toMatchObject({ code: "stale_preview" });
});
it("SQL実行直前の設定変更・接続解除でも、個人設定とreceiptを一緒に取り消す", async () => {
  const preview = await service.prepare(principal, request());
  const interrupted = createCommandService({ now: () => now, db: interruptBeforeBatch(db, async () => {
    await saveNotificationSettings(db, householdAMember, { ...DEFAULT_SETTINGS, digestTime: "13:00" }, 0, now);
  }) });
  await expect(interrupted.commit(principal, commitInput(preview))).rejects.toMatchObject({ code: "stale_preview" });
  expect((await getNotificationSettings(db, householdAMember)).settings).toMatchObject({ enabled: false, digestTime: "13:00" });
  const again = await service.prepare(principal, request({ settings_revision: 1 }));
  const revoked = createCommandService({ now: () => now, db: interruptBeforeBatch(db, async () => {
    await db.prepare("UPDATE oauth_connections SET revoked_at=?,revoked_reason='user_revoked' WHERE id=?").bind(now.toISOString(), principal.connectionId).run();
  }) });
  await expect(revoked.commit(principal, commitInput(again))).rejects.toMatchObject({ code: "connection_revoked" });
  expect((await getNotificationSettings(db, householdAMember)).revision).toBe(1);
});
it("通知先を変更しない操作でも、呼び出した接続の期限切れを拒否する", async () => {
  const preview = await service.prepare(principal, request({ enabled: false, connection_id: null }));
  await db.prepare("UPDATE oauth_connections SET expires_at=? WHERE id=?").bind(now.toISOString(), principal.connectionId).run();
  await expect(service.commit(principal, commitInput(preview))).rejects.toMatchObject({ code: "connection_revoked" });
  expect((await getNotificationSettings(db, householdAMember)).revision).toBe(0);
});
