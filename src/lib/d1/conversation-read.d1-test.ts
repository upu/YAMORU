import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, it } from "vitest";
import { createHouseholdReader } from "../../features/integration/read";
import { buildPendingTodoEntries } from "../../app/pending-todo";
import { listPendingOccurrences } from "./home";
import { applyAllMigrations } from "./test-support/migrations";
import { resetHouseholdFixtures, householdAMember, createHouseholdAMaintenanceTask } from "./test-support/households";
import { createOneTimeTask, createManualTask, completeTask, correctCompletionOccurredAt, undoTaskCompletion } from "./todos";
import { D1UnauthorizedError } from "./errors";

const db = env.DB;
const now = new Date("2026-10-17T00:00:00.000Z");
const principal = { userId: "user-a", householdId: "household-a", clientId: "test", connectionId: "connection-a", scopes: ["household.read"] };
const reader = (overrides = {}) => createHouseholdReader({ db, authorize: async () => ({ ...principal, ...overrides }), cursorSecret: "test-only-secret-with-at-least-32-bytes", now: () => now });
beforeAll(() => applyAllMigrations(db));
beforeEach(() => resetHouseholdFixtures(db));

it("家庭外ID、未所属、scope不足を拒否する", async () => {
  await expect(reader().entityGet({ kind: "managed_item", id: "item-b" })).rejects.toMatchObject({ code: "not_found" });
  await expect(reader({ userId: "user-outsider" }).entitySearch({ query: "Item", kinds: ["managed_item"] })).rejects.toMatchObject({ code: "forbidden" });
  await expect(reader({ scopes: [] }).entityGet({ kind: "managed_item", id: "item-a" })).rejects.toMatchObject({ code: "insufficient_scope" });
});

it("別名、幅、かな、英字、関連名から複数候補を返す", async () => {
  await db.prepare("UPDATE managed_items SET name='ＡＢＣフィルター' WHERE id='item-a'").run();
  await db.prepare("INSERT INTO managed_items(id, household_id, name, kind) VALUES ('item-a2','household-a','abcふぃるたー','other')").run();
  await db.prepare("INSERT INTO entity_aliases(id, household_id, managed_item_id, alias) VALUES ('alias-a','household-a','item-a','浄水器')").run();
  const found = await reader().entitySearch({ query: "abcふぃるたー", kinds: ["managed_item"] });
  expect(found.candidates.map((c) => c.id)).toEqual(["item-a", "item-a2"]);
  expect(found.candidates[0]).toMatchObject({ kind: "managed_item", match_reason: { field: "name" }, detail_url: "/managed-items/item-a" });
  expect((await reader().entitySearch({ query: "浄水器", kinds: ["managed_item"] })).candidates[0].match_reason.field).toBe("alias");
  const { occurrenceId } = await createHouseholdAMaintenanceTask(db);
  expect((await reader().entitySearch({ query: "abcふぃるたー", kinds: ["todo_occurrence"] })).candidates[0].id).toBe(occurrenceId);
});

it("ページを重複なく取得し、条件・主体・期限・改ざんを検証する", async () => {
  await db.prepare("INSERT INTO managed_items(id, household_id, name, kind) VALUES ('item-a2','household-a','Item A2','other')").run();
  const input = { query: "Item", kinds: ["managed_item"], limit: 1 };
  const first = await reader().entitySearch(input);
  expect(first.next_cursor).toBeTypeOf("string");
  const second = await reader().entitySearch({ ...input, cursor: first.next_cursor });
  expect(second.candidates.map((c) => c.id)).toEqual(["item-a2"]);
  await expect(reader().entitySearch({ ...input, query: "A", cursor: first.next_cursor })).rejects.toMatchObject({ code: "invalid_cursor" });
  await expect(reader({ connectionId: "other" }).entitySearch({ ...input, cursor: first.next_cursor })).rejects.toMatchObject({ code: "invalid_cursor" });
  await expect(reader().entitySearch({ ...input, cursor: `${first.next_cursor}x` })).rejects.toMatchObject({ code: "invalid_cursor" });
  await expect(reader().entitySearch({ ...input, limit: 51 })).rejects.toMatchObject({ code: "invalid_input" });
});

