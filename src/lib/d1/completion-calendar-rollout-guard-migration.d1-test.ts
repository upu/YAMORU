// Issue #48 / YDR-038: 月・年ルールを理解しない旧Workerが次回Occurrenceを
// 作ろうとしても、誤った日付を保存せず安全に失敗するexpand-firstガード。
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import { applyMigrations, applyMigrationsThrough } from "./test-support/migrations";

const db = env.DB;

beforeAll(async () => {
  await applyMigrationsThrough(db, "0017_completion_calendar_intervals");
  await db.batch([
    db.prepare("INSERT INTO users (id, email) VALUES ('user-a', 'a@example.com')"),
    db.prepare("INSERT INTO households (id, name) VALUES ('household-a', 'Household A')"),
    db.prepare(`INSERT INTO task_rules (
      id, household_id, title, recurrence_basis, deadline_kind,
      recommended_start_offset, recommended_until_offset,
      recommended_start_value, recommended_until_value, recommended_unit
    ) VALUES ('month-rule', 'household-a', 'Monthly', 'completion', 'maintenance',
      0, 0, 1, 2, 'month')`),
    db.prepare(`INSERT INTO task_occurrences (
      id, household_id, task_rule_id, scheduled_for, due_at, status
    ) VALUES ('pre-guard', 'household-a', 'month-rule',
      '2025-01-30T15:00:00.000Z', '2025-02-27T15:00:00.000Z', 'completed')`),
  ]);
  await applyMigrations(db, ["0018_completion_calendar_rollout_guard"]);
});

describe("完了日基準の暦間隔rollout guard migration", () => {
  it("migration前のOccurrenceを保持する", async () => {
    await expect(db.prepare(`SELECT completion_calendar_version
      FROM task_occurrences WHERE id = 'pre-guard'`).first()).resolves.toEqual({
      completion_calendar_version: null,
    });
  });

  it("旧Worker形式を拒否し、version付きOccurrenceを受け入れる", async () => {
    await expect(db.prepare(`INSERT INTO task_occurrences (
      id, household_id, task_rule_id, scheduled_for, due_at
    ) VALUES ('old-worker', 'household-a', 'month-rule',
      '2025-02-27T15:00:00.000Z', '2025-03-30T15:00:00.000Z')`)
      .run()).rejects.toThrow("calendar-aware Worker");

    await expect(db.prepare(`INSERT INTO task_occurrences (
      id, household_id, task_rule_id, scheduled_for, due_at,
      completion_calendar_version
    ) VALUES ('new-worker', 'household-a', 'month-rule',
      '2025-02-27T15:00:00.000Z', '2025-03-30T15:00:00.000Z', 1)`)
      .run()).resolves.toBeDefined();
  });

  it("不明なversionを拒否する", async () => {
    await expect(db.prepare(`INSERT INTO task_occurrences (
      id, household_id, task_rule_id, scheduled_for, due_at,
      completion_calendar_version
    ) VALUES ('future-worker', 'household-a', 'month-rule',
      '2025-02-27T15:00:00.000Z', '2025-03-30T15:00:00.000Z', 2)`)
      .run()).rejects.toThrow();
  });
});
