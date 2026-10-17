// Issue #226 / YDR-048: ManagedItemのタグの作成・付与・解除・表示と家庭間分離。
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createManagedItem, getManagedItem, updateManagedItem } from "./managed-items";
import {
  listHouseholdTags,
  listManagedItemTagsByItem,
  listTagsForManagedItem,
  type ManagedItemTagInput,
} from "./tags";
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

function writeInput(name: string, tags?: ManagedItemTagInput) {
  return {
    customItemType: null,
    externalUrl: null,
    itemTypeCode: "lesson",
    kindCode: "service",
    name,
    note: null,
    productInfo: null,
    startedOn: null,
    ...(tags === undefined ? {} : { tags }),
  };
}

function tagNames(tags: { name: string }[]): string[] {
  return tags.map(({ name }) => name);
}

async function tagIdByName(name: string): Promise<string> {
  const tag = (await listHouseholdTags(db, householdAMember)).find((candidate) => candidate.name === name);
  if (tag === undefined) throw new Error(`タグが見つかりません: ${name}`);
  return tag.id;
}

describe("D1 ManagedItem tags", () => {
  it("登録時に新しいタグを作って付け、分類とは別に保存する", async () => {
    const itemId = await createManagedItem(db, householdAMember, writeInput("○○デイ", {
      newTagNames: ["子どもA", "送迎あり"],
      tagIds: [],
    }));

    await expect(listTagsForManagedItem(db, householdAMember, itemId).then(tagNames))
      .resolves.toEqual(["子どもA", "送迎あり"]);
    await expect(listHouseholdTags(db, householdAMember).then(tagNames))
      .resolves.toEqual(["子どもA", "送迎あり"]);
    // 大分類・詳しい種類はタグの影響を受けない。
    await expect(getManagedItem(db, householdAMember, itemId)).resolves.toMatchObject({
      itemTypeCode: "lesson",
      kindCode: "service",
    });
  });

  it("一つのタグを複数のManagedItemで共有し、同名(大文字小文字違い)は既存タグを使う", async () => {
    const first = await createManagedItem(db, householdAMember, writeInput("○○デイ", {
      newTagNames: ["Kids"],
      tagIds: [],
    }));
    const kidsId = await tagIdByName("Kids");
    const second = await createManagedItem(db, householdAMember, writeInput("△△デイ", {
      newTagNames: [],
      tagIds: [kidsId],
    }));
    const third = await createManagedItem(db, householdAMember, writeInput("下肢装具", {
      newTagNames: ["kids"],
      tagIds: [kidsId],
    }));

    await expect(listHouseholdTags(db, householdAMember)).resolves.toEqual([{ id: kidsId, name: "Kids" }]);
    const byItem = await listManagedItemTagsByItem(db, householdAMember);
    expect(byItem.get(first)).toEqual([{ id: kidsId, name: "Kids" }]);
    expect(byItem.get(second)).toEqual([{ id: kidsId, name: "Kids" }]);
    expect(byItem.get(third)).toEqual([{ id: kidsId, name: "Kids" }]);
    expect(byItem.has("item-a")).toBe(false);
  });

  it("編集で付け替え、tagsを省略した更新は付与済みタグを保ち、空にすると全て外す", async () => {
    const itemId = await createManagedItem(db, householdAMember, writeInput("○○デイ", {
      newTagNames: ["子どもA", "住まい"],
      tagIds: [],
    }));
    const childId = await tagIdByName("子どもA");

    await updateManagedItem(db, householdAMember, itemId, writeInput("○○デイ", {
      newTagNames: ["ペット"],
      tagIds: [childId],
    }));
    await expect(listTagsForManagedItem(db, householdAMember, itemId).then(tagNames))
      .resolves.toEqual(["ペット", "子どもA"]);

    await updateManagedItem(db, householdAMember, itemId, writeInput("○○デイ(改名)"));
    await expect(listTagsForManagedItem(db, householdAMember, itemId).then(tagNames))
      .resolves.toEqual(["ペット", "子どもA"]);

    await updateManagedItem(db, householdAMember, itemId, writeInput("○○デイ(改名)", {
      newTagNames: [],
      tagIds: [],
    }));
    await expect(listTagsForManagedItem(db, householdAMember, itemId)).resolves.toEqual([]);
    // 外したタグそのものは家庭内に残り、次の登録で選べる。
    await expect(listHouseholdTags(db, householdAMember).then(tagNames))
      .resolves.toEqual(["ペット", "住まい", "子どもA"]);
  });

  it("上限10個は、新しいタグの名前を既存タグ(選択済みを含む)と突き合わせた後の数で判定する", async () => {
    const tagNamesToCreate = Array.from({ length: 10 }, (_, index) => `タグ${String(index)}`);
    const itemId = await createManagedItem(db, householdAMember, writeInput("上限ちょうど", {
      newTagNames: tagNamesToCreate,
      tagIds: [],
    }));
    const tagIds = (await listHouseholdTags(db, householdAMember)).map(({ id }) => id);
    expect(tagIds).toHaveLength(10);

    // 選択済みの10個と同じ名前(大文字小文字違いを含む)を書いても、付くのは10個のまま。
    await updateManagedItem(db, householdAMember, itemId, writeInput("上限ちょうど", {
      newTagNames: ["タグ0", "タグ9"],
      tagIds,
    }));
    await expect(listTagsForManagedItem(db, householdAMember, itemId)).resolves.toHaveLength(10);

    // 11個目の新しいタグは、名前・タグとも何も書かずに断る。
    await expect(updateManagedItem(db, householdAMember, itemId, writeInput("改名されない", {
      newTagNames: ["11個目"],
      tagIds,
    }))).rejects.toMatchObject({ code: "MANAGED_ITEM_TAG_LIMIT_EXCEEDED" });
    await expect(getManagedItem(db, householdAMember, itemId)).resolves.toMatchObject({ name: "上限ちょうど" });
    await expect(listHouseholdTags(db, householdAMember)).resolves.toHaveLength(10);
  });

  it("タグを指定しなくても既存どおり登録・編集できる", async () => {
    const itemId = await createManagedItem(db, householdAMember, writeInput("タグなし", {
      newTagNames: [],
      tagIds: [],
    }));
    await updateManagedItem(db, householdAMember, itemId, writeInput("タグなし(改名)", {
      newTagNames: [],
      tagIds: [],
    }));
    await expect(getManagedItem(db, householdAMember, itemId)).resolves.toMatchObject({ name: "タグなし(改名)" });
    await expect(listTagsForManagedItem(db, householdAMember, itemId)).resolves.toEqual([]);
    await expect(listHouseholdTags(db, householdAMember)).resolves.toEqual([]);
  });

  it("家庭Bのセッションから家庭Aのタグを家庭BのManagedItemへ付けられず、更新全体が取り消される", async () => {
    await createManagedItem(db, householdAMember, writeInput("A item", {
      newTagNames: ["子どもA"],
      tagIds: [],
    }));
    const householdATagId = await tagIdByName("子どもA");

    await expect(updateManagedItem(db, householdBMember, "item-b", writeInput("B renamed", {
      newTagNames: ["B tag"],
      tagIds: [householdATagId],
    }))).rejects.toThrow();
    await expect(createManagedItem(db, householdBMember, writeInput("B new", {
      newTagNames: [],
      tagIds: [householdATagId],
    }))).rejects.toThrow();

    await expect(getManagedItem(db, householdBMember, "item-b")).resolves.toMatchObject({ name: "Item B" });
    await expect(listTagsForManagedItem(db, householdBMember, "item-b")).resolves.toEqual([]);
    await expect(listHouseholdTags(db, householdBMember)).resolves.toEqual([]);
    await expect(db.prepare(
      "SELECT count(*) AS count FROM managed_items WHERE name = 'B new'",
    ).first()).resolves.toEqual({ count: 0 });
  });

  it("家庭Aのセッションに家庭BのManagedItemのIDを渡してもタグを書けず、Not Foundになる", async () => {
    await expect(updateManagedItem(db, householdAMember, "item-b", writeInput("hijack", {
      newTagNames: ["乗っ取り"],
      tagIds: [],
    }))).rejects.toThrow("管理対象が見つかりません。");

    await expect(db.prepare("SELECT count(*) AS count FROM tags").first())
      .resolves.toEqual({ count: 0 });
    await expect(db.prepare("SELECT count(*) AS count FROM managed_item_tags").first())
      .resolves.toEqual({ count: 0 });
  });

  it("他家庭のタグと関連は読めない", async () => {
    await createManagedItem(db, householdAMember, writeInput("A item", {
      newTagNames: ["子どもA"],
      tagIds: [],
    }));
    await updateManagedItem(db, householdBMember, "item-b", writeInput("Item B", {
      newTagNames: ["子どもA", "Bだけ"],
      tagIds: [],
    }));

    await expect(listHouseholdTags(db, householdAMember).then(tagNames)).resolves.toEqual(["子どもA"]);
    await expect(listHouseholdTags(db, householdBMember).then(tagNames)).resolves.toEqual(["Bだけ", "子どもA"]);
    await expect(listTagsForManagedItem(db, householdAMember, "item-b")).resolves.toEqual([]);
    const aByItem = await listManagedItemTagsByItem(db, householdAMember);
    expect(aByItem.has("item-b")).toBe(false);
  });

  it("未認証・家庭未所属の利用者はタグを読み書きできない", async () => {
    for (const session of [null, nonMember]) {
      await expect(listHouseholdTags(db, session)).rejects.toThrow();
      await expect(listManagedItemTagsByItem(db, session)).rejects.toThrow();
      await expect(listTagsForManagedItem(db, session, "item-a")).rejects.toThrow();
      await expect(createManagedItem(db, session, writeInput("outsider", {
        newTagNames: ["外部"],
        tagIds: [],
      }))).rejects.toThrow();
    }
    await expect(db.prepare("SELECT count(*) AS count FROM tags").first())
      .resolves.toEqual({ count: 0 });
  });
});