it("画面の期限状態と一致し、snapshotと現在Ruleを分ける", async () => {
  const { occurrenceId, ruleId } = await createHouseholdAMaintenanceTask(db);
  await db.prepare("UPDATE task_occurrences SET must_complete_by='2026-10-17' WHERE id=?").bind(occurrenceId).run();
  const ui = buildPendingTodoEntries(await listPendingOccurrences(db, householdAMember), now.toISOString())[0];
  const detail = await reader().entityGet({ kind: "todo_occurrence", id: occurrenceId });
  expect(detail.entity.related.items).toContainEqual({ kind: "todo_rule", id: ruleId });
  expect(detail.entity.related.items).toContainEqual({ kind: "managed_item", id: "item-a" });
  expect(detail.entity.attributes.occurrence_rule).toMatchObject({ recurrence_basis: "completion", managed_item_id: "item-a" });
  expect(detail.entity.state).toMatchObject({ category: ui.category, badge: ui.item.badge, tone: ui.item.tone });
  expect(detail.entity.dates).toMatchObject({ time_zone: "Asia/Tokyo", must_complete_by: "2026-10-17", scheduled_on: null, recommended_window: { start: "2026-08-02", end: "2026-08-11", state: "past-window" } });
  await db.prepare("UPDATE task_rules SET title='Future title' WHERE id=?").bind(ruleId).run();
  const next = await reader().entityGet({ kind: "todo_occurrence", id: occurrenceId });
  expect(next.entity.name).toBe("A maintenance");
  expect((await listPendingOccurrences(db, householdAMember))[0].task_rules.title).toBe("A maintenance");
  expect(next.entity.revision).not.toBe(detail.entity.revision);
  expect((await reader().entityGet({ kind: "todo_rule", id: ruleId })).entity.name).toBe("Future title");
});

it("訂正前後・実施日時と記録日時・取消を履歴として区別する", async () => {
  const ruleId = await createOneTimeTask(db, householdAMember, { title: "掃除", managedItemId: "item-a", scheduledFor: null });
  const occurrence = await db.prepare("SELECT id FROM task_occurrences WHERE task_rule_id=?").bind(ruleId).first<{ id: string }>();
  if (occurrence === null) throw new Error("Missing test occurrence");
  const id = occurrence.id;
  await completeTask(db, householdAMember, { occurrenceId: id, idempotencyKey: "complete", occurredAt: "2026-01-10T00:00:00.000Z", performedByUserId: null });
  await correctCompletionOccurredAt(db, householdAMember, id, "correct", "2026-01-09T00:00:00.000Z");
  const history = await reader().historyList({ kind: "todo_occurrence", id });
  expect(history.records).toHaveLength(2);
  const completion = history.records.find((r) => r.kind === "completed");
  if (!completion) throw new Error("Missing completion");
  expect(completion).toMatchObject({ occurred_at: "2026-01-09T00:00:00.000Z", actor_user_id: "user-a", performer_user_id: "user-a", client_id: null,
    details: { original_occurred_at: "2026-01-10T00:00:00.000Z", active: 1 } });
  expect(history.records.find((r) => r.kind === "completion_corrected")?.corrects_id).toBe(completion.id);
  const page = await reader().historyList({ kind: "managed_item", id: "item-a", limit: 1 });
  const next = await reader().historyList({ kind: "managed_item", id: "item-a", limit: 1, cursor: page.next_cursor });
  expect(page.records[0].id).not.toBe(next.records[0].id);
  await expect(reader().historyList({ kind: "managed_item", id: "item-b" })).rejects.toMatchObject({ code: "not_found" });
  await undoTaskCompletion(db, householdAMember, id, "undo");
  expect((await reader().historyList({ kind: "todo_occurrence", id })).records.find((r) => r.kind === "completed")?.details.active).toBe(0);
});

it("読み取り中の更新・認可失効を検出して混在した結果を返さない", async () => {
  let calls = 0;
  const changing = createHouseholdReader({ db, cursorSecret: "test-only-secret-with-at-least-32-bytes", authorize: async () => {
    if (++calls === 2) await db.prepare("UPDATE managed_items SET name='new' WHERE id='item-a'").run();
    return principal;
  } });
  await expect(changing.entityGet({ kind: "managed_item", id: "item-a" })).rejects.toMatchObject({ code: "read_conflict" });
  calls = 0;
  const revoked = createHouseholdReader({ db, cursorSecret: "test-only-secret-with-at-least-32-bytes", authorize: async () => ({ ...principal, scopes: ++calls === 2 ? [] : principal.scopes }) });
  await expect(revoked.entityGet({ kind: "managed_item", id: "item-a" })).rejects.toMatchObject({ code: "insufficient_scope" });
});

