import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { IntegrationPrincipal } from "../../features/integration/principal";
import { householdAMember, resetHouseholdFixtures } from "./test-support/households";
import {
  addFamilyMember,
  commandService,
  connectPrincipal,
  countRows,
  createEverySaturdayTodo,
  expectCommandError,
  familyCompletes,
  familyMember,
  interruptBeforeBatch,
} from "./test-support/integration-commands";
import { applyAllMigrations } from "./test-support/migrations";
import { createManagedItem, updateManagedItem, type ManagedItemWriteInput } from "./managed-items";

// 外部command todo.reschedule / managed_item.update(#437)を実D1で確かめる。
// Webの延期・編集と同じ規則と保存形であること、再送で二重に変えないこと、
// 確認の後の変化では変えないことを検証する。
const db = env.DB;
const memberA = { householdId: "household-a", userId: householdAMember.userId };

type Prepared = { fingerprint: string; operation_id: string; preview_id: string } & Record<string, unknown>;
type Service = ReturnType<typeof commandService>;

let principal: IntegrationPrincipal;

beforeAll(async () => {
  await applyAllMigrations(db);
});

beforeEach(async () => {
  await resetHouseholdFixtures(db);
  await addFamilyMember(db);
  await db.prepare("INSERT INTO tags (id, household_id, name) VALUES ('tag-a', 'household-a', '台所'), ('tag-c', 'household-a', '保証')").run();
  principal = await connectPrincipal(db, memberA);
});

function request(command: string, target: { id: string; kind: string } | undefined, payload: Record<string, unknown>) {
  return { command, operation_id: crypto.randomUUID(), payload, ...(target === undefined ? {} : { target }) };
}

function commitRequest(prepared: Prepared) {
  return { fingerprint: prepared.fingerprint, operation_id: prepared.operation_id, preview_id: prepared.preview_id };
}

async function prepare(service: Service, body: unknown): Promise<Prepared> {
  return await service.prepare(principal, body) as Prepared;
}

async function run(service: Service, body: unknown): Promise<{ result: Record<string, unknown> }> {
  const prepared = await prepare(service, body);
  return await service.commit(principal, commitRequest(prepared)) as { result: Record<string, unknown> };
}

const occurrence = (id: string) => ({ id, kind: "todo_occurrence" });
const managedItem = (id: string) => ({ id, kind: "managed_item" });

async function occurrenceDates(id: string): Promise<unknown> {
  return db.prepare("SELECT scheduled_for, due_at FROM task_occurrences WHERE id = ?1").bind(id).first();
}

async function createTodo(recurrence: Record<string, unknown>): Promise<string> {
  const committed = await run(commandService(db), request("todo.create", undefined, { recurrence, title: "点検" }));
  return (committed.result.first_occurrence as { id: string }).id;
}

