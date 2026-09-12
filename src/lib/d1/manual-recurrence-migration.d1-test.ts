// Issue #325 / YDR-046: 0027は新しいrecurrence_basis('manual')を足すために、
// task_rulesとその子孫テーブルを作り直す。既存の行・履歴・関連・外部キー・
// 索引・トリガーが残ること、予定日未定の制約が'once'に加えて'manual'まで
// 広がること、逆にmanualへ日付を入れられないことを確かめる。
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import { applyMigrations, applyMigrationsThrough } from "./test-support/migrations";

const db = env.DB;

beforeAll(async () => {
  await applyMigrationsThrough(db, "0026_user_consumable_pins");
  await db.batch([
    db.prepare("INSERT INTO users (id, email) VALUES ('user-a', 'a@example.com')"),
    db.prepare("INSERT INTO households (id, name) VALUES ('household-a', 'Household A')"),
    db.prepare("INSERT INTO household_members (household_id, user_id) VALUES ('household-a', 'user-a')"),
    db.prepare("INSERT INTO consumables (id, household_id, name) VALUES ('consumable-a', 'household-a', 'Filter')"),
    db.prepare(`INSERT INTO task_rules (
      id, household_id, title, recurrence_basis, deadline_kind,
      recommended_start_offset, recommended_until_offset,
      recommended_start_value, recommended_until_value, recommended_unit
    ) VALUES ('legacy-rule', 'household-a', 'Legacy', 'completion', 'maintenance', 7, 14, 1, 2, 'week')`),
    db.prepare(`INSERT INTO task_rules (
      id, household_id, title, recurrence_basis, deadline_kind, schedule_kind
    ) VALUES ('weekly-rule', 'household-a', 'Weekly', 'calendar', 'strict', 'weekly')`),
    db.prepare(`INSERT INTO task_rule_schedules (
      id, household_id, task_rule_id, schedule_kind, day_of_week
    ) VALUES ('weekly-spec', 'household-a', 'weekly-rule', 'weekly', 1)`),
    db.prepare(`INSERT INTO task_rules (
      id, household_id, title, recurrence_basis, deadline_kind
    ) VALUES ('once-rule', 'household-a', 'Once', 'once', 'strict')`),
    db.prepare("INSERT INTO task_occurrences (id, household_id, task_rule_id, scheduled_for, due_at, status) VALUES ('legacy-occurrence', 'household-a', 'legacy-rule', '2026-08-24T00:00:00.000Z', '2026-08-26T00:00:00.000Z', 'completed')"),
    db.prepare("INSERT INTO task_occurrences (id, household_id, task_rule_id, scheduled_for, due_at) VALUES ('undated-occurrence', 'household-a', 'once-rule', NULL, NULL)"),
    db.prepare("INSERT INTO activity_logs (id, household_id, task_occurrence_id, action, actor_user_id, performed_by_user_id, occurred_at, idempotency_key) VALUES ('legacy-log', 'household-a', 'legacy-occurrence', 'completed', 'user-a', 'user-a', '2026-08-24T00:00:00.000Z', 'legacy-complete')"),
    db.prepare("INSERT INTO completion_corrections (id, household_id, task_occurrence_id, completed_activity_log_id, actor_user_id, idempotency_key, previous_occurred_at, new_occurred_at) VALUES ('legacy-correction', 'household-a', 'legacy-occurrence', 'legacy-log', 'user-a', 'legacy-correct', '2026-08-24T00:00:00.000Z', '2026-08-23T00:00:00.000Z')"),
    db.prepare("INSERT INTO task_rule_consumables (household_id, task_rule_id, consumable_id) VALUES ('household-a', 'legacy-rule', 'consumable-a')"),
    db.prepare("INSERT INTO task_rule_changes (id, household_id, task_rule_id, task_occurrence_id, actor_user_id, previous_rule_snapshot, new_rule_snapshot) VALUES ('legacy-change', 'household-a', 'legacy-rule', 'legacy-occurrence', 'user-a', '{}', json_object('title', 'Legacy'))"),
  ]);

  await applyMigrations(db, ["0027_manual_recurrence"]);
});

