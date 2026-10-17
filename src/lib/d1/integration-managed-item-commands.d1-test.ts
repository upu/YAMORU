import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { IntegrationPrincipal } from "../../features/integration/principal";
import { householdAMember, resetHouseholdFixtures } from "./test-support/households";
import {
  addFamilyMember,
  commandService,
  connectPrincipal,
  countRows,
  expectCommandError,
  familyMember,
  interruptBeforeBatch,
} from "./test-support/integration-commands";
import { applyAllMigrations } from "./test-support/migrations";
import { createManagedItem } from "./managed-items";

// 外部command managed_item.create / managed_item_with_todo.create(#437)を
// 実D1で確かめる。Webの登録と同じ規則・保存形で作ること、管理対象とTodoの
// 同時登録がどちらか一方だけを残さないこと、再送で二重に作らないことを検証する。
const db = env.DB;
const memberA = { householdId: "household-a", userId: householdAMember.userId };

type Prepared = { fingerprint: string; operation_id: string; preview_id: string } & Record<string, unknown>;
type Service = ReturnType<typeof commandService>;
type Committed = { result: Record<string, unknown> & { managed_item_id: string } };
type CombinedCommitted = {
  result: {
    managed_item: { managed_item_id: string; revision: string };
    todo: { first_occurrence: { id: string }; revision: string; todo_rule_id: string };
  };
};

let principal: IntegrationPrincipal;

beforeAll(async () => {
  await applyAllMigrations(db);
});

beforeEach(async () => {
  await resetHouseholdFixtures(db);
  await addFamilyMember(db);
  await db.batch([
    db.prepare("INSERT INTO tags (id, household_id, name) VALUES ('tag-a', 'household-a', '台所'), ('tag-b', 'household-b', '庭')"),
  ]);
  principal = await connectPrincipal(db, memberA);
});

function request(command: string, payload: Record<string, unknown>, operationId = crypto.randomUUID()) {
  return { command, operation_id: operationId, payload };
}

function commitRequest(prepared: Prepared) {
  return { fingerprint: prepared.fingerprint, operation_id: prepared.operation_id, preview_id: prepared.preview_id };
}

async function prepare(service: Service, body: unknown): Promise<Prepared> {
  return await service.prepare(principal, body) as Prepared;
}

async function run<T>(service: Service, command: string, payload: Record<string, unknown>): Promise<T> {
  const prepared = await prepare(service, request(command, payload));
  return await service.commit(principal, commitRequest(prepared)) as T;
}

const DISHWASHER = {
  external_url: "https://example.com/manual",
  item_type: "appliance",
  kind: "asset",
  name: "食洗機",
  note: "  型番は扉の内側  ",
  product_info: "EXAMPLE-100",
  started_on: "2024-05",
  tag_ids: ["tag-a"],
};

const ITEM_COLUMNS = `m.name, m.kind, m.note, m.product_info, m.started_on, c.kind_code, c.item_type_code, c.custom_item_type,
  (SELECT url FROM external_links l WHERE l.managed_item_id = m.id) AS url,
  (SELECT group_concat(tag_id) FROM managed_item_tags t WHERE t.managed_item_id = m.id) AS tags`;

async function storedItem(itemId: string): Promise<unknown> {
  return db.prepare(`SELECT ${ITEM_COLUMNS} FROM managed_items m
    JOIN managed_item_classifications c ON c.managed_item_id = m.id WHERE m.id = ?1`).bind(itemId).first();
}

describe("managed_item.create", () => {
  it("Webの登録と同じ保存形で作り、previewで作る内容を示す", async () => {
    const service = commandService(db);
    const prepared = await prepare(service, request("managed_item.create", DISHWASHER));
    expect(prepared).toMatchObject({
      affected_entities: [{ change: "create", id: null, kind: "managed_item", title: "食洗機" }],
      diff: { note: "型番は扉の内側", started_on: "2024-05", tags: [{ id: "tag-a", name: "台所" }] },
    });
    const committed = await service.commit(principal, commitRequest(prepared)) as Committed;
    expect(committed.result).toMatchObject({ detail_url: `/managed-items/${committed.result.managed_item_id}`, name: "食洗機" });
    expect(committed.result.revision).toEqual(expect.stringContaining(`"managed_item","${committed.result.managed_item_id}"`));

    const webItemId = await createManagedItem(db, householdAMember, {
      customItemType: null,
      externalUrl: "https://example.com/manual",
      itemTypeCode: "appliance",
      kindCode: "asset",
      name: "食洗機",
      note: "型番は扉の内側",
      productInfo: "EXAMPLE-100",
      startedOn: "2024-05",
      tags: { newTagNames: [], tagIds: ["tag-a"] },
    });
    await expect(storedItem(committed.result.managed_item_id)).resolves.toEqual(await storedItem(webItemId));
  });

  it("同じ操作の再送では二重に作らない", async () => {
    const service = commandService(db);
    const prepared = await prepare(service, request("managed_item.create", { kind: "service", name: "自治会費" }));
    const first = await service.commit(principal, commitRequest(prepared));
    await expect(service.commit(principal, commitRequest(prepared))).resolves.toEqual({ ...first, replayed: true });
    await expect(countRows(db, "SELECT count(*) AS count FROM managed_items WHERE name = '自治会費'")).resolves.toBe(1);
  });

  it("自由入力の詳しい種類を、プリセットとは別に保存する", async () => {
    const committed = await run<Committed>(commandService(db), "managed_item.create", {
      custom_item_type: "  浄水器  ", kind: "asset", name: "浄水器",
    });
    await expect(storedItem(committed.result.managed_item_id)).resolves.toMatchObject({
      custom_item_type: "浄水器", item_type_code: null, kind_code: "asset",
    });
  });
});

