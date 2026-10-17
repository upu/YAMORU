import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, it } from "vitest";
import { applyAllMigrations } from "./test-support/migrations";
import { householdAMember as member, householdBMember, nonMember, resetHouseholdFixtures } from "./test-support/households";
import { interruptBeforeBatch } from "./test-support/integration-commands";
import { correctStock, recordStock, listStockHistory } from "./consumable-stock-history";
import { listStockVersions } from "./consumable-stock-read";
import { readEntityRows, readHistoryRows } from "./conversation-read";

const db = env.DB;
const now = new Date("2026-10-18T03:00:00.000Z");
const options = () => ({ operationId: crypto.randomUUID(), now });
beforeAll(() => applyAllMigrations(db));
beforeEach(async () => {
  await resetHouseholdFixtures(db);
  await db.prepare("INSERT INTO consumables(id,household_id,name,stock_status) VALUES('stock','household-a','洗剤','low')").run();
  // 保存状態の捕捉時刻も固定し、実行日の暦に依存しないfixtureとする。
  await db.prepare("UPDATE consumable_stock_events SET recorded_at='2026-10-01T00:00:00.000Z' WHERE id='snapshot:stock'").run();
  await db.prepare("UPDATE consumable_stock_current SET recorded_at='2026-10-01T00:00:00.000Z' WHERE record_id='snapshot:stock'").run();
});
it("観測を補充と分けて記録し、実施者・記録者・記録元を保持する", async () => {
  const result = await recordStock(db, member, "stock", { kind: "observation", at: "now", status: "out" }, options());
  expect(result).toMatchObject({ stock_status: "out", current_stock_status: "out", state_effect: "applied", record_revision: 0, replayed: false });
  expect((await db.prepare("SELECT * FROM consumable_refills").all()).results).toEqual([]);
  expect(await db.prepare("SELECT stock_status FROM consumables WHERE id='stock'").first()).toEqual({ stock_status: "out" });
  const history = await listStockHistory(db, member, "stock");
  expect(history.items[0]).toMatchObject({ recordId: result.record_id, kind: "observation", actorId: "user-a", performerId: "user-a", source: "web", occurredAt: now.toISOString() });
});
it("補充の同操作再送は一つの履歴と同じ結果になり、別内容は拒否する", async () => {
  const operation = options();
  const input = { kind: "refill", at: "now" };
  const first = await recordStock(db, member, "stock", input, operation);
  const second = await recordStock(db, member, "stock", input, { ...operation, now: new Date(now.getTime() + 86_400_000) });
  expect(second).toEqual({ ...first, replayed: true });
  expect((await db.prepare("SELECT * FROM consumable_refills").all()).results).toHaveLength(1);
  expect((await listStockHistory(db, member, "stock")).items.filter((r) => r.kind === "refill")).toHaveLength(1);
  await expect(recordStock(db, member, "stock", { kind: "refill", on: "2026-10-17" }, operation)).rejects.toMatchObject({ code: "idempotency_conflict" });
});
it("古い観測・同日不明の順序を推測せず、明示した履歴だけの操作を扱う", async () => {
  await recordStock(db, member, "stock", { kind: "observation", at: "2026-10-18T01:00:00Z", status: "out" }, options());
  await recordStock(db, member, "stock", { kind: "refill", on: "2026-10-17" }, options());
  expect(await db.prepare("SELECT stock_status FROM consumables WHERE id='stock'").first()).toEqual({ stock_status: "out" });
  await expect(recordStock(db, member, "stock", { kind: "observation", on: "2026-10-18", status: "available" }, options())).rejects.toMatchObject({ code: "missing_required" });
  const historical = await recordStock(db, member, "stock", { kind: "observation", on: "2026-10-18", status: "available", application: "history_only" }, options());
  expect(historical).toMatchObject({ state_effect: "history_only", current_stock_status: "out" });
  const both = await recordStock(db, member, "stock", { kind: "refill", on: "2026-10-18", currentObservation: { status: "low" } }, options());
  expect(both).toMatchObject({ current_stock_status: "low", state_effect: "applied", current_observation_id: expect.any(String) });
});
it("家庭・利用者・実施者の境界と読み取りの上限を守る", async () => {
  const input = { kind: "observation", at: "now", status: "out" };
  await expect(recordStock(db, householdBMember, "stock", input, options())).rejects.toThrow();
  await expect(recordStock(db, nonMember, "stock", input, options())).rejects.toThrow();
  await expect(recordStock(db, null, "stock", input, options())).rejects.toThrow();
  await expect(recordStock(db, member, "stock", { ...input, performerId: "user-b" }, options())).rejects.toMatchObject({ code: "invalid_input" });
  await expect(listStockHistory(db, householdBMember, "stock")).rejects.toThrow();
  await expect(listStockHistory(db, member, "stock", { limit: 51 })).rejects.toMatchObject({ code: "invalid_input" });
  expect((await db.prepare("SELECT * FROM consumable_refills").all()).results).toEqual([]);
});
it("保存直前の家族の更新で補充・原記録・投影を一緒に取り消す", async () => {
  const interrupted = interruptBeforeBatch(db, async () => {
    await recordStock(db, member, "stock", { kind: "observation", at: "now", status: "out" }, options());
  });
  await expect(recordStock(interrupted, member, "stock", { kind: "refill", at: "now" }, options())).rejects.toMatchObject({ code: "stale_stock" });
  expect((await db.prepare("SELECT * FROM consumable_refills").all()).results).toEqual([]);
  expect(await db.prepare("SELECT stock_status FROM consumables WHERE id='stock'").first()).toEqual({ stock_status: "out" });
  expect((await db.prepare("SELECT * FROM consumable_stock_write_guards").all()).results).toEqual([]);
});
it("補充の日時訂正は原記録を残し、後続の家族の観測を巻き戻さない", async () => {
  const refill = await recordStock(db, member, "stock", { kind: "refill", on: "2026-10-16", performerId: null }, options());
  await recordStock(db, member, "stock", { kind: "observation", at: "now", status: "out" }, options());
  const operation = options();
  const draft = { recordId: refill.record_id, recordRevision: 0, changes: { on: "2026-10-17" } };
  const corrected = await correctStock(db, member, "stock", draft, operation);
  expect(corrected).toMatchObject({ record_revision: 1, occurred_on: "2026-10-17", performer_id: null, current_stock_status: "out", state_effect: "history_only" });
  expect(await correctStock(db, member, "stock", draft, operation)).toEqual({ ...corrected, replayed: true });
  expect(await db.prepare("SELECT refilled_on FROM consumable_refills").first()).toEqual({ refilled_on: "2026-10-16" });
  expect((await db.prepare("SELECT action,occurred_on FROM consumable_stock_events WHERE record_id=? ORDER BY revision").bind(refill.record_id).all()).results)
    .toEqual([{ action: "created", occurred_on: "2026-10-16" }, { action: "corrected", occurred_on: "2026-10-17" }]);
  await expect(correctStock(db, member, "stock", draft, options())).rejects.toMatchObject({ code: "stale_stock" });
});
it("現在の根拠を取消すと有効な以前の状態へ戻り、原記録は残る", async () => {
  const observation = await recordStock(db, member, "stock", { kind: "observation", at: "now", status: "out" }, options());
  const result = await correctStock(db, member, "stock", { recordId: observation.record_id, recordRevision: 0, void: true }, options());
  expect(result).toMatchObject({ record_voided: true, current_stock_status: "low", state_effect: "applied" });
  expect((await listStockHistory(db, member, "stock")).items[0]).toMatchObject({ voided: true, revision: 1 });
  expect((await db.prepare("SELECT * FROM consumable_stock_events WHERE record_id=?").bind(observation.record_id).all()).results).toHaveLength(2);
});
it("訂正後の順序が不明なら現在の観測を求め、一緒に記録できる", async () => {
  await recordStock(db, member, "stock", { kind: "observation", on: "2026-10-17", status: "available", application: "history_only" }, options());
  const observation = await recordStock(db, member, "stock", { kind: "observation", at: "now", status: "out" }, options());
  const draft = { recordId: observation.record_id, recordRevision: 0, changes: { on: "2026-10-17" } };
  await expect(correctStock(db, member, "stock", draft, options())).rejects.toMatchObject({ code: "missing_required" });
  const result = await correctStock(db, member, "stock", { ...draft, currentObservation: { status: "low" } }, options());
  expect(result).toMatchObject({ current_stock_status: "low", current_observation_id: expect.any(String), record_revision: 1 });
  expect((await listStockHistory(db, member, "stock")).items[0]).toMatchObject({ kind: "observation", status: "low", occurredAt: now.toISOString() });
});
it("訂正にも家庭境界・保存直前の競合検査と原子性を適用する", async () => {
  const original = await recordStock(db, member, "stock", { kind: "observation", at: "now", status: "out" }, options());
  const draft = { recordId: original.record_id, recordRevision: 0, changes: { status: "low" } };
  await expect(correctStock(db, householdBMember, "stock", draft, options())).rejects.toThrow();
  const interrupted = interruptBeforeBatch(db, async () => {
    await recordStock(db, member, "stock", { kind: "observation", at: "now", status: "available" }, options());
  });
  await expect(correctStock(interrupted, member, "stock", draft, options())).rejects.toMatchObject({ code: "stale_stock" });
  expect((await listStockHistory(db, member, "stock")).items.find((r) => r.recordId === original.record_id)).toMatchObject({ revision: 0, status: "out" });
  await expect(correctStock(db, member, "stock", { recordId: "snapshot:stock", recordRevision: 0, void: true }, options())).rejects.toMatchObject({ code: "invalid_input" });
});
it("訂正後の補充日・取消・全版を会話読み取りへ反映し、観測で補充日を変えない", async () => {
  const refill = await recordStock(db, member, "stock", { kind: "refill", on: "2026-10-16" }, options());
  await correctStock(db, member, "stock", { recordId: refill.record_id, recordRevision: 0, changes: { on: "2026-10-17" } }, options());
  await recordStock(db, member, "stock", { kind: "observation", at: "now", status: "out" }, options());
  const [entity] = await readEntityRows(db, "household-a", ["consumable"], "", 1, "stock");
  expect(JSON.parse(entity.data)).toMatchObject({ last_refilled_on: "2026-10-17", stock_status: "out" });
  const history = await readHistoryRows(db, "household-a", "consumable", "stock", "", 20);
  expect(history.find((r) => r.kind === "stock_corrected")).toMatchObject({ occurred_on: "2026-10-17", corrects_id: refill.record_id });
  expect(history.find((r) => r.kind === "stock_observed")).toMatchObject({ occurred_at: now.toISOString(), date_precision: "instant" });
  await correctStock(db, member, "stock", { recordId: refill.record_id, recordRevision: 1, void: true }, options());
  expect(JSON.parse((await readEntityRows(db, "household-a", ["consumable"], "", 1, "stock"))[0].data)).toMatchObject({ last_refilled_on: null, stock_status: "out" });
  expect((await listStockVersions(db, member, "stock", refill.record_id)).items.map((v) => v.action)).toEqual(["voided", "corrected", "created"]);
  await expect(listStockVersions(db, householdBMember, "stock", refill.record_id)).rejects.toThrow();
});
it("旧記録の不明な実施者と不正な日付を保持し、日付の訂正や取消ができる", async () => {
  await db.prepare("INSERT INTO consumable_refills(id,household_id,consumable_id,refilled_on) VALUES('invalid','household-a','stock','2026-99-99')").run();
  const [invalidHistory] = await readHistoryRows(db, "household-a", "consumable", "stock", "", 20);
  expect(invalidHistory).toMatchObject({ occurred_on: null, date_precision: "unknown" });
  expect(JSON.parse(invalidHistory.data)).toMatchObject({ original_occurred_on: "2026-99-99" });
  await expect(correctStock(db, member, "stock", { recordId: "refill:invalid", recordRevision: 0, changes: { performerId: null } }, options())).rejects.toMatchObject({ code: "missing_required" });
  const result = await correctStock(db, member, "stock", { recordId: "refill:invalid", recordRevision: 0, void: true }, options());
  expect(result).toMatchObject({ performer_id: null, record_voided: true, current_stock_status: "low" });
  const restored = await correctStock(db, member, "stock", { recordId: "refill:invalid", recordRevision: 1, changes: { on: "2026-10-17" } }, options());
  expect(restored).toMatchObject({ record_voided: false, performer_id: null, occurred_on: "2026-10-17" });
});
it("実施者の家庭離脱後も、元の実施者を置換せず日付を訂正できる", async () => {
  await db.batch([db.prepare("INSERT INTO users(id,email) VALUES('departed','departed@example.test')"), db.prepare("INSERT INTO household_members(household_id,user_id) VALUES('household-a','departed')")]);
  const refill = await recordStock(db, member, "stock", { kind: "refill", on: "2026-10-16", performerId: "departed" }, options());
  await db.prepare("DELETE FROM household_members WHERE user_id='departed'").run();
  const result = await correctStock(db, member, "stock", { recordId: refill.record_id, recordRevision: 0, changes: { on: "2026-10-17" } }, options());
  expect(result.performer_id).toBe("departed");
  expect((await listStockHistory(db, member, "stock")).items[0]).toMatchObject({ performerId: "departed", performerName: null });
});