it("日付境界でWebと一致し、必要時・未定・延期・必達日を区別する", async () => {
  await createManualTask(db, householdAMember, { title: "必要時", managedItemId: null, mustCompleteBy: "2026-10-17" });
  await createOneTimeTask(db, householdAMember, { title: "日付未定", managedItemId: null, scheduledFor: null });
  await createOneTimeTask(db, householdAMember, { title: "予定あり", managedItemId: null, scheduledFor: "2026-10-16T15:00:00.000Z" });
  const rows = await listPendingOccurrences(db, householdAMember);
  for (const iso of ["2026-10-16T14:59:59.000Z", "2026-10-16T15:00:00.000Z", "2026-10-17T15:00:00.000Z"]) {
    const api = createHouseholdReader({ db, cursorSecret: "test-only-secret-with-at-least-32-bytes", authorize: async () => principal, now: () => new Date(iso) });
    for (const ui of buildPendingTodoEntries(rows, iso)) {
      const result = await api.entityGet({ kind: "todo_occurrence", id: ui.item.id });
      expect(result.entity.state).toMatchObject({ category: ui.category, badge: ui.item.badge, tone: ui.item.tone });
    }
  }
});

it("大量の不一致候補も有限ページで走査し、後方の一致を取りこぼさない", async () => {
  await db.batch(Array.from({ length: 205 }, (_, i) => db.prepare("INSERT INTO managed_items(id,household_id,name,kind) VALUES (?,'household-a',?,'other')").bind(`z${String(i).padStart(3,"0")}`, i === 204 ? "目的のフィルター" : "対象外")));
  const first = await reader().entitySearch({ query: "フィルター", kinds: ["managed_item"] });
  expect(first.candidates).toEqual([]);
  expect(first.search_complete).toBe(false);
  const last = await reader().entitySearch({ query: "フィルター", kinds: ["managed_item"], cursor: first.next_cursor });
  expect(last.candidates.map((c) => c.id)).toEqual(["z204"]);
  expect(last.next_cursor).toBeNull();
});

it("補充の実施者やclientを捏造せず、在庫と補充暦日を返す", async () => {
  await db.prepare("INSERT INTO consumables(id,household_id,name,stock_status) VALUES ('c','household-a','洗剤','low')").run();
  await db.prepare("INSERT INTO consumable_refills(id,household_id,consumable_id,refilled_on) VALUES ('f','household-a','c','2026-10-10')").run();
  const detail = await reader().entityGet({ kind: "consumable", id: "c" });
  expect(detail.entity.attributes).toMatchObject({ stock_status: "low", last_refilled_on: "2026-10-10" });
  expect((await reader().historyList({ kind: "consumable", id: "c" })).records[0]).toMatchObject({ occurred_on: "2026-10-10", occurred_at: null, actor_user_id: null, performer_user_id: null, client_id: null });
});

it("履歴は記録日時の新しい順で、同時刻も重複・欠落なく古いページへ進む", async () => {
  await db.prepare("INSERT INTO consumables(id,household_id,name) VALUES ('c','household-a','洗剤')").run();
  await db.batch([
    db.prepare("INSERT INTO consumable_refills(id,household_id,consumable_id,refilled_on,recorded_at) VALUES ('f0','household-a','c','2026-10-10','2026-10-10T00:00:00.000Z')"),
    db.prepare("INSERT INTO consumable_refills(id,household_id,consumable_id,refilled_on,recorded_at) VALUES ('f1','household-a','c','2026-10-09','2026-10-11T00:00:00.000Z')"),
    db.prepare("INSERT INTO consumable_refills(id,household_id,consumable_id,refilled_on,recorded_at) VALUES ('f2','household-a','c','2026-10-08','2026-10-11T00:00:00.000Z')"),
  ]);
  const request = { kind: "consumable", id: "c", limit: 1 };
  const first = await reader().historyList(request);
  expect(first.records.map((record) => record.id)).toEqual(["f2"]);
  expect(first.next_cursor).not.toBeNull();
  const second = await reader().historyList({ ...request, cursor: first.next_cursor });
  expect(second.records.map((record) => record.id)).toEqual(["f1"]);
  expect(second.next_cursor).not.toBeNull();
  const last = await reader().historyList({ ...request, cursor: second.next_cursor });
  expect(last.records.map((record) => record.id)).toEqual(["f0"]);
  expect(last.next_cursor).toBeNull();
});