describe("必要になったら繰り返すTodoのmigration(0027_manual_recurrence)", () => {
  it("既存のTaskRule・Occurrence・履歴・関連・候補指定をそのまま保つ", async () => {
    await expect(db.prepare(
      `SELECT recurrence_basis, recommended_start_offset, recommended_start_value,
              recommended_unit FROM task_rules WHERE id = 'legacy-rule'`,
    ).first()).resolves.toEqual({
      recommended_start_offset: 7,
      recommended_start_value: 1,
      recommended_unit: "week",
      recurrence_basis: "completion",
    });
    await expect(db.prepare(
      "SELECT scheduled_for, due_at, status FROM task_occurrences WHERE id = 'undated-occurrence'",
    ).first()).resolves.toEqual({ due_at: null, scheduled_for: null, status: "pending" });
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
    await expect(db.prepare(
      "SELECT task_rule_id FROM task_rule_changes WHERE id = 'legacy-change'",
    ).first()).resolves.toEqual({ task_rule_id: "legacy-rule" });
    await expect(db.prepare(
      "SELECT day_of_week FROM task_rule_schedules WHERE id = 'weekly-spec'",
    ).first()).resolves.toEqual({ day_of_week: 1 });
    await expect(db.prepare("PRAGMA foreign_key_check").all()).resolves.toMatchObject({ results: [] });
  });

  it("作り直したテーブルの索引とトリガーが戻る", async () => {
    const indexes = await db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'task_occurrences'",
    ).all<{ name: string }>();
    expect(indexes.results.map(({ name }) => name))
      .toContain("task_occurrences_one_pending_per_rule_idx");

    const triggers = await db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'trigger'",
    ).all<{ name: string }>();
    expect(triggers.results.map(({ name }) => name)).toEqual(expect.arrayContaining([
      "task_occurrences_undated_once_or_manual_insert",
      "task_occurrences_undated_once_or_manual_update",
      "task_rules_keep_undated_occurrences_once_or_manual",
      "task_occurrences_manual_requires_undated_insert",
      "task_occurrences_manual_requires_undated_update",
      "task_rules_manual_requires_undated_occurrences",
      "task_rules_month_end_requires_monthly_day_insert",
      "task_rules_month_end_requires_monthly_day_update",
      "task_rule_consumables_maintenance_only",
      "task_rules_completion_interval_insert",
      "task_rules_completion_interval_update",
      "task_occurrences_completion_calendar_insert",
      "task_occurrences_schedule_spec_insert",
    ]));
  });

  it("manualは予定日未定のOccurrenceを持てるが、日付を持てない", async () => {
    await db.prepare(`INSERT INTO task_rules (
      id, household_id, title, recurrence_basis, deadline_kind
    ) VALUES ('manual-rule', 'household-a', 'Descale', 'manual', 'strict')`).run();

    await expect(db.prepare(
      "INSERT INTO task_occurrences (id, household_id, task_rule_id, scheduled_for, due_at) VALUES ('manual-pending', 'household-a', 'manual-rule', NULL, NULL)",
    ).run()).resolves.toBeDefined();
    await expect(db.prepare(
      "INSERT INTO task_occurrences (id, household_id, task_rule_id, scheduled_for, due_at, status) VALUES ('manual-dated', 'household-a', 'manual-rule', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', 'skipped')",
    ).run()).rejects.toThrow("manual recurrence requires an undated occurrence");
    await expect(db.prepare(
      "UPDATE task_occurrences SET scheduled_for = '2026-09-01T00:00:00.000Z', due_at = '2026-09-01T00:00:00.000Z' WHERE id = 'manual-pending'",
    ).run()).rejects.toThrow("manual recurrence requires an undated occurrence");
  });

  it("予定日未定を残したまま日付を持つ方式へ変えられない", async () => {
    await db.prepare(`INSERT INTO task_rules (
      id, household_id, title, recurrence_basis, deadline_kind
    ) VALUES ('switch-from-manual', 'household-a', 'Switch', 'manual', 'strict')`).run();
    await db.prepare(
      "INSERT INTO task_occurrences (id, household_id, task_rule_id, scheduled_for, due_at) VALUES ('switch-undated', 'household-a', 'switch-from-manual', NULL, NULL)",
    ).run();

    await expect(db.prepare(
      "UPDATE task_rules SET recurrence_basis = 'once' WHERE id = 'switch-from-manual'",
    ).run()).resolves.toBeDefined();
    await expect(db.prepare(
      "UPDATE task_rules SET recurrence_basis = 'calendar' WHERE id = 'switch-from-manual'",
    ).run()).rejects.toThrow("undated occurrence requires once or manual recurrence");
  });

  it("日付を持つOccurrenceを残したままmanualへ変えられない", async () => {
    await db.prepare(`INSERT INTO task_rules (
      id, household_id, title, recurrence_basis, deadline_kind
    ) VALUES ('switch-to-manual', 'household-a', 'Switch', 'once', 'strict')`).run();
    await db.prepare(
      "INSERT INTO task_occurrences (id, household_id, task_rule_id, scheduled_for, due_at) VALUES ('switch-dated', 'household-a', 'switch-to-manual', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')",
    ).run();

    await expect(db.prepare(
      "UPDATE task_rules SET recurrence_basis = 'manual' WHERE id = 'switch-to-manual'",
    ).run()).rejects.toThrow("manual recurrence requires an undated occurrence");
  });

  it.each([
    ["推奨期間", "recommended_start_offset, recommended_until_offset", "1, 2"],
    ["定例日の種類", "schedule_kind", "'weekly'"],
    ["定例日の曜日", "schedule_day_of_week", "1"],
    ["月末指定", "schedule_month_end", "1"],
    ["固定間隔の単位", "interval_unit, interval_count, interval_anchor_on", "'day', 1, '2026-08-01'"],
  ])("manualに%sを持たせられない", async (label, columns, values) => {
    await expect(db.prepare(`INSERT INTO task_rules (
      id, household_id, title, recurrence_basis, deadline_kind, ${columns}
    ) VALUES ('ng-manual-${String(label)}', 'household-a', 'Manual', 'manual', 'strict', ${values})`)
      .run()).rejects.toThrow();
  });

  it("manualは厳密な期限としてだけ登録できる", async () => {
    await expect(db.prepare(`INSERT INTO task_rules (
      id, household_id, title, recurrence_basis, deadline_kind
    ) VALUES ('ng-manual-maintenance', 'household-a', 'Manual', 'manual', 'maintenance')`)
      .run()).rejects.toThrow();
  });
});
