import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createConsumable } from "./consumables";
import { CROSS_SEARCH_LIMIT, searchAcrossHousehold } from "./cross-search";
import { createManagedItem } from "./managed-items";
import {
  householdAMember,
  householdBMember,
  nonMember,
  resetHouseholdFixtures,
} from "./test-support/households";
import { applyAllMigrations } from "./test-support/migrations";
import { createManualTask, createOneTimeTask, loadTodoDetail } from "./todos";

const db = env.DB;

beforeAll(async () => {
  await applyAllMigrations(db);
});

beforeEach(async () => {
  await resetHouseholdFixtures(db);
});

async function createConsumableIn(
  session: typeof householdAMember,
  name: string,
): Promise<string> {
  return createConsumable(db, session, {
    externalUrl: null,
    managedItemIds: [],
    name,
    note: null,
    productCode: null,
    taskRuleIds: [],
  });
}

async function createAssetIn(
  session: typeof householdAMember,
  name: string,
  customItemType: string | null = null,
): Promise<string> {
  return createManagedItem(db, session, {
    customItemType,
    externalUrl: null,
    itemTypeCode: null,
    kindCode: "asset",
    name,
    note: null,
    productInfo: null,
    startedOn: null,
  });
}

async function occurrenceIdForRule(ruleId: string): Promise<string> {
  const row = await db.prepare(
    "SELECT id FROM task_occurrences WHERE task_rule_id = ?1 ORDER BY created_at LIMIT 1",
  ).bind(ruleId).first<{ id: string }>();
  if (row === null) throw new Error("Test occurrence not found");
  return row.id;
}

