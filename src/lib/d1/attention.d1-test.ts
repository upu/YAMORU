import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, it } from "vitest";
import { createAttentionReader } from "../../features/integration/attention/service";
import { applyAllMigrations } from "./test-support/migrations";
import { resetHouseholdFixtures, createHouseholdAMaintenanceTask } from "./test-support/households";

const db = env.DB;
const now = new Date("2026-10-17T00:00:00Z");
const principal = { userId: "user-a", householdId: "household-a", clientId: "test", connectionId: "a", scopes: ["household.read"] };
const reader = (p = principal, clock = now) => createAttentionReader({ db, authorize: async () => p, cursorSecret: "attention-test-secret-at-least-32-bytes", now: () => clock });
beforeAll(() => applyAllMigrations(db));
beforeEach(() => resetHouseholdFixtures(db));

it("空の家庭でも次回確認時刻と差分cursorを返す", async () => {
  expect(await reader().attentionGet({})).toMatchObject({ candidates: [], removed_ids: [], next_cursor: null, refresh_complete: true, sync_cursor: expect.any(String), next_check_at: "2026-10-17T00:05:00.000Z" });
});

it("同じ候補区間はIDが安定し、変更差分と削除を返す", async () => {
  const { occurrenceId } = await createHouseholdAMaintenanceTask(db);
  const first = await reader().attentionGet({});
  const candidate = first.candidates[0];
  expect(candidate.occurrence_id).toBe(occurrenceId);
  expect((await reader().attentionGet({ cursor: first.sync_cursor })).candidates).toEqual([]);
  await db.prepare("UPDATE task_occurrences SET must_complete_by='2026-10-16' WHERE id=?").bind(occurrenceId).run();
  const changed = await reader().attentionGet({ cursor: first.sync_cursor });
  expect(changed.candidates[0]).toMatchObject({ candidate_id: candidate.candidate_id, reason_codes: ["hard_deadline_overdue", "maintenance_overdue"] });
  await db.prepare("UPDATE task_occurrences SET status='skipped' WHERE id=?").bind(occurrenceId).run();
  const removed = await reader().attentionGet({ cursor: changed.sync_cursor });
  expect(removed.removed_ids).toEqual([candidate.candidate_id]);
  expect(removed.candidates).toEqual([]);
});

it("走査の間に解消・再発しても候補区間を使い回さない", async () => {
  await db.prepare("INSERT INTO consumables(id,household_id,name,stock_status) VALUES ('c','household-a','洗剤','low')").run();
  const first = await reader().attentionGet({});
  await db.prepare("UPDATE consumables SET stock_status='available' WHERE id='c'").run();
  await db.prepare("UPDATE consumables SET stock_status='low' WHERE id='c'").run();
  const next = await reader().attentionGet({ cursor: first.sync_cursor });
  expect(next.candidates[0].candidate_id).not.toBe(first.candidates[0].candidate_id);
  expect(next.removed_ids).toEqual([first.candidates[0].candidate_id]);
});

it("家庭・権限・cursor・ID指定の境界を守る", async () => {
  await createHouseholdAMaintenanceTask(db);
  const first = await reader().attentionGet({});
  await expect(reader({ ...principal, scopes: [] }).attentionGet({})).rejects.toMatchObject({ code: "insufficient_scope" });
  await expect(reader({ ...principal, userId: "user-outsider" }).attentionGet({})).rejects.toMatchObject({ code: "forbidden" });
  await expect(reader({ ...principal, connectionId: "b" }).attentionGet({ cursor: first.sync_cursor })).rejects.toMatchObject({ code: "invalid_cursor" });
  const b = { ...principal, userId: "user-b", householdId: "household-b" };
  expect((await reader(b).attentionGet({ candidate_ids: [first.candidates[0].candidate_id] })).candidates).toEqual([]);
  await expect(reader().attentionGet({ limit: 51 })).rejects.toMatchObject({ code: "invalid_input" });
  await expect(reader().attentionGet({ candidate_ids: Array(51).fill("id") })).rejects.toMatchObject({ code: "invalid_input" });
});

it("100対象を超える再評価と50件上限のページを欠落・重複なく取得する", async () => {
  await db.batch(Array.from({ length: 121 }, (_, n) => db.prepare("INSERT INTO consumables(id,household_id,name,stock_status) VALUES (?,'household-a',?,'low')").bind(`c${String(n).padStart(3,"0")}`, `洗剤${n}`)));
  let result = await reader().attentionGet({ limit: 50 });
  expect(result).toMatchObject({ candidates: [], refresh_complete: false, next_cursor: expect.any(String), sync_cursor: null });
  const ids: string[] = [];
  do {
    result = await reader().attentionGet({ limit: 50, cursor: result.next_cursor });
    expect(result.candidates.length + result.removed_ids.length).toBeLessThanOrEqual(50);
    ids.push(...result.candidates.map((c) => c.entity_id));
  } while (result.next_cursor);
  expect(ids).toHaveLength(121);
  expect(new Set(ids).size).toBe(121);
  expect(ids).toEqual([...ids].sort());
  expect((await reader().attentionGet({ limit: 50, cursor: result.sync_cursor })).candidates).toEqual([]);
});