it("snapshotの明示nullを現在Ruleの関連先で埋めず、関連の展開も上限を守る", async () => {
  const ruleId = await createOneTimeTask(db, householdAMember, { title: "家全体の掃除", managedItemId: null, scheduledFor: null });
  const occurrence = await db.prepare("SELECT id FROM task_occurrences WHERE task_rule_id=?").bind(ruleId).first<{ id: string }>();
  if (occurrence === null) throw new Error("Missing occurrence");
  await db.prepare("UPDATE task_rules SET managed_item_id='item-a' WHERE id=?").bind(ruleId).run();
  const detail = await reader().entityGet({ kind: "todo_occurrence", id: occurrence.id });
  expect(detail.entity.attributes.managed_item_id).toBeNull();
  expect(detail.entity.related.items).toEqual([{ kind: "todo_rule", id: ruleId }]);
  await db.batch(Array.from({ length: 55 }, (_, i) => [
    db.prepare("INSERT INTO consumables(id,household_id,name) VALUES (?,'household-a','洗剤')").bind(`c${i}`),
    db.prepare("INSERT INTO managed_item_consumables(household_id,managed_item_id,consumable_id) VALUES ('household-a','item-a',?)").bind(`c${i}`),
  ]).flat());
  const related = (await reader().entityGet({ kind: "managed_item", id: "item-a" })).entity.related;
  expect(related.items).toHaveLength(50);
  expect(related.has_more).toBe(true);
});

it("未認証と読み取り中の家庭離脱を構造化エラーで返す", async () => {
  const anonymous = createHouseholdReader({ db, cursorSecret: "test-only-secret-with-at-least-32-bytes", authorize: async () => { throw new D1UnauthorizedError("not signed in"); } });
  await expect(anonymous.entityGet({ kind: "managed_item", id: "item-a" })).rejects.toMatchObject({ code: "unauthenticated", retryable: false });
  let calls = 0;
  const removed = createHouseholdReader({ db, cursorSecret: "test-only-secret-with-at-least-32-bytes", authorize: async () => {
    if (++calls === 2) await db.prepare("DELETE FROM household_members WHERE user_id='user-a'").run();
    return principal;
  } });
  await expect(removed.entityGet({ kind: "managed_item", id: "item-a" })).rejects.toMatchObject({ code: "forbidden", retryable: false });
});

it("ページ取得中の更新では古いcursorを捨てて先頭から回復できる", async () => {
  await db.prepare("INSERT INTO managed_items(id,household_id,name,kind) VALUES ('item-a2','household-a','Item A2','other')").run();
  const input = { query: "Item", kinds: ["managed_item"], limit: 1 };
  const first = await reader().entitySearch(input);
  let calls = 0;
  const changing = createHouseholdReader({ db, cursorSecret: "test-only-secret-with-at-least-32-bytes", now: () => now, authorize: async () => {
    if (++calls === 2) await db.prepare("UPDATE managed_items SET name='Item changed' WHERE id='item-a'").run();
    return principal;
  } });
  await expect(changing.entitySearch({ ...input, cursor: first.next_cursor })).rejects.toMatchObject({ code: "read_conflict", retryable: true, recovery: { action: "restart_read", omit_cursor: true } });
  expect((await changing.entitySearch(input)).candidates[0].name).toBe("Item changed");
});

it.each([
  ["2026-08-01T00:00:00.000Z", "before-window"],
  ["2026-08-02T00:00:00.000Z", "in-window"],
  ["2026-08-10T00:00:00.000Z", "reminder-window"],
  ["2026-08-12T00:00:00.000Z", "past-window"],
])("推奨期間を契約通りのstart/end/stateで返す: %s", async (iso, state) => {
  const { occurrenceId } = await createHouseholdAMaintenanceTask(db);
  await db.prepare("UPDATE task_occurrences SET must_complete_by='2026-07-01' WHERE id=?").bind(occurrenceId).run();
  const api = createHouseholdReader({ db, cursorSecret: "test-only-secret-with-at-least-32-bytes", now: () => new Date(iso), authorize: async () => principal });
  const result = await api.entityGet({ kind: "todo_occurrence", id: occurrenceId });
  expect(result.entity.dates?.recommended_window).toEqual({ start: "2026-08-02", end: "2026-08-11", state });
  expect(result.entity.state).toMatchObject({ category: "overdue", hard_deadline_overdue: true });
});
