import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

import { applyMigrations, applyMigrationsThrough } from "./test-support/migrations";

const db = env.DB;

it("obligationをserviceへ移し、ManagedItemの関連データと外部キーを保つ(Issue #302)", async () => {
  await applyMigrationsThrough(db, "0014_retire_other_managed_item_kind");
  await db.batch([
    db.prepare("INSERT INTO users (id, email) VALUES ('user-a', 'a@example.com')"),
    db.prepare("INSERT INTO households (id, name) VALUES ('household-a', 'Household A')"),
    db.prepare("INSERT INTO household_members (household_id, user_id) VALUES ('household-a', 'user-a')"),
    db.prepare("INSERT INTO managed_items (id, household_id, name, kind) VALUES ('tax-a', 'household-a', '固定資産税', 'other')"),
    db.prepare("INSERT INTO managed_item_classifications (managed_item_id, household_id, kind_code, item_type_code) VALUES ('tax-a', 'household-a', 'obligation', 'property_tax')"),
    db.prepare("INSERT INTO managed_items (id, household_id, name, kind) VALUES ('custom-a', 'household-a', '自治体への支払い', 'other')"),
    db.prepare("INSERT INTO managed_item_classifications (managed_item_id, household_id, kind_code, custom_item_type) VALUES ('custom-a', 'household-a', 'obligation', '自治体への支払い')"),
    db.prepare("INSERT INTO managed_items (id, household_id, name, kind) VALUES ('service-a', 'household-a', '相談サービス', 'contract')"),
    db.prepare("INSERT INTO managed_item_classifications (managed_item_id, household_id, kind_code, item_type_code) VALUES ('service-a', 'household-a', 'service', 'contract')"),
    db.prepare("INSERT INTO external_links (id, household_id, managed_item_id, url) VALUES ('link-a', 'household-a', 'tax-a', 'https://example.com/tax')"),
    db.prepare("INSERT INTO task_rules (id, household_id, managed_item_id, title, recurrence_basis, deadline_kind) VALUES ('rule-a', 'household-a', 'tax-a', '納付確認', 'once', 'strict')"),
    db.prepare("INSERT INTO task_occurrences (id, household_id, task_rule_id, scheduled_for, due_at, status) VALUES ('occurrence-a', 'household-a', 'rule-a', '2026-09-30T00:00:00.000Z', '2026-09-30T00:00:00.000Z', 'completed')"),
    db.prepare("INSERT INTO activity_logs (id, household_id, task_occurrence_id, action, actor_user_id, performed_by_user_id, occurred_at, idempotency_key) VALUES ('log-a', 'household-a', 'occurrence-a', 'completed', 'user-a', 'user-a', '2026-09-30T00:00:00.000Z', 'tax-completed')"),
    db.prepare("INSERT INTO consumables (id, household_id, name) VALUES ('consumable-a', 'household-a', '納付用封筒')"),
    db.prepare("INSERT INTO managed_item_consumables (household_id, managed_item_id, consumable_id) VALUES ('household-a', 'tax-a', 'consumable-a')"),
  ]);

  await applyMigrations(db, ["0015_merge_service_obligation_kinds"]);

  await expect(db.prepare(
    "SELECT code, label FROM managed_item_kinds WHERE is_active = 1 ORDER BY sort_order",
  ).all()).resolves.toMatchObject({
    results: [
      { code: "asset", label: "備品" },
      { code: "service", label: "サービス・契約" },
    ],
  });
  await expect(db.prepare(
    "SELECT is_active FROM managed_item_kinds WHERE code = 'obligation'",
  ).first()).resolves.toMatchObject({ is_active: 0 });
  await expect(db.prepare(
    "SELECT kind_code, sort_order FROM managed_item_type_presets WHERE code = 'property_tax'",
  ).first()).resolves.toMatchObject({ kind_code: "service", sort_order: 30 });
  await expect(db.prepare(
    "SELECT managed_item_id, kind_code, item_type_code, custom_item_type FROM managed_item_classifications ORDER BY managed_item_id",
  ).all()).resolves.toMatchObject({
    results: [
      {
        custom_item_type: "自治体への支払い",
        item_type_code: null,
        kind_code: "service",
        managed_item_id: "custom-a",
      },
      {
        custom_item_type: null,
        item_type_code: "contract",
        kind_code: "service",
        managed_item_id: "service-a",
      },
      {
        custom_item_type: null,
        item_type_code: "property_tax",
        kind_code: "service",
        managed_item_id: "tax-a",
      },
    ],
  });
  await expect(db.prepare(
    "SELECT id, kind FROM managed_items ORDER BY id",
  ).all()).resolves.toMatchObject({
    results: [
      { id: "custom-a", kind: "other" },
      { id: "service-a", kind: "contract" },
      { id: "tax-a", kind: "other" },
    ],
  });
  await expect(db.prepare(
    `SELECT l.id AS link_id, r.id AS rule_id, o.id AS occurrence_id,
            a.id AS log_id, mic.consumable_id
       FROM managed_items m
       JOIN external_links l ON l.managed_item_id = m.id
       JOIN task_rules r ON r.managed_item_id = m.id
       JOIN task_occurrences o ON o.task_rule_id = r.id
       JOIN activity_logs a ON a.task_occurrence_id = o.id
       JOIN managed_item_consumables mic ON mic.managed_item_id = m.id
      WHERE m.id = 'tax-a'`,
  ).first()).resolves.toMatchObject({
    consumable_id: "consumable-a",
    link_id: "link-a",
    log_id: "log-a",
    occurrence_id: "occurrence-a",
    rule_id: "rule-a",
  });
  await expect(db.prepare("PRAGMA foreign_key_check").all()).resolves.toMatchObject({
    results: [],
  });
});