it("日付だけの経過で候補を発生・更新し、同じ区間のIDは保持する", async () => {
  const { occurrenceId } = await createHouseholdAMaintenanceTask(db);
  await db.prepare("UPDATE task_occurrences SET scheduled_for='2026-10-18T15:00:00.000Z',due_at='2026-10-20T15:00:00.000Z',must_complete_by='2026-10-18' WHERE id=?").bind(occurrenceId).run();
  const before = new Date("2026-10-17T14:59:59Z");
  const after = new Date("2026-10-17T15:00:00Z");
  const empty = await reader(principal, before).attentionGet({});
  expect(empty.candidates).toEqual([]);
  expect(empty.next_check_at).toBe(after.toISOString());
  const today = await reader(principal, after).attentionGet({ cursor: empty.sync_cursor });
  expect(today.candidates[0].reason_codes).toEqual(["hard_deadline_today"]);
  const tomorrow = await reader(principal, new Date("2026-10-18T15:00:00Z")).attentionGet({});
  expect(tomorrow.candidates[0].candidate_id).toBe(today.candidates[0].candidate_id);
  expect(tomorrow.candidates[0].reason_codes).toEqual(["hard_deadline_overdue", "maintenance_window"]);
  expect(tomorrow.candidates[0].revision).not.toBe(today.candidates[0].revision);
});

it("完了後にpendingへ戻ると再評価し、未来へ延期して戻しても新しい区間になる", async () => {
  const { occurrenceId } = await createHouseholdAMaintenanceTask(db);
  const first = await reader().attentionGet({});
  await db.prepare("UPDATE task_occurrences SET status='completed' WHERE id=?").bind(occurrenceId).run();
  await db.prepare("UPDATE task_occurrences SET status='pending' WHERE id=?").bind(occurrenceId).run();
  const restored = await reader().attentionGet({});
  expect(restored.candidates[0].candidate_id).not.toBe(first.candidates[0].candidate_id);
  await db.prepare("UPDATE task_occurrences SET scheduled_for='2099-01-01T00:00:00Z',due_at='2099-01-10T00:00:00Z' WHERE id=?").bind(occurrenceId).run();
  await db.prepare("UPDATE task_occurrences SET scheduled_for='2026-08-01T00:00:00Z',due_at='2026-08-10T00:00:00Z' WHERE id=?").bind(occurrenceId).run();
  const again = await reader().attentionGet({ cursor: restored.sync_cursor });
  expect(again.removed_ids).toContain(restored.candidates[0].candidate_id);
  expect(again.candidates[0].candidate_id).not.toBe(restored.candidates[0].candidate_id);
});

it("古いpage・改ざん・期限切れを拒否し、ID指定は自分の家庭だけ返す", async () => {
  await createHouseholdAMaintenanceTask(db);
  await db.prepare("INSERT INTO consumables(id,household_id,name,stock_status) VALUES ('c','household-a','洗剤','out')").run();
  const first = await reader().attentionGet({ limit: 1 });
  const id = first.candidates[0].candidate_id;
  expect((await reader().attentionGet({ candidate_ids: [id, "unknown"] })).candidates.map((c) => c.candidate_id)).toEqual([id]);
  await expect(reader().attentionGet({ limit: 1, cursor: `${first.next_cursor}x` })).rejects.toMatchObject({ code: "invalid_cursor" });
  await expect(reader(principal, new Date(now.getTime() + 900_000)).attentionGet({ limit: 1, cursor: first.next_cursor })).rejects.toMatchObject({ code: "cursor_expired" });
  await db.prepare("UPDATE consumables SET name='新しい名前' WHERE id='c'").run();
  await expect(reader().attentionGet({ limit: 1, cursor: first.next_cursor })).rejects.toMatchObject({ code: "invalid_cursor" });
});

