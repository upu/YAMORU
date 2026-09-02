import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createConsumable,
  getConsumable,
  recordConsumableRefill,
  updateConsumableStockStatus,
} from "./consumables";
import {
  householdAMember,
  householdBMember,
  nonMember,
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

async function createFixture(): Promise<string> {
  return createConsumable(db, householdAMember, {
    externalUrl: null,
    managedItemIds: [],
    name: "トイレットペーパー",
    note: null,
    productCode: null,
    taskRuleIds: [],
  });
}

describe("Consumableの補充履歴と家庭間分離 (Issue #310)", () => {
  it("補充ごとに履歴を追記し、在庫をあるへ戻して新しい順に共有する", async () => {
    const id = await createFixture();
    await updateConsumableStockStatus(db, householdAMember, id, "out");

    await recordConsumableRefill(db, householdAMember, id, "2026-08-20");
    await updateConsumableStockStatus(db, householdAMember, id, "low");
    await recordConsumableRefill(db, householdAMember, id, "2026-09-02");

    await db.batch([
      db.prepare("INSERT INTO users (id, email) VALUES ('user-a2', 'a2@example.com')"),
      db.prepare("INSERT INTO household_members (household_id, user_id) VALUES ('household-a', 'user-a2')"),
    ]);
    const shared = await getConsumable(
      db,
      { email: "a2@example.com", userId: "user-a2" },
      id,
    );

    expect(shared?.stockStatus).toBe("available");
    expect(shared?.refills.map(({ refilledOn }) => refilledOn))
      .toEqual(["2026-09-02", "2026-08-20"]);
    expect(shared?.refills).toEqual([
      expect.objectContaining({ recordedAt: expect.any(String), refilledOn: "2026-09-02" }),
      expect.objectContaining({ recordedAt: expect.any(String), refilledOn: "2026-08-20" }),
    ]);
  });

  it("通常の在庫状態変更では補充履歴を作らない", async () => {
    const id = await createFixture();

    await updateConsumableStockStatus(db, householdAMember, id, "low");
    await updateConsumableStockStatus(db, householdAMember, id, "available");

    await expect(getConsumable(db, householdAMember, id)).resolves.toMatchObject({
      refills: [],
      stockStatus: "available",
    });
  });

  it("他家庭・未認証・家庭未所属の利用者は補充履歴を追加・参照できない", async () => {
    const id = await createFixture();

    await expect(recordConsumableRefill(db, householdBMember, id, "2026-09-02"))
      .rejects.toThrow("消耗品が見つかりません。");
    await expect(recordConsumableRefill(db, null, id, "2026-09-02"))
      .rejects.toThrow("認証が必要です。");
    await expect(recordConsumableRefill(db, nonMember, id, "2026-09-02"))
      .rejects.toThrow("家庭への所属が必要です。");
    await expect(getConsumable(db, householdBMember, id)).resolves.toBeNull();
  });

  it("履歴追加が失敗した場合は在庫状態も変更しない", async () => {
    const id = await createFixture();
    await updateConsumableStockStatus(db, householdAMember, id, "out");

    await expect(recordConsumableRefill(db, householdAMember, id, "2026-02-30"))
      .rejects.toThrow();

    await expect(getConsumable(db, householdAMember, id)).resolves.toMatchObject({
      refills: [],
      stockStatus: "out",
    });
  });
});
