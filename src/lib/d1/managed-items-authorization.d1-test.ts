import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createManagedItem,
  getManagedItemForEdit,
  listHouseholdCustomItemTypes,
  listManagedItems,
  updateManagedItem,
} from "./managed-items";
import {
  householdAMember,
  householdBMember,
  resetHouseholdFixtures,
} from "./test-support/households";
import { applyAllMigrations } from "./test-support/migrations";

// 管理対象の書き込みと家庭間分離、および台帳一覧の検索・絞り込みの認可。

const db = env.DB;

beforeAll(async () => {
  await applyAllMigrations(db);
});

beforeEach(async () => {
  await resetHouseholdFixtures(db);
});

describe("D1 ManagedItem writes and household isolation", () => {
  it("new managed items are bound to the session household", async () => {
    await createManagedItem(db, householdAMember, {
      customItemType: null,
      externalUrl: "https://example.com/a",
      itemTypeCode: "contract",
      kindCode: "service",
      name: "A contract",
      note: null,
      productInfo: null,
      startedOn: null,
    });
    const aItems = await listManagedItems(db, householdAMember);
    const bItems = await listManagedItems(db, householdBMember);
    expect(aItems.map(({ name }) => name)).toContain("A contract");
    expect(bItems.map(({ name }) => name)).not.toContain("A contract");
  });

  it("a failed external-link insert rolls back the managed item insert", async () => {
    await expect(createManagedItem(db, householdAMember, {
      customItemType: null,
      externalUrl: "not-a-url",
      itemTypeCode: "contract",
      kindCode: "service",
      name: "Must roll back",
      note: null,
      productInfo: null,
      startedOn: null,
    })).rejects.toThrow();
    await expect(db.prepare(
      "SELECT count(*) AS count FROM managed_items WHERE name = 'Must roll back'",
    ).first<{ count: number }>()).resolves.toMatchObject({ count: 0 });
  });

  it("updateManagedItem replaces the external link atomically without touching household B(Issue #40)", async () => {
    await updateManagedItem(db, householdAMember, "item-a", {
      customItemType: null,
      externalUrl: "https://example.com/updated",
      itemTypeCode: "appliance",
      kindCode: "asset",
      name: "Item A updated",
      note: null,
      productInfo: null,
      startedOn: null,
    });

    await expect(getManagedItemForEdit(db, householdAMember, "item-a")).resolves.toEqual({
      customItemType: null,
      externalUrl: "https://example.com/updated",
      id: "item-a",
      itemTypeCode: "appliance",
      itemTypeLabel: "家電",
      kindCode: "asset",
      kindLabel: "モノ",
      name: "Item A updated",
      note: null,
      productInfo: null,
      startedOn: null,
    });
    await expect(db.prepare(
      "SELECT count(*) AS count FROM external_links WHERE managed_item_id = 'item-a'",
    ).first<{ count: number }>()).resolves.toMatchObject({ count: 1 });
    await expect(getManagedItemForEdit(db, householdBMember, "item-b")).resolves.toEqual({
      customItemType: null,
      externalUrl: null,
      id: "item-b",
      itemTypeCode: "other",
      itemTypeLabel: "その他",
      kindCode: "other",
      kindLabel: "その他",
      name: "Item B",
      note: null,
      productInfo: null,
      startedOn: null,
    });
  });

  it("updateManagedItem can unset the external link", async () => {
    await updateManagedItem(db, householdAMember, "item-a", {
      customItemType: null,
      externalUrl: "https://example.com/first",
      itemTypeCode: "other",
      kindCode: "other",
      name: "Item A",
      note: null,
      productInfo: null,
      startedOn: null,
    });
    await updateManagedItem(db, householdAMember, "item-a", {
      customItemType: null,
      externalUrl: null,
      itemTypeCode: "other",
      kindCode: "other",
      name: "Item A",
      note: null,
      productInfo: null,
      startedOn: null,
    });

    await expect(db.prepare(
      "SELECT count(*) AS count FROM external_links WHERE managed_item_id = 'item-a'",
    ).first<{ count: number }>()).resolves.toMatchObject({ count: 0 });
  });

  it("an A session cannot update or read a B item by ID (IDOR)", async () => {
    await expect(updateManagedItem(db, householdAMember, "item-b", {
      customItemType: null,
      externalUrl: null,
      itemTypeCode: "other",
      kindCode: "other",
      name: "Hacked",
      note: null,
      productInfo: null,
      startedOn: null,
    })).rejects.toThrow("管理対象が見つかりません。");
    await expect(getManagedItemForEdit(db, householdAMember, "item-b")).resolves.toBeNull();
    await expect(db.prepare(
      "SELECT name FROM managed_items WHERE id = 'item-b'",
    ).first()).resolves.toMatchObject({ name: "Item B" });
  });

  it("a failed external-link insert rolls back the managed item name/kind update too", async () => {
    await updateManagedItem(db, householdAMember, "item-a", {
      customItemType: null,
      externalUrl: "https://example.com/original",
      itemTypeCode: "other",
      kindCode: "other",
      name: "Item A",
      note: null,
      productInfo: null,
      startedOn: null,
    });

    await expect(updateManagedItem(db, householdAMember, "item-a", {
      customItemType: null,
      externalUrl: "not-a-url",
      itemTypeCode: "appliance",
      kindCode: "asset",
      name: "Should not persist",
      note: null,
      productInfo: null,
      startedOn: null,
    })).rejects.toThrow();

    await expect(getManagedItemForEdit(db, householdAMember, "item-a")).resolves.toEqual({
      customItemType: null,
      externalUrl: "https://example.com/original",
      id: "item-a",
      itemTypeCode: "other",
      itemTypeLabel: "その他",
      kindCode: "other",
      kindLabel: "その他",
      name: "Item A",
      note: null,
      productInfo: null,
      startedOn: null,
    });
  });

});