it("読み取り中の認可失効・家庭変更を検出して返さない", async () => {
  let calls = 0;
  const revoked = createAttentionReader({ db, cursorSecret: "attention-test-secret-at-least-32-bytes", now: () => now,
    authorize: async () => ({ ...principal, scopes: ++calls === 2 ? [] : principal.scopes }) });
  await expect(revoked.attentionGet({})).rejects.toMatchObject({ code: "insufficient_scope" });
  calls = 0;
  const changed = createAttentionReader({ db, cursorSecret: "attention-test-secret-at-least-32-bytes", now: () => now, authorize: async () => {
    if (++calls === 2) await db.prepare("UPDATE managed_items SET name='変更' WHERE id='item-a'").run();
    return principal;
  } });
  await expect(changed.attentionGet({})).rejects.toMatchObject({ code: "read_conflict" });
});

it("同時再評価は候補を重複させず、同じIDとrevisionを返す", async () => {
  await createHouseholdAMaintenanceTask(db);
  const [a, b] = await Promise.all([reader().attentionGet({}), reader().attentionGet({})]);
  expect(a.candidates[0]).toEqual(b.candidates[0]);
  expect((await db.prepare("SELECT * FROM attention_candidates").all()).results).toHaveLength(1);
  expect((await db.prepare("SELECT * FROM attention_changes").all()).results).toHaveLength(1);
});

it("理由順に並べ、在庫なしへの変化では同じ候補IDを保ち、削除差分もページ上限を守る", async () => {
  const { occurrenceId } = await createHouseholdAMaintenanceTask(db);
  await db.prepare("UPDATE task_occurrences SET must_complete_by='2026-10-16' WHERE id=?").bind(occurrenceId).run();
  await db.batch(["b", "a", "c"].map((id) => db.prepare("INSERT INTO consumables(id,household_id,name,stock_status) VALUES (?,'household-a',?,'low')").bind(id, id)));
  let page = await reader().attentionGet({ limit: 2 });
  expect(page.candidates.map((c) => c.entity_id)).toEqual([occurrenceId, "a"]);
  const lowId = page.candidates[1].candidate_id;
  page = await reader().attentionGet({ limit: 2, cursor: page.next_cursor });
  expect(page.candidates.map((c) => c.entity_id)).toEqual(["b", "c"]);
  const checkpoint = page.sync_cursor;
  await db.prepare("UPDATE consumables SET stock_status='out' WHERE id='a'").run();
  await db.prepare("DELETE FROM consumables WHERE id IN ('b','c')").run();
  page = await reader().attentionGet({ limit: 2, cursor: checkpoint });
  expect(page.candidates[0]).toMatchObject({ candidate_id: lowId, reason_codes: ["stock_out"] });
  expect(page.removed_ids).toHaveLength(1);
  const next = await reader().attentionGet({ limit: 2, cursor: page.next_cursor });
  expect(next.removed_ids).toHaveLength(1);
  expect(next.removed_ids[0]).not.toBe(page.removed_ids[0]);
  expect(next.next_cursor).toBeNull();
});

it("ページを繰り返しても同じ取得の期限を延長しない", async () => {
  await db.batch(Array.from({ length: 4 }, (_, n) => db.prepare("INSERT INTO consumables(id,household_id,name,stock_status) VALUES (?,'household-a','洗剤','low')").bind(`c${n}`)));
  const first = await reader().attentionGet({ limit: 1 });
  const second = await reader(principal, new Date(now.getTime() + 840_000)).attentionGet({ limit: 1, cursor: first.next_cursor });
  await expect(reader(principal, new Date(now.getTime() + 960_000)).attentionGet({ limit: 1, cursor: second.next_cursor })).rejects.toMatchObject({ code: "cursor_expired" });
});

it("午前0時をまたぐ並行評価で前日の処理が新しい候補を消さない", async () => {
  const { occurrenceId } = await createHouseholdAMaintenanceTask(db);
  await db.prepare("UPDATE task_occurrences SET scheduled_for='2026-10-18T15:00:00Z',due_at='2026-10-20T15:00:00Z',must_complete_by='2026-10-18' WHERE id=?").bind(occurrenceId).run();
  const today = await reader(principal, new Date("2026-10-17T15:00:00Z")).attentionGet({});
  await expect(reader(principal, new Date("2026-10-17T14:59:59Z")).attentionGet({})).rejects.toMatchObject({ code: "read_conflict" });
  const again = await reader(principal, new Date("2026-10-17T15:00:01Z")).attentionGet({});
  expect(again.candidates[0].candidate_id).toBe(today.candidates[0].candidate_id);
});

it("家庭世代を作り直した場合は差分cursorも無効にする", async () => {
  const first = await reader().attentionGet({});
  await db.prepare("UPDATE household_read_versions SET epoch='replacement' WHERE household_id='household-a'").run();
  await expect(reader().attentionGet({ cursor: first.sync_cursor })).rejects.toMatchObject({ code: "invalid_cursor" });
});
