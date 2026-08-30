import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

import { applyMigrations, applyMigrationsThrough } from "./test-support/migrations";

const db = env.DB;

it("既存の台帳・リンク・Todo・Occurrence・履歴を保持して分類を段階移行する(Issue #41)", async () => {
  await applyMigrationsThrough(db, "0004_completion_corrections");
  await db.batch([
    db.prepare("INSERT INTO users (id, email) VALUES ('user-a', 'a@example.com')"),
    db.prepare("INSERT INTO households (id, name) VALUES ('household-a', 'Household A')"),
    db.prepare("INSERT INTO household_members (household_id, user_id) VALUES ('household-a', 'user-a')"),
    db.prepare("INSERT INTO managed_items (id, household_id, name, kind) VALUES ('item-a', 'household-a', 'Item A', 'pet_supplies')"),
    db.prepare("INSERT INTO external_links (id, household_id, managed_item_id, url) VALUES ('link-a', 'household-a', 'item-a', 'https://example.com')"),
    db.prepare(`INSERT INTO task_rules (
      id, household_id, managed_item_id, title, recurrence_basis, deadline_kind
    ) VALUES ('rule-a', 'household-a', 'item-a', 'Todo A', 'once', 'strict')`),
    db.prepare("INSERT INTO task_occurrences (id, household_id, task_rule_id, scheduled_for, due_at, status) VALUES ('occurrence-a', 'household-a', 'rule-a', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z', 'completed')"),
    db.prepare("INSERT INTO activity_logs (id, household_id, task_occurrence_id, action, actor_user_id, performed_by_user_id, occurred_at, idempotency_key) VALUES ('log-a', 'household-a', 'occurrence-a', 'completed', 'user-a', 'user-a', '2026-08-24T00:00:00.000Z', 'migration-log')"),
  ]);

  await applyMigrations(db, ["0005_managed_item_classification"]);

  await expect(db.prepare(
    "SELECT kind_code, item_type_code, custom_item_type FROM managed_item_classifications WHERE managed_item_id = 'item-a'",
  ).first()).resolves.toMatchObject({
    custom_item_type: null,
    item_type_code: "pet_supplies",
    kind_code: "asset",
  });
  for (const table of ["managed_items", "external_links", "task_rules", "task_occurrences", "activity_logs"]) {
    await expect(db.prepare(`SELECT count(*) AS count FROM ${table}`).first<{ count: number }>())
      .resolves.toMatchObject({ count: 1 });
  }
});
