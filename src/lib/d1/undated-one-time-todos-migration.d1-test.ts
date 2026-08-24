import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import schemaSql from "../../../d1/migrations/0001_init.sql?raw";
import authSchemaSql from "../../../d1/migrations/0002_auth_invitation_claims.sql?raw";
import migrationAuditSql from "../../../d1/migrations/0003_preserve_supabase_audit_fields.sql?raw";
import completionCorrectionsSql from "../../../d1/migrations/0004_completion_corrections.sql?raw";
import classificationSql from "../../../d1/migrations/0005_managed_item_classification.sql?raw";
import propertyTaxSql from "../../../d1/migrations/0006_property_tax_item_type.sql?raw";
import kindLabelsSql from "../../../d1/migrations/0007_managed_item_kind_labels.sql?raw";
import optionalAttributesSql from "../../../d1/migrations/0008_managed_item_optional_attributes.sql?raw";
import undatedTodosSql from "../../../d1/migrations/0009_undated_one_time_todos.sql?raw";

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

function triggerAwareStatements(sql: string): string[] {
  const cleaned = sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  const triggers = [...cleaned.matchAll(/CREATE TRIGGER[\s\S]*?END;/g)]
    .map(([statement]) => statement.trim());
  const regular = cleaned
    .replaceAll(/CREATE TRIGGER[\s\S]*?END;/g, "")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
  return [...regular, ...triggers];
}

async function applyLegacySchema(): Promise<void> {
  const sql = [
    schemaSql,
    authSchemaSql,
    migrationAuditSql,
    completionCorrectionsSql,
    classificationSql,
    propertyTaxSql,
    kindLabelsSql,
    optionalAttributesSql,
  ].join("\n");
  await db.batch(statements(sql).map((statement) => db.prepare(statement)));
}

describe("予定日未定Todoのmigration", () => {
  it("既存Occurrence・履歴・外部キー・一意制約を保持してNULLペアを一回限りに限定する", async () => {
    await applyLegacySchema();
    await db.batch([
      db.prepare("INSERT INTO users (id, email) VALUES ('user-a', 'a@example.com')"),
      db.prepare("INSERT INTO households (id, name) VALUES ('household-a', 'Household A')"),
      db.prepare("INSERT INTO household_members (household_id, user_id) VALUES ('household-a', 'user-a')"),
      db.prepare("INSERT INTO task_rules (id, household_id, title, recurrence_basis, deadline_kind) VALUES ('once-rule', 'household-a', 'Once', 'once', 'strict')"),
      db.prepare("INSERT INTO task_occurrences (id, household_id, task_rule_id, scheduled_for, due_at, status) VALUES ('legacy-occurrence', 'household-a', 'once-rule', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z', 'completed')"),
      db.prepare("INSERT INTO activity_logs (id, household_id, task_occurrence_id, action, actor_user_id, performed_by_user_id, occurred_at, idempotency_key) VALUES ('legacy-log', 'household-a', 'legacy-occurrence', 'completed', 'user-a', 'user-a', '2026-08-24T00:00:00.000Z', 'legacy-complete')"),
      db.prepare("INSERT INTO completion_corrections (id, household_id, task_occurrence_id, completed_activity_log_id, actor_user_id, idempotency_key, previous_occurred_at, new_occurred_at) VALUES ('legacy-correction', 'household-a', 'legacy-occurrence', 'legacy-log', 'user-a', 'legacy-correct', '2026-08-24T00:00:00.000Z', '2026-08-23T00:00:00.000Z')"),
    ]);

    await db.batch(
      triggerAwareStatements(undatedTodosSql).map((statement) => db.prepare(statement)),
    );

    await expect(db.prepare(
      "SELECT scheduled_for, due_at, status FROM task_occurrences WHERE id = 'legacy-occurrence'",
    ).first()).resolves.toMatchObject({
      due_at: "2026-08-24T00:00:00.000Z",
      scheduled_for: "2026-08-24T00:00:00.000Z",
      status: "completed",
    });
    await expect(db.prepare(
      "SELECT id FROM activity_logs WHERE id = 'legacy-log'",
    ).first()).resolves.toMatchObject({ id: "legacy-log" });
    await expect(db.prepare(
      "SELECT id FROM completion_corrections WHERE id = 'legacy-correction'",
    ).first()).resolves.toMatchObject({ id: "legacy-correction" });
    await expect(db.prepare("PRAGMA foreign_key_check").all()).resolves.toMatchObject({ results: [] });

    await db.prepare(
      "INSERT INTO task_occurrences (id, household_id, task_rule_id, scheduled_for, due_at) VALUES ('undated', 'household-a', 'once-rule', NULL, NULL)",
    ).run();
    await expect(db.prepare(
      "INSERT INTO task_occurrences (id, household_id, task_rule_id, scheduled_for, due_at) VALUES ('half-null', 'household-a', 'once-rule', NULL, '2026-09-01T00:00:00.000Z')",
    ).run()).rejects.toThrow();

    await db.prepare(
      "INSERT INTO task_rules (id, household_id, title, recurrence_basis, deadline_kind, recommended_start_offset, recommended_until_offset) VALUES ('repeat-rule', 'household-a', 'Repeat', 'completion', 'maintenance', 1, 2)",
    ).run();
    await expect(db.prepare(
      "INSERT INTO task_occurrences (id, household_id, task_rule_id, scheduled_for, due_at) VALUES ('repeat-undated', 'household-a', 'repeat-rule', NULL, NULL)",
    ).run()).rejects.toThrow("undated occurrence requires once recurrence");
    await expect(db.prepare(
      "INSERT INTO task_occurrences (id, household_id, task_rule_id, scheduled_for, due_at) VALUES ('second-pending', 'household-a', 'once-rule', NULL, NULL)",
    ).run()).rejects.toThrow();
    await expect(db.prepare(
      "INSERT INTO task_occurrences (id, household_id, task_rule_id, scheduled_for, due_at, status) VALUES ('duplicate-slot', 'household-a', 'once-rule', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z', 'skipped')",
    ).run()).rejects.toThrow();

    const indexes = await db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'task_occurrences'",
    ).all<{ name: string }>();
    expect(indexes.results.map(({ name }) => name)).toEqual(expect.arrayContaining([
      "task_occurrences_household_id_idx",
      "task_occurrences_one_pending_per_rule_idx",
    ]));
  });
});