describe("D1 台帳一覧の検索・絞り込み認可 (Issue #218)", () => {
  it("管理対象名の部分一致(日本語)で絞り込む", async () => {
    await createManagedItem(db, householdAMember, {
      customItemType: null,
      externalUrl: null,
      itemTypeCode: "other",
      kindCode: "other",
      name: "浄水フィルター",
      note: null,
      productInfo: null,
      startedOn: null,
    });

    const filtered = await listManagedItems(db, householdAMember, { search: "浄水" });
    expect(filtered.map(({ name }) => name)).toEqual(["浄水フィルター"]);
  });

  it("英字の大文字・小文字を区別せず一致させる", async () => {
    await createManagedItem(db, householdAMember, {
      customItemType: null,
      externalUrl: null,
      itemTypeCode: "other",
      kindCode: "other",
      name: "AEDトレーナー",
      note: null,
      productInfo: null,
      startedOn: null,
    });

    const lowerFiltered = await listManagedItems(db, householdAMember, { search: "aed" });
    expect(lowerFiltered.map(({ name }) => name)).toEqual(["AEDトレーナー"]);
  });

  it("前後の空白を無視し、空文字・空白のみは絞り込みなしとして扱う", async () => {
    const paddedResult = await listManagedItems(db, householdAMember, { search: "  Item  " });
    expect(paddedResult.map(({ name }) => name)).toEqual(["Item A"]);

    const blankResult = await listManagedItems(db, householdAMember, { search: "   " });
    expect(blankResult.map(({ name }) => name)).toEqual(["Item A"]);

    const emptyResult = await listManagedItems(db, householdAMember, { search: "" });
    expect(emptyResult.map(({ name }) => name)).toEqual(["Item A"]);
  });

  it("検索語に含まれるLIKEのワイルドカード(%, _)を文字通りの部分文字列として扱う", async () => {
    await createManagedItem(db, householdAMember, {
      customItemType: null,
      externalUrl: null,
      itemTypeCode: "other",
      kindCode: "other",
      name: "10%OFFクーポン家電",
      note: null,
      productInfo: null,
      startedOn: null,
    });
    await createManagedItem(db, householdAMember, {
      customItemType: null,
      externalUrl: null,
      itemTypeCode: "other",
      kindCode: "other",
      name: "10円玉OFFクーポン家電",
      note: null,
      productInfo: null,
      startedOn: null,
    });

    const filtered = await listManagedItems(db, householdAMember, { search: "10%OFF" });
    expect(filtered.map(({ name }) => name)).toEqual(["10%OFFクーポン家電"]);
  });

  it("大分類(kindCode)で絞り込む", async () => {
    await createManagedItem(db, householdAMember, {
      customItemType: null,
      externalUrl: null,
      itemTypeCode: "appliance",
      kindCode: "asset",
      name: "冷蔵庫",
      note: null,
      productInfo: null,
      startedOn: null,
    });

    const filtered = await listManagedItems(db, householdAMember, { kindCode: "asset" });
    expect(filtered.map(({ name }) => name)).toEqual(["冷蔵庫"]);
    // item-a(その他/その他)は大分類がasset以外なので一致しない。
    expect(filtered.map(({ name }) => name)).not.toContain("Item A");
  });

  it("詳しい種類(itemTypeCode)で絞り込み、カスタム入力(未設定)の詳しい種類は一致しない", async () => {
    await createManagedItem(db, householdAMember, {
      customItemType: null,
      externalUrl: null,
      itemTypeCode: "appliance",
      kindCode: "asset",
      name: "冷蔵庫",
      note: null,
      productInfo: null,
      startedOn: null,
    });
    await createManagedItem(db, householdAMember, {
      customItemType: "特注の棚",
      externalUrl: null,
      itemTypeCode: null,
      kindCode: "asset",
      name: "オーダー家具",
      note: null,
      productInfo: null,
      startedOn: null,
    });

    const filtered = await listManagedItems(db, householdAMember, { itemTypeCode: "appliance" });
    expect(filtered.map(({ name }) => name)).toEqual(["冷蔵庫"]);
  });

  it("検索語・大分類・詳しい種類を組み合わせて絞り込む", async () => {
    await createManagedItem(db, householdAMember, {
      customItemType: null,
      externalUrl: null,
      itemTypeCode: "appliance",
      kindCode: "asset",
      name: "リビングの冷蔵庫",
      note: null,
      productInfo: null,
      startedOn: null,
    });
    await createManagedItem(db, householdAMember, {
      customItemType: null,
      externalUrl: null,
      itemTypeCode: "appliance",
      kindCode: "asset",
      name: "キッチンの冷蔵庫",
      note: null,
      productInfo: null,
      startedOn: null,
    });

    const combined = await listManagedItems(db, householdAMember, {
      itemTypeCode: "appliance",
      kindCode: "asset",
      search: "リビング",
    });
    expect(combined.map(({ name }) => name)).toEqual(["リビングの冷蔵庫"]);
  });

  it("別家庭の管理対象は検索結果へ混ざらない", async () => {
    await createManagedItem(db, householdBMember, {
      customItemType: null,
      externalUrl: null,
      itemTypeCode: "other",
      kindCode: "other",
      name: "共通のキーワード用B",
      note: null,
      productInfo: null,
      startedOn: null,
    });
    await createManagedItem(db, householdAMember, {
      customItemType: null,
      externalUrl: null,
      itemTypeCode: "other",
      kindCode: "other",
      name: "共通のキーワード用A",
      note: null,
      productInfo: null,
      startedOn: null,
    });

    const filtered = await listManagedItems(db, householdAMember, { search: "共通のキーワード" });
    expect(filtered.map(({ name }) => name)).toEqual(["共通のキーワード用A"]);
  });
});