describe("managed_item.createの入力の確認", () => {
  const prepareItem = (payload: Record<string, unknown>) =>
    commandService(db).prepare(principal, request("managed_item.create", payload));

  it("名前と大分類が無ければ、足りない項目として返す", async () => {
    const name = await expectCommandError(prepareItem({ kind: "asset" }), "missing_required");
    expect(name.fieldErrors).toEqual({ "payload.name": "required" });
    const kind = await expectCommandError(prepareItem({ name: "食洗機" }), "missing_required");
    expect(kind.fieldErrors).toEqual({ "payload.kind": "required" });
  });

  it("Webと同じ規則で不正な値を拒否する", async () => {
    const cases: [Record<string, unknown>, Record<string, string>][] = [
      [{ kind: "asset", name: "x".repeat(101) }, { "payload.name": "invalid_length" }],
      [{ kind: "asset", name: "x", external_url: "javascript:alert(1)" }, { "payload.external_url": "http_or_https_url_required" }],
      [{ kind: "asset", name: "x", started_on: "2024-02-30" }, { "payload.started_on": "year_month_or_day_required" }],
      [{ kind: "asset", name: "x", started_on: "2024-5" }, { "payload.started_on": "year_month_or_day_required" }],
      [{ kind: "asset", name: "x", product_info: "x".repeat(201) }, { "payload.product_info": "too_long" }],
      [{ custom_item_type: "y", item_type: "appliance", kind: "asset", name: "x" }, { payload: "item_type_or_custom_item_type" }],
    ];
    for (const [payload, fieldErrors] of cases) {
      const error = await expectCommandError(prepareItem(payload), "invalid_input");
      expect(error.fieldErrors).toEqual(fieldErrors);
    }
  });

  it("現在選べない分類や、他の家庭のタグは使えない", async () => {
    const retired = await expectCommandError(prepareItem({ kind: "other", name: "x" }), "invalid_input");
    expect(retired.fieldErrors).toEqual({ "payload.kind": "unknown_kind" });
    const mismatch = await expectCommandError(prepareItem({ item_type: "contract", kind: "asset", name: "x" }), "invalid_input");
    expect(mismatch.fieldErrors).toEqual({ "payload.item_type": "unknown_for_kind" });
    const tag = await expectCommandError(prepareItem({ kind: "asset", name: "x", tag_ids: ["tag-a", "tag-b"] }), "invalid_input");
    expect(tag.fieldErrors).toEqual({ "payload.tag_ids": "not_found" });
  });
});

