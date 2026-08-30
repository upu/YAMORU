import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { applyMigrations, applyMigrationsThrough } from "./test-support/migrations";

const db = env.DB;

describe("予定日未定Todoのmigration", () => {
  it("既存Occurrence・履歴・外部キー・一意制約を保持してNULLペアを一回限りに限定する", async () => {
    await applyMigrationsThrough(db, "0008_managed_item_optional_attributes");
    await db.batch([
      db.prepare("INSERT INTO users (id, email) VALUES ('user-a', 'a@example.com')"),
      db.prepare("INSERT INTO households (id, name) VALUES ('household-a', 'Household A')"),
      db.prepare("INSERT INTO household_members (household_id, user_id) VALUES ('household-a', 'user-a')"),
      db.prepare("INSERT INTO task_rules (id, household_id, title, recurrence_basis, deadline_kind) VALUES ('once-rule', 'household-a', 'Once', 'once', 'strict')"),
      db.prepare("INSERT INTO task_occurrences (id, household_id, task_rule_id, scheduled_for, due_at, status) VALUES ('legacy-occurrence', 'household-a', 'once-rule', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z', 'completed')"),
      db.prepare("INSERT INTO activity_logs (id, household_id, task_occurrence_id, action, actor_user_id, performed_by_user_id, occurred_at, idempotency_key) VALUES ('legacy-log', 'household-a', 'legacy-occurrence', 'completed', 'user-a', 'user-a', '2026-08-24T00:00:00.000Z', 'legacy-complete')"),
      db.prepare("INSERT INTO completion_corrections (id, household_id, task_occurrence_id, completed_activity_log_id, actor_user_id, idempotency_key, previous_occurred_at, new_occurred_at) VALUES ('legacy-correction', 'household-a', 'legacy-occurrence', 'legacy-log', 'user-a', 'legacy-correct', '2026-08-24T00:00:00.000Z', '2026-08-23T00:00:00.000Z')"),
    ]);

    await applyMigrations(db, ["0009_undated_one_time_todos"]);

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