describe("D1 台帳一覧の自由入力(詳しい種類)候補・絞り込み認可 (Issue #238)", () => {
  it("自由入力(customItemType)で絞り込み、プリセットの詳しい種類とは独立して一致する", async () => {
    await createManagedItem(db, householdAMember, {
      customItemType: null,
      externalUrl: null,
      itemTypeCode: "appliance",
      kindCode: "asset",
      name: "冷蔵庫",
      note: null,
      productInfo: null,
      startedOn: null,
    });
    await createManagedItem(db, householdAMember, {
      customItemType: "特注の棚",
      externalUrl: null,
      itemTypeCode: null,
      kindCode: "asset",
      name: "オーダー家具",
      note: null,
      productInfo: null,
      startedOn: null,
    });

    const filtered = await listManagedItems(db, householdAMember, { customItemType: "特注の棚" });
    expect(filtered.map(({ name }) => name)).toEqual(["オーダー家具"]);
  });

  it("自由入力の表記の大文字小文字・前後の空白を無視して一致させる", async () => {
    await createManagedItem(db, householdAMember, {
      customItemType: "IoTセンサー",
      externalUrl: null,
      itemTypeCode: null,
      kindCode: "asset",
      name: "センサーA",
      note: null,
      productInfo: null,
      startedOn: null,
    });
    await createManagedItem(db, householdAMember, {
      customItemType: "iotセンサー",
      externalUrl: null,
      itemTypeCode: null,
      kindCode: "asset",
      name: "センサーB",
      note: null,
      productInfo: null,
      startedOn: null,
    });

    const filtered = await listManagedItems(db, householdAMember, { customItemType: "  IOTセンサー  " });
    expect(filtered.map(({ name }) => name).sort()).toEqual(["センサーA", "センサーB"]);
  });

  it("別家庭の自由入力値は絞り込み結果に混ざらない", async () => {
    await createManagedItem(db, householdBMember, {
      customItemType: "共通ワード",
      externalUrl: null,
      itemTypeCode: null,
      kindCode: "asset",
      name: "B専用棚",
      note: null,
      productInfo: null,
      startedOn: null,
    });
    await createManagedItem(db, householdAMember, {
      customItemType: "共通ワード",
      externalUrl: null,
      itemTypeCode: null,
      kindCode: "asset",
      name: "A専用棚",
      note: null,
      productInfo: null,
      startedOn: null,
    });

    const filtered = await listManagedItems(db, householdAMember, { customItemType: "共通ワード" });
    expect(filtered.map(({ name }) => name)).toEqual(["A専用棚"]);
  });

  it("家庭内で使われている自由入力の詳しい種類を大分類ごとに重複なく候補として返す", async () => {
    await createManagedItem(db, householdAMember, {
      customItemType: "IoTセンサー",
      externalUrl: null,
      itemTypeCode: null,
      kindCode: "asset",
      name: "センサーA",
      note: null,
      productInfo: null,
      startedOn: null,
    });
    // 大文字小文字だけが違う表記は1件へまとめる。SQLiteのMIN()はASCIIコード順で
    // 比較するため、"IoTセンサー"("I"=0x49)が"iotセンサー"("i"=0x69)より小さく、
    // 代表表記として選ばれる。
    await createManagedItem(db, householdAMember, {
      customItemType: "iotセンサー",
      externalUrl: null,
      itemTypeCode: null,
      kindCode: "asset",
      name: "センサーB",
      note: null,
      productInfo: null,
      startedOn: null,
    });

    await expect(listHouseholdCustomItemTypes(db, householdAMember)).resolves.toEqual([
      { kindCode: "asset", label: "IoTセンサー" },
    ]);
  });

  it("プリセットの詳しい種類だけの家庭では自由入力候補を返さない", async () => {
    await createManagedItem(db, householdAMember, {
      customItemType: null,
      externalUrl: null,
      itemTypeCode: "appliance",
      kindCode: "asset",
      name: "冷蔵庫",
      note: null,
      productInfo: null,
      startedOn: null,
    });

    await expect(listHouseholdCustomItemTypes(db, householdAMember)).resolves.toEqual([]);
  });

  it("他家庭の自由入力値は候補に混ざらない", async () => {
    await createManagedItem(db, householdBMember, {
      customItemType: "B専用種別",
      externalUrl: null,
      itemTypeCode: null,
      kindCode: "other",
      name: "B専用の対象",
      note: null,
      productInfo: null,
      startedOn: null,
    });
    await createManagedItem(db, householdAMember, {
      customItemType: "A専用種別",
      externalUrl: null,
      itemTypeCode: null,
      kindCode: "other",
      name: "A専用の対象",
      note: null,
      productInfo: null,
      startedOn: null,
    });

    await expect(listHouseholdCustomItemTypes(db, householdAMember)).resolves.toEqual([
      { kindCode: "other", label: "A専用種別" },
    ]);
  });
});
