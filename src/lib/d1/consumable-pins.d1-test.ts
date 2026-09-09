import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createConsumable,
  getConsumable,
} from "./consumables";
import {
  listPinnedConsumables,
  setConsumablePinned,
} from "./consumable-pins";
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

async function createConsumableFor(
  session: { userId: string },
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

describe("個人別のConsumableピン留め (Issue #345, #375)", () => {
  it("同じ家庭でも利用者ごとに独立して登録・解除できる", async () => {
    await db.batch([
      db.prepare("INSERT INTO users (id, email) VALUES ('user-a2', 'a2@example.com')"),
      db.prepare(
        "INSERT INTO household_members (household_id, user_id) VALUES ('household-a', 'user-a2')",
      ),
    ]);
    const secondMember = { userId: "user-a2" };
    const eggsId = await createConsumableFor(householdAMember, "卵");
    const paperId = await createConsumableFor(householdAMember, "トイレットペーパー");

    await setConsumablePinned(db, householdAMember, eggsId, true);
    await setConsumablePinned(db, secondMember, paperId, true);

    await expect(listPinnedConsumables(db, householdAMember)).resolves.toEqual([
      expect.objectContaining({ id: eggsId, name: "卵" }),
    ]);
    await expect(listPinnedConsumables(db, secondMember)).resolves.toEqual([
      expect.objectContaining({ id: paperId, name: "トイレットペーパー" }),
    ]);
    await expect(getConsumable(db, householdAMember, eggsId)).resolves.toMatchObject({
      isPinned: true,
    });
    await expect(getConsumable(db, secondMember, eggsId)).resolves.toMatchObject({
      isPinned: false,
    });

    await setConsumablePinned(db, householdAMember, eggsId, false);
    await expect(listPinnedConsumables(db, householdAMember)).resolves.toEqual([]);
    await expect(getConsumable(db, householdAMember, eggsId)).resolves.toMatchObject({
      isPinned: false,
    });
  });

  it("登録件数を5件に制限せず、最近登録した順で全件を返す", async () => {
    const ids: string[] = [];
    for (let index = 1; index <= 6; index += 1) {
      const id = await createConsumableFor(householdAMember, `消耗品${String(index)}`);
      ids.push(id);
      await setConsumablePinned(db, householdAMember, id, true);
    }

    const pins = await listPinnedConsumables(db, householdAMember);
    expect(pins).toHaveLength(6);
    expect(pins.map((pin) => pin.id)).toEqual(ids.toReversed());
  });

  it("他家庭のConsumableはピン留め登録・表示できない", async () => {
    const otherHouseholdId = await createConsumableFor(householdBMember, "別家庭の卵");

    await expect(
      setConsumablePinned(db, householdAMember, otherHouseholdId, true),
    ).rejects.toThrow("消耗品が見つかりません。");
    await expect(listPinnedConsumables(db, householdAMember)).resolves.toEqual([]);
    await expect(listPinnedConsumables(db, householdBMember)).resolves.toEqual([]);
  });

  it("未認証・家庭未所属の利用者はピン留めを読み書きできない", async () => {
    const id = await createConsumableFor(householdAMember, "卵");

    await expect(listPinnedConsumables(db, null)).rejects.toThrow("認証が必要です。");
    await expect(
      setConsumablePinned(db, nonMember, id, true),
    ).rejects.toThrow("家庭への所属が必要です。");
  });
});