describe("横断検索の取得 (Issue #349 / YDR-042)", () => {
  it("Todo・管理対象・消耗品を名前の部分一致で種類ごとに取得する", async () => {
    const consumableId = await createConsumableIn(householdAMember, "卵");
    const itemId = await createAssetIn(householdAMember, "卵焼き器", "調理器具");
    const ruleId = await createOneTimeTask(db, householdAMember, {
      managedItemId: null,
      scheduledFor: "2026-09-10T15:00:00.000Z",
      title: "卵を買う",
    });

    const results = await searchAcrossHousehold(db, householdAMember, "卵");

    expect(results.consumables).toEqual({
      hasMore: false,
      items: [{ id: consumableId, name: "卵", stockStatus: "available" }],
    });
    expect(results.managedItems).toEqual({
      hasMore: false,
      items: [{
        id: itemId,
        itemTypeLabel: "調理器具",
        kindCode: "asset",
        kindLabel: "備品",
        name: "卵焼き器",
      }],
    });
    expect(results.todos).toEqual({
      hasMore: false,
      items: [{
        dueAt: "2026-09-10T15:00:00.000Z",
        id: await occurrenceIdForRule(ruleId),
        managedItemId: null,
        recurrenceBasis: "once",
        scheduledFor: "2026-09-10T15:00:00.000Z",
        title: "卵を買う",
      }],
    });
  });

  // Issue #325 / YDR-046: 画面が「予定日未定」と「必要時」を区別できるよう、
  // 結果行へ有効な繰り返し方式を含める。
  it("必要になったら繰り返すTodoの繰り返し方式を結果へ含める", async () => {
    await createManualTask(db, householdAMember, {
      managedItemId: null,
      title: "コーヒーマシーンの石灰除去",
    });

    const results = await searchAcrossHousehold(db, householdAMember, "石灰");

    expect(results.todos.items).toMatchObject([{
      dueAt: null,
      recurrenceBasis: "manual",
      scheduledFor: null,
      title: "コーヒーマシーンの石灰除去",
    }]);
  });

  it("消耗品の在庫状態を結果へそのまま含める", async () => {
    const id = await createConsumableIn(householdAMember, "卵");
    await db.prepare("UPDATE consumables SET stock_status = 'low' WHERE id = ?1").bind(id).run();

    await expect(searchAcrossHousehold(db, householdAMember, "卵"))
      .resolves.toMatchObject({ consumables: { items: [{ stockStatus: "low" }] } });
  });

  it("Todoの結果IDからTodo詳細を開ける", async () => {
    const ruleId = await createOneTimeTask(db, householdAMember, {
      managedItemId: "item-a",
      scheduledFor: "2026-09-10T15:00:00.000Z",
      title: "浄水フィルター交換",
    });

    const { todos } = await searchAcrossHousehold(db, householdAMember, "フィルター");

    expect(todos.items).toHaveLength(1);
    expect(todos.items[0].managedItemId).toBe("item-a");
    await expect(loadTodoDetail(db, householdAMember, todos.items[0].id))
      .resolves.toMatchObject({ task_rule_id: ruleId, title: "浄水フィルター交換" });
  });

  it("予定日未定のTodoも名前で探せ、日付のあるTodoの後ろへ並べる", async () => {
    await createOneTimeTask(db, householdAMember, {
      managedItemId: null,
      scheduledFor: null,
      title: "掃除する",
    });
    await createOneTimeTask(db, householdAMember, {
      managedItemId: null,
      scheduledFor: "2026-09-10T15:00:00.000Z",
      title: "掃除する",
    });

    const { todos } = await searchAcrossHousehold(db, householdAMember, "掃除");

    expect(todos.items.map((todo) => todo.scheduledFor))
      .toEqual(["2026-09-10T15:00:00.000Z", null]);
  });

  it("実施済み・スキップ済みのTodoを結果へ含めない", async () => {
    const ruleId = await createOneTimeTask(db, householdAMember, {
      managedItemId: null,
      scheduledFor: "2026-09-10T15:00:00.000Z",
      title: "卵を買う",
    });
    await db.prepare("UPDATE task_occurrences SET status = 'completed' WHERE task_rule_id = ?1")
      .bind(ruleId).run();

    await expect(searchAcrossHousehold(db, householdAMember, "卵"))
      .resolves.toMatchObject({ todos: { hasMore: false, items: [] } });
  });

  // YDR-039: 「次回以降」の変更は現在回のrule_snapshotを書き換えないため、
  // TaskRuleのtitleだけを検索すると、画面に出る名前と一致しない行が結果へ出る。
  it("現在回に残る名前(rule_snapshot)で一致を判定する", async () => {
    const ruleId = await createOneTimeTask(db, householdAMember, {
      managedItemId: "item-a",
      scheduledFor: "2026-09-10T15:00:00.000Z",
      title: "浄水フィルター交換",
    });
    await db.prepare(
      "UPDATE task_rules SET title = '給水機の掃除', managed_item_id = NULL WHERE id = ?1",
    )
      .bind(ruleId).run();

    await expect(searchAcrossHousehold(db, householdAMember, "掃除"))
      .resolves.toMatchObject({ todos: { items: [] } });
    await expect(searchAcrossHousehold(db, householdAMember, "フィルター"))
      .resolves.toMatchObject({
        todos: { items: [{ managedItemId: "item-a", title: "浄水フィルター交換" }] },
      });
  });

  it("空文字・空白だけの検索語で全件を返さない", async () => {
    await createConsumableIn(householdAMember, "卵");
    await createAssetIn(householdAMember, "冷蔵庫");

    const empty = { consumables: { hasMore: false, items: [] }, managedItems: { hasMore: false, items: [] }, todos: { hasMore: false, items: [] } };
    await expect(searchAcrossHousehold(db, householdAMember, "")).resolves.toEqual(empty);
    await expect(searchAcrossHousehold(db, householdAMember, "   ")).resolves.toEqual(empty);
  });

  it("前後の空白を無視し、英数字の大文字小文字を区別しない", async () => {
    await createConsumableIn(householdAMember, "Filter Cartridge");

    await expect(searchAcrossHousehold(db, householdAMember, "  filter  "))
      .resolves.toMatchObject({ consumables: { items: [{ name: "Filter Cartridge" }] } });
  });

  it("LIKEの特殊文字をワイルドカードとして扱わない", async () => {
    await createConsumableIn(householdAMember, "10%洗剤");
    await createConsumableIn(householdAMember, "詰め替え用");

    await expect(searchAcrossHousehold(db, householdAMember, "%"))
      .resolves.toMatchObject({ consumables: { items: [{ name: "10%洗剤" }] } });
    await expect(searchAcrossHousehold(db, householdAMember, "_"))
      .resolves.toMatchObject({ consumables: { hasMore: false, items: [] } });
  });

  it("種類ごとに上限まで返し、上限を超えた種類だけ「まだ結果がある」を立てる", async () => {
    for (let index = 0; index <= CROSS_SEARCH_LIMIT; index += 1) {
      // 名前順で切られるため、通し番号は桁を揃えて並びを確定させる。
      await createConsumableIn(householdAMember, `詰め替え洗剤${String(index).padStart(2, "0")}`);
    }
    await createAssetIn(householdAMember, "詰め替えボトル");

    const { consumables, managedItems } = await searchAcrossHousehold(db, householdAMember, "詰め替え");

    expect(consumables.items).toHaveLength(CROSS_SEARCH_LIMIT);
    expect(consumables.hasMore).toBe(true);
    expect(consumables.items.at(-1)?.name).toBe("詰め替え洗剤19");
    expect(managedItems).toEqual({
      hasMore: false,
      items: [expect.objectContaining({ name: "詰め替えボトル" })],
    });
  });

  it("他家庭の対象は結果にも「まだ結果がある」の判定にも現れない", async () => {
    for (let index = 0; index <= CROSS_SEARCH_LIMIT; index += 1) {
      await createConsumableIn(householdBMember, `家庭Bの卵${String(index).padStart(2, "0")}`);
    }
    await createAssetIn(householdBMember, "家庭Bの卵焼き器");
    await createOneTimeTask(db, householdBMember, {
      managedItemId: null,
      scheduledFor: "2026-09-10T15:00:00.000Z",
      title: "家庭Bで卵を買う",
    });
    const ownConsumableId = await createConsumableIn(householdAMember, "卵");

    const results = await searchAcrossHousehold(db, householdAMember, "卵");

    expect(results.consumables).toEqual({
      hasMore: false,
      items: [{ id: ownConsumableId, name: "卵", stockStatus: "available" }],
    });
    expect(results.managedItems.items).toEqual([]);
    expect(results.todos.items).toEqual([]);
  });

  it("家庭に所属しない利用者は検索できない", async () => {
    await createConsumableIn(householdAMember, "卵");

    await expect(searchAcrossHousehold(db, nonMember, "卵")).rejects.toThrow();
  });
});