describe("managed_item_with_todo.create", () => {
  const FILTER_TODO = {
    recurrence: { first_scheduled_on: "2026-10-17", max: 3, min: 3, type: "completion", unit: "month" },
    title: "フィルター掃除",
  };

  it("管理対象と、それへ関連付けたTodoを一度に作る", async () => {
    const service = commandService(db);
    const prepared = await prepare(service, request("managed_item_with_todo.create", {
      managed_item: { item_type: "appliance", kind: "asset", name: "エアコン" },
      todo: { ...FILTER_TODO, assignee_id: familyMember.userId },
    }));
    expect(prepared).toMatchObject({
      affected_entities: [
        { change: "create", kind: "managed_item", title: "エアコン" },
        { change: "create", kind: "todo_rule", title: "フィルター掃除" },
      ],
      schedule_effect: { first_occurrence: { scheduled_on: "2026-10-17" }, recurrence: "completion" },
    });
    const committed = await service.commit(principal, commitRequest(prepared)) as CombinedCommitted;
    await expect(db.prepare(`SELECT r.managed_item_id, o.assignee_user_id, m.name FROM task_occurrences o
      JOIN task_rules r ON r.id = o.task_rule_id JOIN managed_items m ON m.id = r.managed_item_id
      WHERE o.id = ?1`).bind(committed.result.todo.first_occurrence.id).first()).resolves.toEqual({
      assignee_user_id: familyMember.userId,
      managed_item_id: committed.result.managed_item.managed_item_id,
      name: "エアコン",
    });

    // 作った管理対象・Todoのどちらにも、続けて使えるrevisionを返す。
    const occurrenceId = committed.result.todo.first_occurrence.id;
    expect(committed.result.managed_item.revision)
      .toEqual(expect.stringContaining(`"managed_item","${committed.result.managed_item.managed_item_id}"`));
    expect(committed.result.todo.revision).toEqual(expect.stringContaining(`"todo_occurrence","${occurrenceId}"`));
    await expect(prepare(service, {
      command: "todo.complete",
      expected_revision: committed.result.todo.revision,
      operation_id: crypto.randomUUID(),
      payload: { occurred_on: "2026-10-12" },
      target: { id: occurrenceId, kind: "todo_occurrence" },
    })).resolves.toMatchObject({ affected_entities: [{ id: occurrenceId, kind: "todo_occurrence" }] });
  });

  it("Todoの登録が実行時に失敗すれば、管理対象も作らない", async () => {
    const prepared = await prepare(commandService(db), request("managed_item_with_todo.create", {
      managed_item: { kind: "asset", name: "エアコン" },
      todo: { ...FILTER_TODO, assignee_id: familyMember.userId },
    }));
    // 担当にした家族が、確認の後に家庭を離れる。家庭の世代は進まないため
    // batchまで進み、Occurrenceの担当の外部キーでbatch全体が取り消される。
    const racing = interruptBeforeBatch(db, async () => {
      await db.prepare("DELETE FROM household_members WHERE user_id = ?1").bind(familyMember.userId).run();
    });
    const error = await expectCommandError(commandService(racing).commit(principal, commitRequest(prepared)), "invalid_input");
    expect(error.fieldErrors).toEqual({ "payload.todo.assignee_id": "not_in_household" });
    await expect(countRows(db, "SELECT count(*) AS count FROM managed_items WHERE name = 'エアコン'")).resolves.toBe(0);
    await expect(countRows(db, "SELECT count(*) AS count FROM task_rules WHERE title = 'フィルター掃除'")).resolves.toBe(0);
  });

  it("確認の後に家庭の世代が進めば、どちらも作らない", async () => {
    const prepared = await prepare(commandService(db), request("managed_item_with_todo.create", {
      managed_item: { kind: "asset", name: "エアコン" },
      todo: FILTER_TODO,
    }));
    const racing = interruptBeforeBatch(db, async () => {
      await db.prepare("UPDATE managed_items SET name = '名前だけ変更' WHERE id = 'item-a'").run();
    });
    await expectCommandError(commandService(racing).commit(principal, commitRequest(prepared)), "stale_preview");
    await expect(countRows(db, "SELECT count(*) AS count FROM managed_items WHERE name = 'エアコン'")).resolves.toBe(0);
  });

  it("入力の誤りはpayload.managed_item・payload.todo配下の項目として返す", async () => {
    const service = commandService(db);
    const prepareCombined = (payload: Record<string, unknown>) =>
      service.prepare(principal, request("managed_item_with_todo.create", payload));
    const todoMissing = await expectCommandError(prepareCombined({
      managed_item: { kind: "asset", name: "x" },
      todo: { recurrence: { max: 7, min: 7, type: "completion", unit: "day" }, title: "掃除" },
    }), "missing_required");
    expect(todoMissing.fieldErrors).toEqual({ "payload.todo.recurrence.first_scheduled_on": "required" });
    const linked = await expectCommandError(prepareCombined({
      managed_item: { kind: "asset", name: "x" },
      todo: { ...FILTER_TODO, managed_item_id: "item-a" },
    }), "invalid_input");
    expect(linked.fieldErrors).toEqual({ "payload.todo.managed_item_id": "unknown_field" });
    const assignee = await expectCommandError(prepareCombined({
      managed_item: { kind: "asset", name: "x" },
      todo: { ...FILTER_TODO, assignee_id: "user-b" },
    }), "invalid_input");
    expect(assignee.fieldErrors).toEqual({ "payload.todo.assignee_id": "not_in_household" });
    const item = await expectCommandError(prepareCombined({ managed_item: { kind: "asset" }, todo: FILTER_TODO }), "missing_required");
    expect(item.fieldErrors).toEqual({ "payload.managed_item.name": "required" });
  });
});
