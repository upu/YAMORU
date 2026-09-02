import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createConsumable,
  getConsumable,
  setConsumableManagedItemRelation,
  setConsumableTaskRuleRelation,
} from "./consumables";
import {
  createHouseholdAMaintenanceTask,
  householdAMember,
  householdBMember,
  nonMember,
  resetHouseholdFixtures,
} from "./test-support/households";
import { applyAllMigrations } from "./test-support/migrations";
import { createMaintenanceTask, createOneTimeTask } from "./todos";

const db = env.DB;

async function createConsumableForA(name: string): Promise<string> {
  return createConsumable(db, householdAMember, {
    externalUrl: null,
    managedItemIds: [],
    name,
    note: null,
    productCode: null,
    taskRuleIds: [],
  });
}

async function relationCounts(consumableId: string): Promise<{
  managedItems: number;
  taskRules: number;
}> {
  const managedItems = await db.prepare(
    "SELECT count(*) AS count FROM managed_item_consumables WHERE consumable_id = ?1",
  ).bind(consumableId).first<{ count: number }>();
  const taskRules = await db.prepare(
    "SELECT count(*) AS count FROM task_rule_consumables WHERE consumable_id = ?1",
  ).bind(consumableId).first<{ count: number }>();
  return { managedItems: managedItems.count, taskRules: taskRules.count };
}

beforeAll(async () => {
  await applyAllMigrations(db);
});

beforeEach(async () => {
  await resetHouseholdFixtures(db);
});

// Issue #311: 消耗品詳細から関連を1件ずつ追加・解除する。
describe("消耗品の関連の個別追加・解除 (Issue #311)", () => {
  it("管理対象とTodoを1件ずつ追加・解除でき、Consumable自体は残る", async () => {
    const { ruleId } = await createHouseholdAMaintenanceTask(db);
    const id = await createConsumableForA("交換フィルター");

    await setConsumableManagedItemRelation(db, householdAMember, id, "item-a", true);
    await setConsumableTaskRuleRelation(db, householdAMember, id, ruleId, true);

    await expect(getConsumable(db, householdAMember, id)).resolves.toMatchObject({
      managedItems: [{ id: "item-a", name: "Item A" }],
      taskRules: [expect.objectContaining({ id: ruleId })],
    });

    await setConsumableManagedItemRelation(db, householdAMember, id, "item-a", false);
    await setConsumableTaskRuleRelation(db, householdAMember, id, ruleId, false);

    await expect(getConsumable(db, householdAMember, id)).resolves.toMatchObject({
      managedItems: [],
      name: "交換フィルター",
      taskRules: [],
    });
  });

  it("同じ関連を重ねて追加しても1件のままにし、解除の繰り返しも失敗しない", async () => {
    const { ruleId } = await createHouseholdAMaintenanceTask(db);
    const id = await createConsumableForA("共用洗剤");

    await setConsumableManagedItemRelation(db, householdAMember, id, "item-a", true);
    await setConsumableManagedItemRelation(db, householdAMember, id, "item-a", true);
    await setConsumableTaskRuleRelation(db, householdAMember, id, ruleId, true);
    await setConsumableTaskRuleRelation(db, householdAMember, id, ruleId, true);

    await expect(relationCounts(id)).resolves.toEqual({ managedItems: 1, taskRules: 1 });

    await setConsumableManagedItemRelation(db, householdAMember, id, "item-a", false);
    await setConsumableManagedItemRelation(db, householdAMember, id, "item-a", false);

    await expect(relationCounts(id)).resolves.toEqual({ managedItems: 0, taskRules: 1 });
  });

  it("他の関連には触れずに、指定した1件だけを解除する", async () => {
    await db.prepare(
      "INSERT INTO managed_items (id, household_id, name, kind) VALUES ('item-a2','household-a','Item A2','other')",
    ).run();
    const id = await createConsumable(db, householdAMember, {
      externalUrl: null,
      managedItemIds: ["item-a", "item-a2"],
      name: "共用洗剤",
      note: null,
      productCode: null,
      taskRuleIds: [],
    });

    await setConsumableManagedItemRelation(db, householdAMember, id, "item-a", false);

    await expect(getConsumable(db, householdAMember, id)).resolves.toMatchObject({
      managedItems: [{ id: "item-a2", name: "Item A2" }],
    });
  });

  it("他家庭の管理対象・Todoは追加できず、関連も増えない", async () => {
    const bRuleId = await createMaintenanceTask(db, householdBMember, {
      firstDueAt: "2026-09-10T15:00:00.000Z",
      firstScheduledFor: "2026-09-01T15:00:00.000Z",
      managedItemId: "item-b",
      recommendedStartOffset: 1,
      recommendedUntilOffset: 2,
      title: "B maintenance",
    });
    const id = await createConsumableForA("越境させない消耗品");

    await expect(
      setConsumableManagedItemRelation(db, householdAMember, id, "item-b", true),
    ).rejects.toThrow();
    await expect(
      setConsumableTaskRuleRelation(db, householdAMember, id, bRuleId, true),
    ).rejects.toThrow();

    await expect(relationCounts(id)).resolves.toEqual({ managedItems: 0, taskRules: 0 });
  });

  it("他家庭の消耗品と、家庭に属さない利用者の操作を拒む", async () => {
    const bId = await createConsumable(db, householdBMember, {
      externalUrl: null,
      managedItemIds: [],
      name: "Bだけの消耗品",
      note: null,
      productCode: null,
      taskRuleIds: [],
    });
    const aId = await createConsumableForA("Aだけの消耗品");

    await expect(
      setConsumableManagedItemRelation(db, householdAMember, bId, "item-a", true),
    ).rejects.toThrow("消耗品が見つかりません。");
    await expect(
      setConsumableManagedItemRelation(db, nonMember, aId, "item-a", true),
    ).rejects.toThrow("家庭への所属が必要です。");
    await expect(
      setConsumableManagedItemRelation(db, null, aId, "item-a", true),
    ).rejects.toThrow("認証が必要です。");

    await expect(relationCounts(bId)).resolves.toEqual({ managedItems: 0, taskRules: 0 });
    await expect(relationCounts(aId)).resolves.toEqual({ managedItems: 0, taskRules: 0 });
  });

  it("期限のあるTodoは関連付けの対象にしない", async () => {
    const strictRuleId = await createOneTimeTask(db, householdAMember, {
      managedItemId: "item-a",
      scheduledFor: "2026-09-01T15:00:00.000Z",
      title: "期限のあるTodo",
    });
    const id = await createConsumableForA("交換フィルター");

    await expect(
      setConsumableTaskRuleRelation(db, householdAMember, id, strictRuleId, true),
    ).rejects.toThrow();
  });
});
