// Issue #329 / YDR-047: 0028はtask_rulesへnote列を足すだけのexpand migration。
// 既存行がメモ未設定(NULL)のまま残ること、空文字と上限超過をDB側が拒否する
// ことを確かめる。
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { applyMigrations, applyMigrationsThrough } from "./test-support/migrations";

const db = env.DB;

describe("Todoのメモのmigration(0028_task_rule_note)", () => {
  it("既存のTaskRuleを保ったままnote列を足し、既存行はメモ未設定になる", async () => {
    await applyMigrationsThrough(db, "0027_manual_recurrence");
    await db.batch([
      db.prepare("INSERT INTO users (id, email) VALUES ('user-a', 'a@example.com')"),
      db.prepare("INSERT INTO households (id, name) VALUES ('household-a', 'Household A')"),
      db.prepare("INSERT INTO household_members (household_id, user_id) VALUES ('household-a', 'user-a')"),
      db.prepare(`INSERT INTO task_rules (
        id, household_id, title, recurrence_basis, deadline_kind
      ) VALUES ('legacy-rule', 'household-a', 'Legacy', 'once', 'strict')`),
      db.prepare("INSERT INTO task_occurrences (id, household_id, task_rule_id, scheduled_for, due_at) VALUES ('legacy-occurrence', 'household-a', 'legacy-rule', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z')"),
    ]);

    await applyMigrations(db, ["0028_task_rule_note"]);

    await expect(db.prepare(
      "SELECT title, note FROM task_rules WHERE id = 'legacy-rule'",
    ).first()).resolves.toEqual({ note: null, title: "Legacy" });
    await expect(db.prepare(
      "SELECT id FROM task_occurrences WHERE id = 'legacy-occurrence'",
    ).first()).resolves.toMatchObject({ id: "legacy-occurrence" });
    await expect(db.prepare("PRAGMA foreign_key_check").all())
      .resolves.toMatchObject({ results: [] });

    // 空文字は「メモ未設定」と区別できないため保存させない。上限も守る。
    await expect(db.prepare(
      "UPDATE task_rules SET note = '' WHERE id = 'legacy-rule'",
    ).run()).rejects.toThrow();
    await expect(db.prepare(
      "UPDATE task_rules SET note = ?1 WHERE id = 'legacy-rule'",
    ).bind("あ".repeat(1001)).run()).rejects.toThrow();
    await expect(db.prepare(
      "UPDATE task_rules SET note = ?1 WHERE id = 'legacy-rule'",
    ).bind("あ".repeat(1000)).run()).resolves.toBeDefined();
  });
});