describe("todo.reschedule", () => {
  it("今回の期限だけを動かし、本来の予定日は保つ", async () => {
    const occurrenceId = await createEverySaturdayTodo(db);
    const service = commandService(db);
    const prepared = await prepare(service, request("todo.reschedule", occurrence(occurrenceId), { new_due_on: "2026-10-14" }));
    expect(prepared).toMatchObject({
      diff: { due_on: { from: "2026-10-10", to: "2026-10-14" } },
      schedule_effect: { current_occurrence: { due_on: "2026-10-14", scheduled_on: "2026-10-10" } },
    });
    const committed = await service.commit(principal, commitRequest(prepared));
    expect(committed).toMatchObject({ result: { due_on: "2026-10-14", scheduled_on: "2026-10-10" } });
    await expect(occurrenceDates(occurrenceId)).resolves.toEqual({
      due_at: "2026-10-13T15:00:00.000Z",
      scheduled_for: "2026-10-09T15:00:00.000Z",
    });
    // 同じ操作の再送では、履歴を二重に残さない。
    await expect(service.commit(principal, commitRequest(prepared))).resolves.toEqual({ ...committed, replayed: true });
    await expect(countRows(db, "SELECT count(*) AS count FROM activity_logs WHERE task_occurrence_id = ?1 AND action = 'postponed'", occurrenceId))
      .resolves.toBe(1);
  });

  it("Webの延期と同じ規則で日付を拒否する", async () => {
    const service = commandService(db);
    const saturday = await createEverySaturdayTodo(db);
    const today = await expectCommandError(
      service.prepare(principal, request("todo.reschedule", occurrence(saturday), { new_due_on: "2026-10-12" })),
      "invalid_input",
    );
    expect(today.fieldErrors).toEqual({ "payload.new_due_on": "must_be_after_today" });
    const future = await createTodo({ scheduled_on: "2026-10-20", type: "one_time" });
    const early = await expectCommandError(
      service.prepare(principal, request("todo.reschedule", occurrence(future), { new_due_on: "2026-10-15" })),
      "invalid_input",
    );
    expect(early.fieldErrors).toEqual({ "payload.new_due_on": "before_scheduled_on" });
  });

  it("期限を持たない必要時・予定日未定のTodoは延期しない", async () => {
    const service = commandService(db);
    const manual = await createTodo({ type: "manual" });
    const manualError = await expectCommandError(
      service.prepare(principal, request("todo.reschedule", occurrence(manual), { new_due_on: "2026-10-20" })),
      "invalid_input",
    );
    expect(manualError.fieldErrors).toEqual({ target: "manual_todo_has_no_due" });
    const undated = await createTodo({ scheduled_on: null, type: "one_time" });
    const undatedError = await expectCommandError(
      service.prepare(principal, request("todo.reschedule", occurrence(undated), { new_due_on: "2026-10-20" })),
      "invalid_input",
    );
    expect(undatedError.fieldErrors).toEqual({ target: "undated_occurrence" });
  });

  it("確認の後に家族が完了すれば延期しない", async () => {
    const occurrenceId = await createEverySaturdayTodo(db);
    const prepared = await prepare(commandService(db), request("todo.reschedule", occurrence(occurrenceId), { new_due_on: "2026-10-14" }));
    await familyCompletes(db, occurrenceId, "2026-10-12T02:00:00.000Z");
    const error = await expectCommandError(commandService(db).commit(principal, commitRequest(prepared)), "already_resolved");
    expect(error.currentState).toEqual({ occurrence_id: occurrenceId, status: "not_pending" });
    await expect(occurrenceDates(occurrenceId)).resolves.toMatchObject({ due_at: "2026-10-09T15:00:00.000Z" });
  });
});

const DISHWASHER: ManagedItemWriteInput = {
  customItemType: null,
  externalUrl: "https://example.com/manual",
  itemTypeCode: "appliance",
  kindCode: "asset",
  name: "食洗機",
  note: "型番は扉の内側",
  productInfo: "EXAMPLE-100",
  startedOn: "2024-05",
  tags: { newTagNames: [], tagIds: ["tag-a"] },
};

const ITEM_COLUMNS = `m.name, m.kind, m.note, m.product_info, m.started_on, c.kind_code, c.item_type_code, c.custom_item_type,
  (SELECT group_concat(url) FROM external_links l WHERE l.managed_item_id = m.id) AS url,
  (SELECT group_concat(tag_id) FROM (SELECT tag_id FROM managed_item_tags t WHERE t.managed_item_id = m.id ORDER BY tag_id)) AS tags`;

async function storedItem(itemId: string): Promise<unknown> {
  return db.prepare(`SELECT ${ITEM_COLUMNS} FROM managed_items m
    JOIN managed_item_classifications c ON c.managed_item_id = m.id WHERE m.id = ?1`).bind(itemId).first();
}

function updateRequest(itemId: string, changes: Record<string, unknown>) {
  return request("managed_item.update", managedItem(itemId), { changes });
}

