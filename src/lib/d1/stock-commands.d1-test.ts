import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, it } from "vitest";
import { applyAllMigrations } from "./test-support/migrations";
import { householdAMember, resetHouseholdFixtures } from "./test-support/households";
import { commandService, connectPrincipal, expectCommandError, testClock } from "./test-support/integration-commands";
import { listStockHistory, recordStock } from "./consumable-stock-history";
const db = env.DB;
beforeAll(() => applyAllMigrations(db));
beforeEach(async () => {
  await resetHouseholdFixtures(db);
  await db.prepare("INSERT INTO consumables(id,household_id,name) VALUES('stock','household-a','洗剤')").run();
});
function request(command: string, payload: Record<string, unknown>) {
  return { command, payload, target: { kind: "consumable", id: "stock" }, operation_id: crypto.randomUUID() };
}
type Prepared = { fingerprint: string; operation_id: string; preview_id: string };
function commit(p: Prepared) { return { fingerprint: p.fingerprint, operation_id: p.operation_id, preview_id: p.preview_id }; }
it("外部の観測・補充・訂正は共通受付に原子的に保存され、再送結果と接続元が一致する", async () => {
  const principal = await connectPrincipal(db, { householdId: "household-a", userId: "user-a" });
  const service = commandService(db);
  const prepared = await service.prepare(principal, request("stock.refill", { refilled_at: "now" })) as Prepared;
  const first = await service.commit(principal, commit(prepared));
  expect(first).toMatchObject({ status: "succeeded", result: { kind: "refill", occurred_at: "2026-10-12T03:00:00.000Z" } });
  expect(await service.commit(principal, commit(prepared))).toMatchObject({ ...first, replayed: true });
  const refill = (await listStockHistory(db, householdAMember, "stock")).items[0];
  expect(refill).toMatchObject({ source: "integration", actorId: "user-a", performerId: "user-a", clientId: principal.clientId });
  const correction = await service.prepare(principal, request("stock.correct", { record_id: refill.recordId, record_revision: 0, changes: { refilled_on: "2026-10-11" }, current_observation: { stock_status: "low" } })) as Prepared;
  expect(await service.commit(principal, commit(correction))).toMatchObject({ status: "succeeded", result: { record_revision: 1, current_stock_status: "low", revision: expect.any(String) } });
  const history = await listStockHistory(db, householdAMember, "stock");
  expect(history.items[0]).toMatchObject({ kind: "observation", source: "integration", clientId: principal.clientId, status: "low" });
  expect(history.items.find((r) => r.recordId === refill.recordId)).toMatchObject({ revision: 1, occurredOn: "2026-10-11" });
});
it("曖昧な入力・未知のキー・古いpreview・権限不足で在庫を変えない", async () => {
  const principal = await connectPrincipal(db, { householdId: "household-a", userId: "user-a" });
  const service = commandService(db, testClock());
  await expectCommandError(service.prepare(principal, request("stock.observe", { observed_at: "now" })), "invalid_input");
  await expectCommandError(service.prepare(principal, request("stock.observe", { observed_at: "now", stock_status: "out", confirmed: true })), "invalid_input");
  const prepared = await service.prepare(principal, request("stock.observe", { observed_at: "now", stock_status: "out" })) as Prepared;
  await recordStock(db, householdAMember, "stock", { kind: "observation", at: "now", status: "low" }, { operationId: crypto.randomUUID() });
  await expectCommandError(service.commit(principal, commit(prepared)), "stale_preview");
  const readOnly = await connectPrincipal(db, { householdId: "household-a", userId: "user-a", requestedScope: "household.read" });
  await expectCommandError(service.prepare(readOnly, request("stock.refill", { refilled_at: "now" })), "insufficient_scope");
  expect(await db.prepare("SELECT stock_status FROM consumables WHERE id='stock'").first()).toEqual({ stock_status: "low" });
});
