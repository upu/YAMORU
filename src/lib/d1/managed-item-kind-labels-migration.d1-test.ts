import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

import schemaSql from "../../../d1/migrations/0001_init.sql?raw";
import authSchemaSql from "../../../d1/migrations/0002_auth_invitation_claims.sql?raw";
import migrationAuditSql from "../../../d1/migrations/0003_preserve_supabase_audit_fields.sql?raw";
import completionCorrectionsSql from "../../../d1/migrations/0004_completion_corrections.sql?raw";
import classificationSql from "../../../d1/migrations/0005_managed_item_classification.sql?raw";
import propertyTaxSql from "../../../d1/migrations/0006_property_tax_item_type.sql?raw";
import kindLabelsSql from "../../../d1/migrations/0007_managed_item_kind_labels.sql?raw";

const db = env.DB;

function statements(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function apply(...sql: string[]): Promise<void> {
  await db.batch(statements(sql.join("\n")).map((statement) => db.prepare(statement)));
}

it("大分類の表示ラベルだけを更新し、既存の分類と関連データを保持する(Issue #193)", async () => {
  await apply(
    schemaSql,
    authSchemaSql,
    migrationAuditSql,
    completionCorrectionsSql,
    classificationSql,
    propertyTaxSql,
  );
  await db.batch([
    db.prepare("INSERT INTO users (id, email) VALUES ('user-a', 'a@example.com')"),
    db.prepare("INSERT INTO households (id, name) VALUES ('household-a', 'Household A')"),
    db.prepare("INSERT INTO household_members (household_id, user_id) VALUES ('household-a', 'user-a')"),
    db.prepare("INSERT INTO managed_items (id, household_id, name, kind) VALUES ('item-a', 'household-a', '2026年度 固定資産税', 'other')"),
    db.prepare("INSERT INTO managed_item_classifications (managed_item_id, household_id, kind_code, item_type_code) VALUES ('item-a', 'household-a', 'obligation', 'property_tax')"),
    db.prepare("INSERT INTO external_links (id, household_id, managed_item_id, url) VALUES ('link-a', 'household-a', 'item-a', 'https://example.com')"),
    db.prepare(`INSERT INTO task_rules (
      id, household_id, managed_item_id, title, recurrence_basis, deadline_kind
    ) VALUES ('rule-a', 'household-a', 'item-a', '納期限の確認', 'once', 'strict')`),
    db.prepare("INSERT INTO task_occurrences (id, household_id, task_rule_id, scheduled_for, due_at, status) VALUES ('occurrence-a', 'household-a', 'rule-a', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z', 'completed')"),
    db.prepare("INSERT INTO activity_logs (id, household_id, task_occurrence_id, action, actor_user_id, performed_by_user_id, occurred_at, idempotency_key) VALUES ('log-a', 'household-a', 'occurrence-a', 'completed', 'user-a', 'user-a', '2026-08-24T00:00:00.000Z', 'label-migration-log')"),
  ]);

  const kindsBefore = await db.prepare(
    "SELECT code, sort_order, is_active, legacy_kind FROM managed_item_kinds ORDER BY sort_order",
  ).all();
  const itemTypesBefore = await db.prepare(
    "SELECT code, kind_code, label, sort_order, is_active, legacy_kind FROM managed_item_type_presets ORDER BY kind_code, sort_order",
  ).all();

  await apply(kindLabelsSql);

  await expect(db.prepare(
    "SELECT code, label FROM managed_item_kinds WHERE is_active = 1 ORDER BY sort_order",
  ).all()).resolves.toMatchObject({
    results: [
      { code: "asset", label: "モノ" },
      { code: "service", label: "サービス" },
      { code: "obligation", label: "支払い・手続き" },
      { code: "other", label: "その他" },
    ],
  });

  // 表示ラベル以外は、大分類も詳しい種類もmigration前後で変わらない。
  await expect(db.prepare(
    "SELECT code, sort_order, is_active, legacy_kind FROM managed_item_kinds ORDER BY sort_order",
  ).all()).resolves.toMatchObject({ results: kindsBefore.results });
  await expect(db.prepare(
    "SELECT code, kind_code, label, sort_order, is_active, legacy_kind FROM managed_item_type_presets ORDER BY kind_code, sort_order",
  ).all()).resolves.toMatchObject({ results: itemTypesBefore.results });

  // 既存のManagedItemと分類行、関連データはそのまま残る。
  await expect(db.prepare(
    "SELECT kind_code, item_type_code, custom_item_type FROM managed_item_classifications WHERE managed_item_id = 'item-a'",
  ).first()).resolves.toMatchObject({
    custom_item_type: null,
    item_type_code: "property_tax",
    kind_code: "obligation",
  });
  for (const table of ["managed_items", "external_links", "task_rules", "task_occurrences", "activity_logs"]) {
    await expect(db.prepare(`SELECT count(*) AS count FROM ${table}`).first<{ count: number }>())
      .resolves.toMatchObject({ count: 1 });
  }
});