describe("managed_item.update", () => {
  it("指定した項目だけを変え、Webの編集と同じ保存形にする", async () => {
    const commandItem = await createManagedItem(db, householdAMember, DISHWASHER);
    const webItem = await createManagedItem(db, householdAMember, DISHWASHER);
    const service = commandService(db);
    const prepared = await prepare(service, updateRequest(commandItem, {
      external_url: null, name: "台所の食洗機", tag_ids: ["tag-a", "tag-c"],
    }));
    expect(prepared).toMatchObject({
      affected_entities: [{ change: "update", id: commandItem, kind: "managed_item", title: "食洗機" }],
      diff: {
        external_url: { from: "https://example.com/manual", to: null },
        name: { from: "食洗機", to: "台所の食洗機" },
        tag_ids: { from: ["台所"], to: ["台所", "保証"] },
      },
    });
    expect(Object.keys(prepared.diff as object).sort()).toEqual(["external_url", "name", "tag_ids"]);
    const committed = await service.commit(principal, commitRequest(prepared)) as { result: Record<string, unknown> };
    expect(committed.result.revision).toEqual(expect.stringContaining(`"managed_item","${commandItem}"`));

    await updateManagedItem(db, householdAMember, webItem, {
      ...DISHWASHER, externalUrl: null, name: "台所の食洗機", tags: { newTagNames: [], tagIds: ["tag-a", "tag-c"] },
    });
    await expect(storedItem(commandItem)).resolves.toEqual(await storedItem(webItem));
  });

  it("大分類を変えると、指定しなかった詳しい種類は未設定にする", async () => {
    const itemId = await createManagedItem(db, householdAMember, DISHWASHER);
    await run(commandService(db), updateRequest(itemId, { kind: "service" }));
    await expect(storedItem(itemId)).resolves.toMatchObject({
      custom_item_type: null, item_type_code: null, kind_code: "service", name: "食洗機", note: "型番は扉の内側",
    });
  });

  it("入力の誤りと、他の家庭の管理対象を拒否する", async () => {
    const service = commandService(db);
    const itemId = await createManagedItem(db, householdAMember, DISHWASHER);
    const empty = await expectCommandError(service.prepare(principal, updateRequest(itemId, {})), "missing_required");
    expect(empty.fieldErrors).toEqual({ "payload.changes": "at_least_one_change" });
    const name = await expectCommandError(service.prepare(principal, updateRequest(itemId, { name: null })), "invalid_input");
    expect(name.fieldErrors).toEqual({ "payload.changes.name": "not_clearable" });
    const type = await expectCommandError(service.prepare(principal, updateRequest(itemId, { item_type: "contract" })), "invalid_input");
    expect(type.fieldErrors).toEqual({ "payload.changes.item_type": "unknown_for_kind" });
    await expectCommandError(service.prepare(principal, updateRequest("item-b", { note: "x" })), "not_found");
  });

  it("確認の後に家族が編集すれば変えない", async () => {
    const itemId = await createManagedItem(db, householdAMember, DISHWASHER);
    const prepared = await prepare(commandService(db), updateRequest(itemId, { note: "会話から" }));
    await updateManagedItem(db, familyMember, itemId, { ...DISHWASHER, name: "家族が変更" });
    await expectCommandError(commandService(db).commit(principal, commitRequest(prepared)), "stale_preview");
    await expect(storedItem(itemId)).resolves.toMatchObject({ name: "家族が変更", note: "型番は扉の内側" });
  });

  it("世代を進めない経路で対象が消えても、更新0件を成功にしない", async () => {
    const itemId = await createManagedItem(db, householdAMember, DISHWASHER);
    const prepared = await prepare(commandService(db), updateRequest(itemId, { note: "会話から" }));
    // 家庭の世代を捕捉しない旧Workerの削除を再現する。削除の後に世代を元へ戻す。
    const racing = interruptBeforeBatch(db, async () => {
      const before = await db.prepare("SELECT version FROM household_read_versions WHERE household_id = 'household-a'").first<{ version: number }>();
      await db.prepare("DELETE FROM managed_items WHERE id = ?1").bind(itemId).run();
      await db.prepare("UPDATE household_read_versions SET version = ?1 WHERE household_id = 'household-a'").bind(before?.version).run();
    });
    await expectCommandError(commandService(racing).commit(principal, commitRequest(prepared)), "not_found");
    await expect(countRows(db, "SELECT count(*) AS count FROM integration_operations WHERE status = 'succeeded' AND command = 'managed_item.update'"))
      .resolves.toBe(0);
  });
});
