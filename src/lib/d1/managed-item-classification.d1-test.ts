import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import schemaSql from "../../../d1/migrations/0001_init.sql?raw";
import authSchemaSql from "../../../d1/migrations/0002_auth_invitation_claims.sql?raw";
import migrationAuditSql from "../../../d1/migrations/0003_preserve_supabase_audit_fields.sql?raw";
import completionCorrectionsSql from "../../../d1/migrations/0004_completion_corrections.sql?raw";
import classificationSql from "../../../d1/migrations/0005_managed_item_classification.sql?raw";
import propertyTaxSql from "../../../d1/migrations/0006_property_tax_item_type.sql?raw";
import kindLabelsSql from "../../../d1/migrations/0007_managed_item_kind_labels.sql?raw";
import optionalAttributesSql from "../../../d1/migrations/0008_managed_item_optional_attributes.sql?raw";
import {
  createManagedItem,
  getManagedItemForEdit,
  listManagedItemClassificationOptions,
  updateManagedItem,
} from "./managed-items";

const db = env.DB;
const householdMember = { email: "a@example.com", userId: "user-a" };

function migrationStatements(): string[] {
  return [
    schemaSql,
    authSchemaSql,
    migrationAuditSql,
    completionCorrectionsSql,
    classificationSql,
    propertyTaxSql,
    kindLabelsSql,
    optionalAttributesSql,
  ].join("\n")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

beforeAll(async () => {
  await db.batch(migrationStatements().map((statement) => db.prepare(statement)));
});

beforeEach(async () => {
  await db.batch([
    db.prepare("DELETE FROM managed_items"),
    db.prepare("DELETE FROM household_members"),
    db.prepare("DELETE FROM households"),
    db.prepare("DELETE FROM users"),
    db.prepare("UPDATE managed_item_kinds SET is_active = 1"),
    db.prepare("UPDATE managed_item_type_presets SET is_active = 1"),
    db.prepare("INSERT INTO users (id, email) VALUES ('user-a', 'a@example.com')"),
    db.prepare("INSERT INTO households (id, name) VALUES ('household-a', 'Household A')"),
    db.prepare("INSERT INTO household_members (household_id, user_id) VALUES ('household-a', 'user-a')"),
    db.prepare("INSERT INTO managed_items (id, household_id, name, kind) VALUES ('item-a', 'household-a', 'Item A', 'other')"),
  ]);
});

describe("ManagedItemの分類データアクセス(Issue #41)", () => {
  it("大分類を家庭向けのラベルで並び順どおりに取得する(Issue #193)", async () => {
    await expect(listManagedItemClassificationOptions(db)).resolves.toMatchObject({
      kinds: [
        { code: "asset", label: "モノ" },
        { code: "service", label: "サービス" },
        { code: "obligation", label: "支払い・手続き" },
        { code: "other", label: "その他" },
      ],
    });
  });

  it("有効な大分類と詳しい種類だけを表示し、自由入力も保存する", async () => {
    await db.prepare("UPDATE managed_item_type_presets SET is_active = 0 WHERE code = 'contract'").run();
    await db.prepare("UPDATE managed_item_kinds SET is_active = 0 WHERE code = 'service'").run();
    await expect(listManagedItemClassificationOptions(db)).resolves.toEqual({
      itemTypes: expect.not.arrayContaining([
        expect.objectContaining({ code: "contract" }),
        expect.objectContaining({ code: "lesson" }),
      ]),
      kinds: expect.arrayContaining([
        { code: "asset", label: "モノ" },
        { code: "obligation", label: "支払い・手続き" },
      ]),
    });

    const itemId = await createManagedItem(db, householdMember, {
      customItemType: "猫用給水機",
      externalUrl: null,
      itemTypeCode: null,
      kindCode: "asset",
      name: "猫の給水機",
      note: null,
      productInfo: null,
      purchasedOn: null,
    });
    await expect(getManagedItemForEdit(db, householdMember, itemId)).resolves.toMatchObject({
      itemTypeCode: null,
      itemTypeLabel: "猫用給水機",
      kindCode: "asset",
      kindLabel: "モノ",
    });
  });

  it("旧版からkindが変更された場合は旧値を優先し、同じkindの編集では新分類を保つ", async () => {
    await db.prepare("UPDATE managed_items SET kind = 'contract' WHERE id = 'item-a'").run();
    await expect(getManagedItemForEdit(db, householdMember, "item-a")).resolves.toMatchObject({
      customItemType: null,
      itemTypeCode: "contract",
      itemTypeLabel: "契約",
      kindCode: "service",
      kindLabel: "サービス",
    });

    await updateManagedItem(db, householdMember, "item-a", {
      customItemType: "猫用給水機",
      externalUrl: null,
      itemTypeCode: null,
      kindCode: "asset",
      name: "Item A classified",
      note: null,
      productInfo: null,
      purchasedOn: null,
    });
    await db.prepare("UPDATE managed_items SET name = 'Old worker rename' WHERE id = 'item-a'").run();
    await expect(getManagedItemForEdit(db, householdMember, "item-a")).resolves.toMatchObject({
      customItemType: "猫用給水機",
      itemTypeCode: null,
      itemTypeLabel: "猫用給水機",
      kindCode: "asset",
      name: "Old worker rename",
      note: null,
      productInfo: null,
      purchasedOn: null,
    });
  });

  it("未定義・無効・大分類不一致の分類を保存しない", async () => {
    await db.prepare("UPDATE managed_item_kinds SET is_active = 0 WHERE code = 'service'").run();
    for (const input of [
      { customItemType: null, itemTypeCode: "contract", kindCode: "service" },
      { customItemType: null, itemTypeCode: "contract", kindCode: "asset" },
      { customItemType: null, itemTypeCode: "missing", kindCode: "asset" },
    ]) {
      await expect(createManagedItem(db, householdMember, {
        ...input,
        externalUrl: null,
        name: "Invalid classification",
        note: null,
        productInfo: null,
        purchasedOn: null,
      })).rejects.toThrow("管理対象の分類を選択し直してください。");
    }
    await expect(db.prepare(
      "SELECT count(*) AS count FROM managed_items WHERE name = 'Invalid classification'",
    ).first<{ count: number }>()).resolves.toMatchObject({ count: 0 });
  });
});
