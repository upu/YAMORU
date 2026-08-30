import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

import { applyMigrations, applyMigrationsThrough } from "./test-support/migrations";

const db = env.DB;

it("備品を含む3分類だけを有効にし、otherの既存行と互換値を保持する(Issue #299)", async () => {
  await applyMigrationsThrough(db, "0013_consumable_stock_status");
  await db.batch([
    db.prepare("INSERT INTO users (id, email) VALUES ('user-a', 'a@example.com')"),
    db.prepare("INSERT INTO households (id, name) VALUES ('household-a', 'Household A')"),
    db.prepare("INSERT INTO household_members (household_id, user_id) VALUES ('household-a', 'user-a')"),
    db.prepare("INSERT INTO managed_items (id, household_id, name, kind) VALUES ('asset-a', 'household-a', '猫の給水機', 'other')"),
    db.prepare("INSERT INTO managed_item_classifications (managed_item_id, household_id, kind_code, custom_item_type) VALUES ('asset-a', 'household-a', 'asset', '猫用品')"),
    db.prepare("INSERT INTO managed_items (id, household_id, name, kind) VALUES ('legacy-other', 'household-a', '旧分類', 'other')"),
    db.prepare("INSERT INTO managed_item_classifications (managed_item_id, household_id, kind_code, item_type_code) VALUES ('legacy-other', 'household-a', 'other', 'other')"),
  ]);

  await applyMigrations(db, ["0014_retire_other_managed_item_kind"]);

  await expect(db.prepare(
    "SELECT code, label FROM managed_item_kinds WHERE is_active = 1 ORDER BY sort_order",
  ).all()).resolves.toMatchObject({
    results: [
      { code: "asset", label: "備品" },
      { code: "service", label: "サービス" },
      { code: "obligation", label: "支払い・手続き" },
    ],
  });
  await expect(db.prepare(
    "SELECT is_active FROM managed_item_kinds WHERE code = 'other'",
  ).first()).resolves.toMatchObject({ is_active: 0 });
  await expect(db.prepare(
    "SELECT is_active FROM managed_item_type_presets WHERE code = 'other' AND kind_code = 'other'",
  ).first()).resolves.toMatchObject({ is_active: 0 });

  // 互換列kind='other'や過去の分類行を推測で書き換えず、参照データを保持する。
  await expect(db.prepare(
    "SELECT id, kind FROM managed_items ORDER BY id",
  ).all()).resolves.toMatchObject({
    results: [
      { id: "asset-a", kind: "other" },
      { id: "legacy-other", kind: "other" },
    ],
  });
  await expect(db.prepare(
    "SELECT managed_item_id, kind_code FROM managed_item_classifications ORDER BY managed_item_id",
  ).all()).resolves.toMatchObject({
    results: [
      { kind_code: "asset", managed_item_id: "asset-a" },
      { kind_code: "other", managed_item_id: "legacy-other" },
    ],
  });
});
