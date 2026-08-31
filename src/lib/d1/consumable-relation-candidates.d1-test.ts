import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  CONSUMABLE_CANDIDATE_LIMIT,
  searchConsumableManagedItemCandidates,
  searchConsumableTaskRuleCandidates,
} from "./consumable-relations";
import {
  householdAMember,
  householdBMember,
  nonMember,
  resetHouseholdFixtures,
} from "./test-support/households";
import { applyAllMigrations } from "./test-support/migrations";
import { createMaintenanceTask, createOneTimeTask } from "./todos";

const db = env.DB;

async function insertManagedItem(id: string, householdId: string, name: string): Promise<void> {
  await db.prepare(
    "INSERT INTO managed_items (id, household_id, name, kind) VALUES (?1, ?2, ?3, 'other')",
  ).bind(id, householdId, name).run();
}

async function maintenanceTask(
  session: typeof householdAMember,
  managedItemId: string | null,
  title: string,
): Promise<string> {
  return createMaintenanceTask(db, session, {
    firstDueAt: "2026-09-10T15:00:00.000Z",
    firstScheduledFor: "2026-09-01T15:00:00.000Z",
    managedItemId,
    recommendedStartOffset: 1,
    recommendedUntilOffset: 2,
    title,
  });
}

function names(items: { name: string }[]): string[] {
  return items.map(({ name }) => name);
}

function titles(items: { title: string }[]): string[] {
  return items.map(({ title }) => title);
}

beforeAll(async () => {
  await applyAllMigrations(db);
});

beforeEach(async () => {
  await resetHouseholdFixtures(db);
});

describe("消耗品の関連付け候補の検索 (Issue #292)", () => {
  it("家庭内の管理対象だけを名前で絞り込み、他家庭の候補は返さない", async () => {
    await insertManagedItem("item-a2", "household-a", "猫の給水機");
    await insertManagedItem("item-b2", "household-b", "猫のトイレ");

    await expect(searchConsumableManagedItemCandidates(db, householdAMember, ""))
      .resolves.toEqual({ hasMore: false, items: [
        { id: "item-a", name: "Item A" },
        { id: "item-a2", name: "猫の給水機" },
      ] });
    await expect(searchConsumableManagedItemCandidates(db, householdAMember, "猫"))
      .resolves.toEqual({ hasMore: false, items: [{ id: "item-a2", name: "猫の給水機" }] });
    await expect(searchConsumableManagedItemCandidates(db, householdBMember, "猫"))
      .resolves.toEqual({ hasMore: false, items: [{ id: "item-b2", name: "猫のトイレ" }] });
  });

  it("上限を超える候補はhasMoreで伝え、1回の取得件数を区切る", async () => {
    for (let index = 0; index <= CONSUMABLE_CANDIDATE_LIMIT; index += 1) {
      await insertManagedItem(`item-many-${String(index)}`, "household-a", `棚${String(index)}`);
    }

    const page = await searchConsumableManagedItemCandidates(db, householdAMember, "棚");

    expect(page.hasMore).toBe(true);
    expect(page.items).toHaveLength(CONSUMABLE_CANDIDATE_LIMIT);
  });

  it("LIKEのワイルドカードは文字通りの検索語として扱う", async () => {
    await insertManagedItem("item-a3", "household-a", "100%ジュースの棚");

    await expect(searchConsumableManagedItemCandidates(db, householdAMember, "%"))
      .resolves.toEqual({ hasMore: false, items: [{ id: "item-a3", name: "100%ジュースの棚" }] });
  });

  it("メンテナンスTodoだけを候補にし、管理対象名を添えて返す", async () => {
    await maintenanceTask(householdAMember, "item-a", "給水機を掃除する");
    await maintenanceTask(householdAMember, null, "洗剤を補充する");
    await createOneTimeTask(db, householdAMember, {
      managedItemId: "item-a",
      scheduledFor: "2026-09-01T15:00:00.000Z",
      title: "期限のあるTodo",
    });

    const page = await searchConsumableTaskRuleCandidates(db, householdAMember, "", []);

    expect(page.items).toEqual([
      expect.objectContaining({ managedItemName: null, title: "洗剤を補充する" }),
      expect.objectContaining({ managedItemName: "Item A", title: "給水機を掃除する" }),
    ]);
  });

  it("選択済みの管理対象のTodoを先頭へ寄せつつ、他のTodoも検索できる", async () => {
    await insertManagedItem("item-a2", "household-a", "お風呂");
    await maintenanceTask(householdAMember, "item-a2", "お風呂の掃除をする");
    await maintenanceTask(householdAMember, "item-a", "Item Aの掃除をする");
    await maintenanceTask(householdAMember, null, "共通の掃除をする");

    await expect(searchConsumableTaskRuleCandidates(db, householdAMember, "掃除", ["item-a2"]))
      .resolves.toMatchObject({ hasMore: false });
    const related = await searchConsumableTaskRuleCandidates(
      db,
      householdAMember,
      "掃除",
      ["item-a2"],
    );

    expect(titles(related.items)).toEqual([
      "お風呂の掃除をする",
      "Item Aの掃除をする",
      "共通の掃除をする",
    ]);
  });

  it("Todoは関連する管理対象名でも検索できる", async () => {
    await insertManagedItem("item-a2", "household-a", "猫の給水機");
    await maintenanceTask(householdAMember, "item-a2", "フィルター交換");
    await maintenanceTask(householdAMember, null, "ごみ出し");

    const page = await searchConsumableTaskRuleCandidates(db, householdAMember, "給水機", []);

    expect(titles(page.items)).toEqual(["フィルター交換"]);
  });

  it("他家庭のTodoは検索語や選択済み管理対象を渡しても候補にならない", async () => {
    await maintenanceTask(householdBMember, "item-b", "Bだけの点検");

    await expect(searchConsumableTaskRuleCandidates(db, householdAMember, "点検", ["item-b"]))
      .resolves.toEqual({ hasMore: false, items: [] });
    await expect(names(
      (await searchConsumableManagedItemCandidates(db, householdAMember, "")).items,
    )).toEqual(["Item A"]);
  });

  it("未認証・家庭未所属の利用者は候補を取得できない", async () => {
    await expect(searchConsumableManagedItemCandidates(db, null, ""))
      .rejects.toThrow("認証が必要です。");
    await expect(searchConsumableTaskRuleCandidates(db, nonMember, "", []))
      .rejects.toThrow("家庭への所属が必要です。");
  });
});
