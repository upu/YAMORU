// Issue #99 / YDR-037: 0016は新しいrecurrence_basisを足すために、task_rulesと
// その子テーブル(task_occurrences・activity_logs・completion_corrections・
// task_rule_consumables)を作り直す。既存の行・履歴・外部キー・索引・
// トリガーが残ることを、migration適用の前後で確かめる。
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { applyMigrations, applyMigrationsThrough } from "./test-support/migrations";

const db = env.DB;

// 0016はtask_rulesとその子テーブルを作り直すため、既存の行・履歴・外部キー・
// 索引・トリガーが残ることを、migration適用の前後で確かめる。
describe("固定間隔ルールのmigration(0016_interval_recurrence)", () => {
  it("既存のTaskRule・Occurrence・履歴・消耗品の関連を保ったまま新しい方式を足す", async () => {
    await applyMigrationsThrough(db, "0015_merge_service_obligation_kinds");
    await db.batch([
      db.prepare("INSERT INTO users (id, email) VALUES ('user-a', 'a@example.com')"),
      db.prepare("INSERT INTO households (id, name) VALUES ('household-a', 'Household A')"),
      db.prepare("INSERT INTO household_members (household_id, user_id) VALUES ('household-a', 'user-a')"),
      db.prepare("INSERT INTO consumables (id, household_id, name) VALUES ('consumable-a', 'household-a', 'Filter')"),
      db.prepare(`INSERT INTO task_rules (
        id, household_id, title, recurrence_basis, deadline_kind,
        recommended_start_offset, recommended_until_offset
      ) VALUES ('legacy-rule', 'household-a', 'Legacy', 'completion', 'maintenance', 1, 2)`),
      db.prepare(`INSERT INTO task_rules (
        id, household_id, title, recurrence_basis, deadline_kind,
        schedule_kind, schedule_day_of_month, schedule_month_end
      ) VALUES ('month-end-rule', 'household-a', 'Month end', 'calendar', 'strict', 'monthly_day', 31, 1)`),
      db.prepare("INSERT INTO task_occurrences (id, household_id, task_rule_id, scheduled_for, due_at, status) VALUES ('legacy-occurrence', 'household-a', 'legacy-rule', '2026-08-24T00:00:00.000Z', '2026-08-26T00:00:00.000Z', 'completed')"),
      db.prepare("INSERT INTO activity_logs (id, household_id, task_occurrence_id, action, actor_user_id, performed_by_user_id, occurred_at, idempotency_key) VALUES ('legacy-log', 'household-a', 'legacy-occurrence', 'completed', 'user-a', 'user-a', '2026-08-24T00:00:00.000Z', 'legacy-complete')"),
      db.prepare("INSERT INTO completion_corrections (id, household_id, task_occurrence_id, completed_activity_log_id, actor_user_id, idempotency_key, previous_occurred_at, new_occurred_at) VALUES ('legacy-correction', 'household-a', 'legacy-occurrence', 'legacy-log', 'user-a', 'legacy-correct', '2026-08-24T00:00:00.000Z', '2026-08-23T00:00:00.000Z')"),
      db.prepare("INSERT INTO task_rule_consumables (household_id, task_rule_id, consumable_id) VALUES ('household-a', 'legacy-rule', 'consumable-a')"),
    ]);

    await applyMigrations(db, ["0016_interval_recurrence"]);

    await expect(db.prepare(
      "SELECT recurrence_basis, recommended_start_offset, interval_unit FROM task_rules WHERE id = 'legacy-rule'",
    ).first()).resolves.toEqual({
      interval_unit: null,
      recommended_start_offset: 1,
      recurrence_basis: "completion",
    });
    await expect(db.prepare(
      "SELECT schedule_month_end FROM task_rules WHERE id = 'month-end-rule'",
    ).first()).resolves.toEqual({ schedule_month_end: 1 });
    await expect(db.prepare(
      "SELECT status FROM task_occurrences WHERE id = 'legacy-occurrence'",
    ).first()).resolves.toEqual({ status: "completed" });
    await expect(db.prepare(
      "SELECT id FROM activity_logs WHERE id = 'legacy-log'",
    ).first()).resolves.toMatchObject({ id: "legacy-log" });
    await expect(db.prepare(
      "SELECT id FROM completion_corrections WHERE id = 'legacy-correction'",
    ).first()).resolves.toMatchObject({ id: "legacy-correction" });
    await expect(db.prepare(
      "SELECT task_rule_id FROM task_rule_consumables WHERE consumable_id = 'consumable-a'",
    ).first()).resolves.toEqual({ task_rule_id: "legacy-rule" });
    await expect(db.prepare("PRAGMA foreign_key_check").all()).resolves.toMatchObject({ results: [] });

    // 作り直したテーブルの索引・トリガーが戻っていること(単一pending制約と
    // 予定日未定の限定は、0009のまま維持する)。
    const indexes = await db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'task_occurrences'",
    ).all<{ name: string }>();
    expect(indexes.results.map(({ name }) => name))
      .toContain("task_occurrences_one_pending_per_rule_idx");
    const triggers = await db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'trigger'",
    ).all<{ name: string }>();
    expect(triggers.results.map(({ name }) => name)).toEqual(expect.arrayContaining([
      "task_occurrences_undated_once_insert",
      "task_occurrences_undated_once_update",
      "task_rules_keep_undated_occurrences_once",
      "task_rules_month_end_requires_monthly_day_insert",
      "task_rules_month_end_requires_monthly_day_update",
      "task_rule_consumables_maintenance_only",
    ]));
  });
});
