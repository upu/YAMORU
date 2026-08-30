// D1統合テスト(src/lib/d1/**/*.d1-test.ts)がスキーマを用意するための共通処理。
//
// 以前は各テストがmigration SQLのimportと文分割を独自に持っていたため、
// migrationを1本追加するたびに8ファイルのimportリストを直す必要があった(#276)。
// 適用順の正本をここに一つだけ置く。
//
// このファイルは"cloudflare:workers"を読み込まず、D1Databaseを引数で受け取る。
// そのためd1-test本体と違い、通常のtsconfig.jsonとeslintの型検査対象に収まる。

import initSql from "../../../../d1/migrations/0001_init.sql?raw";
import authInvitationClaimsSql from "../../../../d1/migrations/0002_auth_invitation_claims.sql?raw";
import preserveSupabaseAuditFieldsSql from "../../../../d1/migrations/0003_preserve_supabase_audit_fields.sql?raw";
import completionCorrectionsSql from "../../../../d1/migrations/0004_completion_corrections.sql?raw";
import managedItemClassificationSql from "../../../../d1/migrations/0005_managed_item_classification.sql?raw";
import propertyTaxItemTypeSql from "../../../../d1/migrations/0006_property_tax_item_type.sql?raw";
import managedItemKindLabelsSql from "../../../../d1/migrations/0007_managed_item_kind_labels.sql?raw";
import managedItemOptionalAttributesSql from "../../../../d1/migrations/0008_managed_item_optional_attributes.sql?raw";
import undatedOneTimeTodosSql from "../../../../d1/migrations/0009_undated_one_time_todos.sql?raw";
import monthlyDayMonthEndSql from "../../../../d1/migrations/0010_monthly_day_month_end.sql?raw";
import managedItemStartedOnSql from "../../../../d1/migrations/0011_managed_item_started_on.sql?raw";
import consumablesSql from "../../../../d1/migrations/0012_consumables.sql?raw";

// d1/migrations/のファイル名と同じ順序。migrationを追加したらここへ足す。
const MIGRATIONS = [
  { name: "0001_init", sql: initSql },
  { name: "0002_auth_invitation_claims", sql: authInvitationClaimsSql },
  { name: "0003_preserve_supabase_audit_fields", sql: preserveSupabaseAuditFieldsSql },
  { name: "0004_completion_corrections", sql: completionCorrectionsSql },
  { name: "0005_managed_item_classification", sql: managedItemClassificationSql },
  { name: "0006_property_tax_item_type", sql: propertyTaxItemTypeSql },
  { name: "0007_managed_item_kind_labels", sql: managedItemKindLabelsSql },
  { name: "0008_managed_item_optional_attributes", sql: managedItemOptionalAttributesSql },
  { name: "0009_undated_one_time_todos", sql: undatedOneTimeTodosSql },
  { name: "0010_monthly_day_month_end", sql: monthlyDayMonthEndSql },
  { name: "0011_managed_item_started_on", sql: managedItemStartedOnSql },
  { name: "0012_consumables", sql: consumablesSql },
] as const;

export type MigrationName = (typeof MIGRATIONS)[number]["name"];

// db.batch()は文を1つずつ受け取るため、SQLを文へ分割する。CREATE TRIGGERの
// 本体は`;`を含み素朴な分割では途中で切れてしまうので、先にトリガーを丸ごと
// 取り出し、残りを`;`で分割してから末尾へ戻す。トリガーを持たないmigrationでは
// 取り出しが空振りし、単純な`;`分割と同じ結果になる。
function migrationStatements(sql: string): string[] {
  const withoutComments = sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  const triggers = [...withoutComments.matchAll(/CREATE TRIGGER[\s\S]*?END;/g)]
    .map(([statement]) => statement.trim());
  const regular = withoutComments
    .replaceAll(/CREATE TRIGGER[\s\S]*?END;/g, "")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
  return [...regular, ...triggers];
}

function sqlFor(name: MigrationName): string {
  const migration = MIGRATIONS.find((candidate) => candidate.name === name);
  if (migration === undefined) throw new Error(`未知のmigrationです: ${name}`);
  return migration.sql;
}

// 指定したmigrationを、渡された順に1本ずつ別のbatchで適用する。migrationごとに
// 分けるのは、そのmigrationのトリガーが同じmigrationの他の文より後、かつ次の
// migrationより前に作られる順序を保つため。
export async function applyMigrations(
  db: D1Database,
  names: readonly MigrationName[],
): Promise<void> {
  for (const name of names) {
    await db.batch(migrationStatements(sqlFor(name)).map((statement) => db.prepare(statement)));
  }
}

// 先頭からlastまで(lastを含む)を適用する。migration適用前の状態を用意して
// から次の1本を当てる、migration自体のテストで使う。
export async function applyMigrationsThrough(
  db: D1Database,
  last: MigrationName,
): Promise<void> {
  const index = MIGRATIONS.findIndex((candidate) => candidate.name === last);
  if (index < 0) throw new Error(`未知のmigrationです: ${last}`);
  await applyMigrations(db, MIGRATIONS.slice(0, index + 1).map((migration) => migration.name));
}

// 現在のスキーマを用意する。本番と同じ状態を前提に動作を確かめるテストは
// これを使い、適用範囲を各テストで持たない。
export async function applyAllMigrations(db: D1Database): Promise<void> {
  await applyMigrations(db, MIGRATIONS.map((migration) => migration.name));
}
