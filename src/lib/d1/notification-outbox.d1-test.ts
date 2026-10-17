import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, it } from "vitest";
import { applyAllMigrations } from "./test-support/migrations";
import { resetNotificationFixtures, notificationCandidate, notificationPrincipal as principal } from "./test-support/notifications";
import { householdAMember } from "./test-support/households";
import { DEFAULT_SETTINGS } from "../../features/integration/notifications/contract";
import { saveNotificationSettings, setCandidateControl } from "./notification-settings";
import { listDeliveries } from "./notification-deliveries";
import { enqueueNotification, leaseNotification, beginNotificationSend, finishNotificationSend, recoverNotificationLeases, reconcilePendingNotifications } from "./notification-outbox";

const db = env.DB;
const now = () => new Date();
async function requiredLease() {
  const lease = await leaseNotification(db, principal, now());
  if (!lease) throw new Error("Expected a notification lease");
  return lease;
}
beforeAll(() => applyAllMigrations(db));
beforeEach(() => resetNotificationFixtures(db));
async function enabled() {
  await saveNotificationSettings(db, householdAMember, { ...DEFAULT_SETTINGS, enabled: true, connectionId: principal.connectionId, mode: "individual", quietEnabled: false }, 0, now());
  return notificationCandidate(db);
}
it("並列走査でも同じ候補の有効な配信IDは一つで、leaseの確保も一つだけ", async () => {
  const { candidate } = await enabled();
  await Promise.all(Array.from({ length: 3 }, () => enqueueNotification(db, principal, candidate.candidate_id, now())));
  expect((await db.prepare("SELECT * FROM notification_outbox").all()).results).toHaveLength(1);
  const leases = await Promise.all(Array.from({ length: 3 }, () => leaseNotification(db, principal, now())));
  expect(leases.filter(Boolean)).toHaveLength(1);
});
it("scope・本人・家庭・接続元の違う要求から確保できない", async () => {
  const { candidate } = await enabled();
  await expect(enqueueNotification(db, { ...principal, scopes: ["household.read", "notifications.manage"] }, candidate.candidate_id, now())).rejects.toMatchObject({ code: "insufficient_scope" });
  for (const changed of [{ userId: "user-outsider" }, { householdId: "household-b" }, { clientId: "https://other.example.test" }]) {
    await expect(enqueueNotification(db, { ...principal, ...changed }, candidate.candidate_id, now())).rejects.toThrow();
  }
  expect((await db.prepare("SELECT * FROM notification_outbox").all()).results).toEqual([]);
});
it("確保後に家族が完了した候補を送信せず、取消理由を残す", async () => {
  const { candidate, occurrenceId } = await enabled();
  await enqueueNotification(db, principal, candidate.candidate_id, now());
  const lease = await requiredLease();
  await db.prepare("UPDATE task_occurrences SET status='completed' WHERE id=?").bind(occurrenceId).run();
  expect(await beginNotificationSend(db, principal, lease, now())).toMatchObject({ state: "suppressed", reason: "candidate_resolved" });
  expect((await listDeliveries(db, householdAMember, {}, now())).items[0].outcome).toBe("suppressed");
});
it("確保後のスヌーズは同じ配信IDをpendingへ戻し、回数を増やさない", async () => {
  const { candidate } = await enabled();
  await enqueueNotification(db, principal, candidate.candidate_id, now());
  const lease = await requiredLease();
  const until = new Date(Date.now() + 3_600_000).toISOString();
  await setCandidateControl(db, householdAMember, candidate.candidate_id, { muted: false, snoozedUntil: until }, now());
  expect(await beginNotificationSend(db, principal, lease, now())).toMatchObject({ state: "pending", reason: "snoozed" });
  expect(await db.prepare("SELECT delivery_id,attempts,next_attempt_at FROM notification_outbox").first()).toEqual({ delivery_id: lease.deliveryId, attempts: 0, next_attempt_at: until });
});
it("送信前の期限切れleaseは回収でき、古い世代は送信できない", async () => {
  const { candidate } = await enabled();
  await enqueueNotification(db, principal, candidate.candidate_id, now());
  const old = await requiredLease();
  await db.prepare("UPDATE notification_outbox SET lease_expires_at='2000-01-01T00:00:00.000Z'").run();
  await recoverNotificationLeases(db, principal, now());
  const next = await requiredLease();
  expect(next.deliveryId).toBe(old.deliveryId);
  expect(next.leaseToken).not.toBe(old.leaseToken);
  await expect(beginNotificationSend(db, principal, old, now())).rejects.toMatchObject({ code: "lease_lost" });
  expect(await beginNotificationSend(db, principal, next, now())).toMatchObject({ state: "sending" });
});
it("送信中の中断はunknownと履歴を原子的に保存し、自動再送しない", async () => {
  const { candidate } = await enabled();
  await enqueueNotification(db, principal, candidate.candidate_id, now());
  const lease = await requiredLease();
  await beginNotificationSend(db, principal, lease, now());
  await db.prepare("UPDATE notification_outbox SET lease_expires_at='2000-01-01T00:00:00.000Z'").run();
  await recoverNotificationLeases(db, principal, now());
  expect((await listDeliveries(db, householdAMember, {}, now())).items[0].outcome).toBe("unknown");
  expect(await leaseNotification(db, principal, now())).toBeNull();
  await enqueueNotification(db, principal, candidate.candidate_id, now());
  expect((await db.prepare("SELECT * FROM notification_outbox").all()).results).toHaveLength(1);
  await expect(finishNotificationSend(db, principal, lease, { kind: "accepted" }, now())).rejects.toMatchObject({ code: "lease_lost" });
});
it("既知の一時失敗は同じ配信IDでbackoffし、上限到達で終了する", async () => {
  const { candidate } = await enabled();
  await enqueueNotification(db, principal, candidate.candidate_id, now());
  const lease = await requiredLease();
  await beginNotificationSend(db, principal, lease, now());
  await finishNotificationSend(db, principal, lease, { kind: "retry", reason: "http_503" }, now());
  expect(await db.prepare("SELECT state,attempts FROM notification_outbox").first()).toEqual({ state: "retry_wait", attempts: 1 });
  expect(await leaseNotification(db, principal, now())).toBeNull();
  await db.prepare("UPDATE notification_outbox SET attempts=7,next_attempt_at='2000-01-01T00:00:00.000Z'").run();
  const last = await requiredLease();
  await beginNotificationSend(db, principal, last, now());
  await finishNotificationSend(db, principal, last, { kind: "retry", reason: "http_503" }, now());
  expect(await db.prepare("SELECT state,attempts FROM notification_outbox").first()).toEqual({ state: "failed", attempts: 8 });
  await enqueueNotification(db, principal, candidate.candidate_id, now());
  expect((await db.prepare("SELECT * FROM notification_outbox").all()).results).toHaveLength(1);
});
it("受領結果は解除と競合しても記録し、別結果や古い処理で上書きしない", async () => {
  const { candidate } = await enabled();
  await enqueueNotification(db, principal, candidate.candidate_id, now());
  const lease = await requiredLease();
  await beginNotificationSend(db, principal, lease, now());
  await db.prepare("UPDATE oauth_connections SET revoked_at=?,revoked_reason='user_revoked' WHERE id=?").bind(now().toISOString(), principal.connectionId).run();
  await finishNotificationSend(db, principal, lease, { kind: "accepted" }, now());
  expect((await listDeliveries(db, householdAMember, {}, now())).items[0].outcome).toBe("accepted");
  await expect(finishNotificationSend(db, principal, lease, { kind: "unknown" }, now())).rejects.toMatchObject({ code: "lease_lost" });
});
it("送信開始直前の設定競合で全取消し、古い判定では送信を開始しない", async () => {
  const { candidate } = await enabled();
  await enqueueNotification(db, principal, candidate.candidate_id, now());
  const lease = await requiredLease();
  const racing = {
    prepare: (sql: string) => db.prepare(sql),
    batch: async (statements: D1PreparedStatement[]) => {
      await db.prepare("UPDATE notification_settings SET revision=revision+1,settings=json_set(settings,'$.muted',json('true'))").run();
      return db.batch(statements);
    },
  } as unknown as D1Database;
  await expect(beginNotificationSend(racing, principal, lease, now())).rejects.toMatchObject({ code: "read_conflict" });
  expect(await db.prepare("SELECT state,attempts FROM notification_outbox").first()).toEqual({ state: "leased", attempts: 0 });
  expect(await beginNotificationSend(db, principal, lease, now())).toMatchObject({ state: "cancelled", reason: "muted" });
  expect((await db.prepare("SELECT * FROM attention_guards").all()).results).toEqual([]);
});
it("履歴保存が失敗したら結果も更新せず、同じleaseで回復できる", async () => {
  const { candidate } = await enabled();
  await enqueueNotification(db, principal, candidate.candidate_id, now());
  const lease = await requiredLease();
  await beginNotificationSend(db, principal, lease, now());
  await db.prepare("CREATE TRIGGER outbox_fixture_failure BEFORE INSERT ON notification_delivery_history BEGIN SELECT RAISE(ABORT,'fixture history failure'); END").run();
  try {
    await expect(finishNotificationSend(db, principal, lease, { kind: "accepted" }, now())).rejects.toThrow("fixture history failure");
    expect(await db.prepare("SELECT state FROM notification_outbox").first()).toEqual({ state: "sending" });
    expect((await db.prepare("SELECT * FROM notification_delivery_marks").all()).results).toEqual([]);
  } finally { await db.prepare("DROP TRIGGER outbox_fixture_failure").run(); }
  await finishNotificationSend(db, principal, lease, { kind: "accepted" }, now());
  expect((await listDeliveries(db, householdAMember, {}, now())).items[0].outcome).toBe("accepted");
});
it("24時間を過ぎた再試行は外へ送る前に終了する", async () => {
  const { candidate } = await enabled();
  await enqueueNotification(db, principal, candidate.candidate_id, now());
  const lease = await requiredLease();
  await db.prepare("UPDATE notification_outbox SET first_sent_at='2000-01-01T00:00:00.000Z',attempts=1").run();
  expect(await beginNotificationSend(db, principal, lease, now())).toMatchObject({ state: "failed", reason: "retry_limit" });
  expect(await db.prepare("SELECT attempts FROM notification_outbox").first()).toEqual({ attempts: 1 });
});
it("休止解除で古い次回時刻を再計算し、接続解除では未送信分を取消す", async () => {
  const { candidate } = await enabled();
  const until = new Date(Date.now() + 3_600_000).toISOString();
  await setCandidateControl(db, householdAMember, candidate.candidate_id, { muted: false, snoozedUntil: until }, now());
  await enqueueNotification(db, principal, candidate.candidate_id, now());
  expect(await leaseNotification(db, principal, now())).toBeNull();
  await setCandidateControl(db, householdAMember, candidate.candidate_id, { muted: false, snoozedUntil: null }, now());
  await reconcilePendingNotifications(db, principal, now());
  expect(await leaseNotification(db, principal, now())).not.toBeNull();
  await db.prepare("UPDATE notification_outbox SET lease_expires_at='2000-01-01T00:00:00.000Z'").run();
  await recoverNotificationLeases(db, principal, now());
  await db.prepare("UPDATE oauth_connections SET revoked_at=?,revoked_reason='user_revoked' WHERE id=?").bind(now().toISOString(), principal.connectionId).run();
  await reconcilePendingNotifications(db, principal, now());
  expect(await db.prepare("SELECT state FROM notification_outbox").first()).toEqual({ state: "cancelled" });
});
it("定期照合しても既知の失敗のbackoffを短縮しない", async () => {
  const { candidate } = await enabled();
  await enqueueNotification(db, principal, candidate.candidate_id, now());
  const lease = await requiredLease();
  await beginNotificationSend(db, principal, lease, now());
  const result = await finishNotificationSend(db, principal, lease, { kind: "retry", reason: "http_503" }, now());
  await reconcilePendingNotifications(db, principal, now());
  expect(await db.prepare("SELECT state,next_attempt_at FROM notification_outbox").first()).toEqual({ state: "retry_wait", next_attempt_at: result.nextAt });
  expect(await leaseNotification(db, principal, now())).toBeNull();
});
