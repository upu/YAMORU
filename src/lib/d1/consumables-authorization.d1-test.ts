import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createConsumable,
  getConsumable,
  listConsumables,
  listConsumablesForManagedItem,
  listConsumablesForTaskRule,
  updateConsumable,
} from "./consumables";
import {
  createHouseholdAMaintenanceTask,
  householdAMember,
  householdBMember,
  nonMember,
  resetHouseholdFixtures,
} from "./test-support/households";
import { applyAllMigrations } from "./test-support/migrations";
import { createMaintenanceTask } from "./todos";

const db = env.DB;

beforeAll(async () => {
  await applyAllMigrations(db);
});

beforeEach(async () => {
  await resetHouseholdFixtures(db);
});

describe("Consumableの登録・関連・家庭間分離 (Issue #44)", () => {
  it("管理対象やTodoとの関連なしで家庭の消耗品を登録・一覧表示できる", async () => {
    const id = await createConsumable(db, householdAMember, {
      externalUrl: "https://example.com/toilet-paper",
      managedItemIds: [],
      name: "トイレットペーパー",
      note: "収納棚の上段",
      productCode: "TP-12",
      taskRuleIds: [],
    });

    await expect(listConsumables(db, householdAMember)).resolves.toEqual([
      expect.objectContaining({ id, name: "トイレットペーパー" }),
    ]);
    await expect(getConsumable(db, householdAMember, id)).resolves.toEqual({
      externalUrl: "https://example.com/toilet-paper",
      id,
      managedItems: [],
      name: "トイレットペーパー",
      note: "収納棚の上段",
      productCode: "TP-12",
      stockStatus: "available",
      taskRules: [],
    });
    await expect(listConsumables(db, householdBMember)).resolves.toEqual([]);
  });

  it("同じ消耗品を複数のManagedItemとメンテナンスTaskRuleへ関連付けられる", async () => {
    await db.prepare(
      "INSERT INTO managed_items (id, household_id, name, kind) VALUES ('item-a2','household-a','Item A2','other')",
    ).run();
    const { ruleId } = await createHouseholdAMaintenanceTask(db);

    const id = await createConsumable(db, householdAMember, {
      externalUrl: null,
      managedItemIds: ["item-a", "item-a2"],
      name: "共用洗剤",
      note: null,
      productCode: null,
      taskRuleIds: [ruleId],
    });

    await expect(listConsumablesForManagedItem(db, householdAMember, "item-a"))
      .resolves.toEqual([expect.objectContaining({ id, name: "共用洗剤" })]);
    await expect(listConsumablesForManagedItem(db, householdAMember, "item-a2"))
      .resolves.toEqual([expect.objectContaining({ id, name: "共用洗剤" })]);
    await expect(listConsumablesForTaskRule(db, householdAMember, ruleId))
      .resolves.toEqual([expect.objectContaining({ id, name: "共用洗剤" })]);
  });

  it("関連をすべて解除してもConsumable自体と参照情報は残る", async () => {
    const { ruleId } = await createHouseholdAMaintenanceTask(db);
    const id = await createConsumable(db, householdAMember, {
      externalUrl: null,
      managedItemIds: ["item-a"],
      name: "交換フィルター",
      note: null,
      productCode: null,
      taskRuleIds: [ruleId],
    });

    await updateConsumable(db, householdAMember, id, {
      externalUrl: "https://example.com/filter",
      managedItemIds: [],
      name: "交換フィルター",
      note: "型番を確認する",
      productCode: "FILTER-A",
      taskRuleIds: [],
    });

    await expect(getConsumable(db, householdAMember, id)).resolves.toEqual({
      externalUrl: "https://example.com/filter",
      id,
      managedItems: [],
      name: "交換フィルター",
      note: "型番を確認する",
      productCode: "FILTER-A",
      stockStatus: "available",
      taskRules: [],
    });
  });

  it("別家庭のManagedItemやTaskRuleとの関連は全体をロールバックする", async () => {
    const bRuleId = await createMaintenanceTask(db, householdBMember, {
      firstDueAt: "2026-09-10T15:00:00.000Z",
      firstScheduledFor: "2026-09-01T15:00:00.000Z",
      managedItemId: "item-b",
      recommendedStartOffset: 1,
      recommendedUntilOffset: 2,
      title: "B maintenance",
    });

    await expect(createConsumable(db, householdAMember, {
      externalUrl: null,
      managedItemIds: ["item-b"],
      name: "越境させない消耗品",
      note: null,
      productCode: null,
      taskRuleIds: [bRuleId],
    })).rejects.toThrow();

    await expect(db.prepare(
      "SELECT count(*) AS count FROM consumables WHERE name = '越境させない消耗品'",
    ).first<{ count: number }>()).resolves.toMatchObject({ count: 0 });
  });

  it("他家庭のConsumable IDは参照・更新できない", async () => {
    const id = await createConsumable(db, householdBMember, {
      externalUrl: null,
      managedItemIds: [],
      name: "Bだけの消耗品",
      note: null,
      productCode: null,
      taskRuleIds: [],
    });

    await expect(getConsumable(db, householdAMember, id)).resolves.toBeNull();
    await expect(updateConsumable(db, householdAMember, id, {
      externalUrl: null,
      managedItemIds: [],
      name: "書き換え不可",
      note: null,
      productCode: null,
      taskRuleIds: [],
    })).rejects.toThrow("消耗品が見つかりません。");
  });

  it("未認証・家庭未所属の利用者は読み書きできない", async () => {
    await expect(listConsumables(db, null)).rejects.toThrow("認証が必要です。");
    await expect(createConsumable(db, nonMember, {
      externalUrl: null,
      managedItemIds: [],
      name: "登録不可",
      note: null,
      productCode: null,
      taskRuleIds: [],
    })).rejects.toThrow("家庭への所属が必要です。");
  });
});
