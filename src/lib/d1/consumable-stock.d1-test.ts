import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createConsumable,
  getConsumable,
  listShoppingCandidates,
  updateConsumableStockStatus,
} from "./consumables";
import {
  householdAMember,
  householdBMember,
  resetHouseholdFixtures,
} from "./test-support/households";
import { applyAllMigrations } from "./test-support/migrations";

const db = env.DB;

beforeAll(async () => {
  await applyAllMigrations(db);
});

beforeEach(async () => {
  await resetHouseholdFixtures(db);
});

async function createHouseholdAConsumable(): Promise<string> {
  return createConsumable(db, householdAMember, {
    externalUrl: null,
    managedItemIds: [],
    name: "トイレットペーパー",
    note: null,
    productCode: null,
    taskRuleIds: [],
  });
}

describe("Consumableの簡易在庫 (Issue #284)", () => {
  it("既存・新規の消耗品は「ある」から始まり、少ない・ないだけを買い物候補に導出する", async () => {
    const id = await createHouseholdAConsumable();

    await expect(getConsumable(db, householdAMember, id)).resolves.toMatchObject({
      stockStatus: "available",
    });
    await expect(listShoppingCandidates(db, householdAMember)).resolves.toEqual([]);

    await updateConsumableStockStatus(db, householdAMember, id, "low");
    await expect(listShoppingCandidates(db, householdAMember)).resolves.toEqual([
      { id, name: "トイレットペーパー", stockStatus: "low" },
    ]);

    await updateConsumableStockStatus(db, householdAMember, id, "out");
    await expect(listShoppingCandidates(db, householdAMember)).resolves.toEqual([
      { id, name: "トイレットペーパー", stockStatus: "out" },
    ]);

    await updateConsumableStockStatus(db, householdAMember, id, "available");
    await expect(listShoppingCandidates(db, householdAMember)).resolves.toEqual([]);
  });

  it("別家庭の利用者は在庫状態を変更できない", async () => {
    const id = await createHouseholdAConsumable();

    await expect(
      updateConsumableStockStatus(db, householdBMember, id, "out"),
    ).rejects.toThrow("消耗品が見つかりません。");
    await expect(getConsumable(db, householdAMember, id)).resolves.toMatchObject({
      stockStatus: "available",
    });
  });

  it("同じ家庭の別の利用者が状態を共有して更新できる", async () => {
    const id = await createHouseholdAConsumable();
    await db.batch([
      db.prepare("INSERT INTO users (id, email) VALUES ('user-a2', 'a2@example.com')"),
      db.prepare(
        "INSERT INTO household_members (household_id, user_id) VALUES ('household-a', 'user-a2')",
      ),
    ]);
    const secondMember = { userId: "user-a2" };

    await updateConsumableStockStatus(db, householdAMember, id, "low");
    await expect(getConsumable(db, secondMember, id)).resolves.toMatchObject({
      stockStatus: "low",
    });
    await updateConsumableStockStatus(db, secondMember, id, "available");
    await expect(getConsumable(db, householdAMember, id)).resolves.toMatchObject({
      stockStatus: "available",
    });
  });

  it("DB制約が定義外の在庫状態を拒否する", async () => {
    const id = await createHouseholdAConsumable();

    await expect(db.prepare(
      "UPDATE consumables SET stock_status = 'unknown' WHERE id = ?1",
    ).bind(id).run()).rejects.toThrow();
  });
});
