import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyAllMigrations } from "./test-support/migrations";
import { D1NotFoundError } from "./errors";
import {
  createManagedItem,
  getManagedItemForEdit,
  loadManagedItemDetail,
  updateManagedItem,
} from "./managed-items";

const db = env.DB;
const householdAMember = { email: "a@example.com", userId: "user-a" };
const householdBMember = { email: "b@example.com", userId: "user-b" };

// 実在する家庭の記録を持ち込まないよう、fixtureは説明用の値だけを使う。
const PRODUCT_INFO = "サンプル電機 サンプルモデル SAMPLE-0000";
const NOTE = "リビングの窓側に設置。\n説明書は棚の中。";

beforeAll(async () => {
  await applyAllMigrations(db);
});

beforeEach(async () => {
  await db.batch([
    db.prepare("DELETE FROM external_links"),
    db.prepare("DELETE FROM managed_items"),
    db.prepare("DELETE FROM household_members"),
    db.prepare("DELETE FROM households"),
    db.prepare("DELETE FROM users"),
    db.prepare("INSERT INTO users (id, email) VALUES ('user-a', 'a@example.com')"),
    db.prepare("INSERT INTO users (id, email) VALUES ('user-b', 'b@example.com')"),
    db.prepare("INSERT INTO households (id, name) VALUES ('household-a', 'Household A')"),
    db.prepare("INSERT INTO households (id, name) VALUES ('household-b', 'Household B')"),
    db.prepare("INSERT INTO household_members (household_id, user_id) VALUES ('household-a', 'user-a')"),
    db.prepare("INSERT INTO household_members (household_id, user_id) VALUES ('household-b', 'user-b')"),
  ]);
});

const BASE_INPUT = {
  customItemType: null,
  externalUrl: null,
  itemTypeCode: "appliance",
  kindCode: "asset",
  name: "リビングのエアコン",
  note: null,
  productInfo: null,
  startedOn: null,
};

describe("ManagedItemの任意の記録(Issue #42, #239)", () => {
  it("メモ・商品情報・開始時期を入力どおり保存し、詳細と編集で読み戻す", async () => {
    const itemId = await createManagedItem(db, householdAMember, {
      ...BASE_INPUT,
      note: NOTE,
      productInfo: PRODUCT_INFO,
      startedOn: "2024-05",
    });

    await expect(getManagedItemForEdit(db, householdAMember, itemId))
      .resolves.toMatchObject({
        note: NOTE,
        productInfo: PRODUCT_INFO,
        startedOn: "2024-05",
      });
    await expect(loadManagedItemDetail(db, householdAMember, itemId))
      .resolves.toMatchObject({
        note: NOTE,
        productInfo: PRODUCT_INFO,
        startedOn: "2024-05",
      });

    // 大文字小文字・記号・語中の空白を保存側で変えない。
    const stored = await db.prepare(
      "SELECT product_info FROM managed_items WHERE id = ?1",
    ).bind(itemId).first<{ product_info: string }>();
    expect(stored?.product_info).toBe(PRODUCT_INFO);
  });

  it("すべて未設定でも登録でき、後から追加・未設定化できる", async () => {
    const itemId = await createManagedItem(db, householdAMember, BASE_INPUT);
    await expect(getManagedItemForEdit(db, householdAMember, itemId))
      .resolves.toMatchObject({ note: null, productInfo: null, startedOn: null });

    await updateManagedItem(db, householdAMember, itemId, {
      ...BASE_INPUT,
      note: NOTE,
      productInfo: PRODUCT_INFO,
      startedOn: "2024",
    });
    await expect(getManagedItemForEdit(db, householdAMember, itemId))
      .resolves.toMatchObject({
        note: NOTE,
        productInfo: PRODUCT_INFO,
        startedOn: "2024",
      });

    await updateManagedItem(db, householdAMember, itemId, BASE_INPUT);
    await expect(getManagedItemForEdit(db, householdAMember, itemId))
      .resolves.toMatchObject({ note: null, productInfo: null, startedOn: null });
  });

  it("0008・0011適用前に作られた行は、記録が未設定のまま表示・編集できる", async () => {
    // migration適用前の行に相当する、追加列を書き込まないINSERT。
    await db.prepare(
      "INSERT INTO managed_items (id, household_id, name, kind) VALUES ('legacy-item', 'household-a', '既存の管理対象', 'appliance')",
    ).run();

    await expect(getManagedItemForEdit(db, householdAMember, "legacy-item"))
      .resolves.toMatchObject({
        name: "既存の管理対象",
        note: null,
        productInfo: null,
        startedOn: null,
      });

    await updateManagedItem(db, householdAMember, "legacy-item", {
      ...BASE_INPUT,
      name: "既存の管理対象",
      productInfo: PRODUCT_INFO,
    });
    await expect(getManagedItemForEdit(db, householdAMember, "legacy-item"))
      .resolves.toMatchObject({ productInfo: PRODUCT_INFO });
  });

  it("家庭Bの利用者は家庭Aの記録を参照も変更もできない", async () => {
    const itemId = await createManagedItem(db, householdAMember, {
      ...BASE_INPUT,
      note: NOTE,
      productInfo: PRODUCT_INFO,
      startedOn: "2024-05-10",
    });

    await expect(getManagedItemForEdit(db, householdBMember, itemId)).resolves.toBeNull();
    await expect(loadManagedItemDetail(db, householdBMember, itemId)).resolves.toBeNull();
    await expect(updateManagedItem(db, householdBMember, itemId, {
      ...BASE_INPUT,
      productInfo: "別家庭からの上書き",
    })).rejects.toThrow(D1NotFoundError);

    // 家庭Aの記録は書き換わっていない。
    await expect(getManagedItemForEdit(db, householdAMember, itemId))
      .resolves.toMatchObject({ note: NOTE, productInfo: PRODUCT_INFO });
  });

  it("分類が不正な更新では記録も書き換わらない", async () => {
    const itemId = await createManagedItem(db, householdAMember, {
      ...BASE_INPUT,
      productInfo: PRODUCT_INFO,
    });

    await expect(updateManagedItem(db, householdAMember, itemId, {
      ...BASE_INPUT,
      itemTypeCode: "missing",
      productInfo: "保存されてはいけない値",
    })).rejects.toThrow("管理対象の分類を選択し直してください。");

    await expect(getManagedItemForEdit(db, householdAMember, itemId))
      .resolves.toMatchObject({ productInfo: PRODUCT_INFO });
  });

  it("列の制約が長すぎる値と壊れた開始時期を拒否する", async () => {
    const itemId = await createManagedItem(db, householdAMember, BASE_INPUT);

    for (const [column, value] of [
      ["note", "あ".repeat(1001)],
      ["product_info", "あ".repeat(201)],
      ["started_on", "2024-5"],
      ["started_on", "2024/05/10"],
      ["started_on", "24-05"],
    ]) {
      await expect(db.prepare(
        `UPDATE managed_items SET ${String(column)} = ?1 WHERE id = ?2`,
      ).bind(value, itemId).run()).rejects.toThrow();
    }
  });
});
