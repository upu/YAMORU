import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

import { applyMigrations, applyMigrationsThrough } from "./test-support/migrations";

const db = env.DB;

it("既存の消耗品を保ったまま追記型の補充履歴を追加する(Issue #310)", async () => {
  await applyMigrationsThrough(db, "0019_recurring_todo_edit");
  await db.batch([
    db.prepare("INSERT INTO users (id, email) VALUES ('user-a', 'a@example.com')"),
    db.prepare("INSERT INTO households (id, name) VALUES ('household-a', 'Household A')"),
    db.prepare("INSERT INTO household_members (household_id, user_id) VALUES ('household-a', 'user-a')"),
    db.prepare("INSERT INTO consumables (id, household_id, name, stock_status) VALUES ('consumable-a', 'household-a', '洗剤', 'low')"),
  ]);

  await applyMigrations(db, ["0020_consumable_refills"]);

  await expect(db.prepare(
    "SELECT name, stock_status FROM consumables WHERE id = 'consumable-a'",
  ).first()).resolves.toEqual({ name: "洗剤", stock_status: "low" });
  await expect(db.prepare(
    `INSERT INTO consumable_refills (
      id, household_id, consumable_id, refilled_on
    ) VALUES ('invalid-date', 'household-a', 'consumable-a', '2026-02-30')`,
  ).run()).rejects.toThrow();
  await expect(db.prepare("PRAGMA foreign_key_check").all())
    .resolves.toMatchObject({ results: [] });
});
