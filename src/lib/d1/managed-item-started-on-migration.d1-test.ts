import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

import schemaSql from "../../../d1/migrations/0001_init.sql?raw";
import authSchemaSql from "../../../d1/migrations/0002_auth_invitation_claims.sql?raw";
import migrationAuditSql from "../../../d1/migrations/0003_preserve_supabase_audit_fields.sql?raw";
import completionCorrectionsSql from "../../../d1/migrations/0004_completion_corrections.sql?raw";
import classificationSql from "../../../d1/migrations/0005_managed_item_classification.sql?raw";
import propertyTaxSql from "../../../d1/migrations/0006_property_tax_item_type.sql?raw";
import kindLabelsSql from "../../../d1/migrations/0007_managed_item_kind_labels.sql?raw";
import optionalAttributesSql from "../../../d1/migrations/0008_managed_item_optional_attributes.sql?raw";
import startedOnSql from "../../../d1/migrations/0011_managed_item_started_on.sql?raw";

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

// Issue #239: 0011は既存のpurchased_onを書き換えず、started_onへコピーする
// (YDR-033)。分かる精度(年・年月・年月日)それぞれで値が失われないことと、
// 未設定行がNULLのまま残ることを確認する。
it("既存のpurchased_onを書き換えず、同じ値をstarted_onへコピーする(Issue #239)", async () => {
  await apply(
    schemaSql,
    authSchemaSql,
    migrationAuditSql,
    completionCorrectionsSql,
    classificationSql,
    propertyTaxSql,
    kindLabelsSql,
    optionalAttributesSql,
  );
  await db.batch([
    db.prepare("INSERT INTO users (id, email) VALUES ('user-a', 'a@example.com')"),
    db.prepare("INSERT INTO households (id, name) VALUES ('household-a', 'Household A')"),
    db.prepare("INSERT INTO household_members (household_id, user_id) VALUES ('household-a', 'user-a')"),
    db.prepare(
      "INSERT INTO managed_items (id, household_id, name, kind, purchased_on) VALUES ('item-year', 'household-a', '年だけの対象', 'other', '2024')",
    ),
    db.prepare(
      "INSERT INTO managed_items (id, household_id, name, kind, purchased_on) VALUES ('item-month', 'household-a', '年月の対象', 'other', '2024-05')",
    ),
    db.prepare(
      "INSERT INTO managed_items (id, household_id, name, kind, purchased_on) VALUES ('item-day', 'household-a', '年月日の対象', 'other', '2024-05-10')",
    ),
    db.prepare(
      "INSERT INTO managed_items (id, household_id, name, kind) VALUES ('item-unset', 'household-a', '未設定の対象', 'other')",
    ),
  ]);

  await apply(startedOnSql);

  const rows = await db.prepare(
    "SELECT id, purchased_on, started_on FROM managed_items ORDER BY id",
  ).all<{ id: string; purchased_on: string | null; started_on: string | null }>();
  expect(rows.results).toEqual([
    { id: "item-day", purchased_on: "2024-05-10", started_on: "2024-05-10" },
    { id: "item-month", purchased_on: "2024-05", started_on: "2024-05" },
    { id: "item-unset", purchased_on: null, started_on: null },
    { id: "item-year", purchased_on: "2024", started_on: "2024" },
  ]);
});
