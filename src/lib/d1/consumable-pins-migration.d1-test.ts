import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

import { applyMigrations, applyMigrationsThrough } from "./test-support/migrations";

const db = env.DB;

it("既存Consumableへ個人別のお気に入りを追加できる(Issue #345)", async () => {
  await applyMigrationsThrough(db, "0024_managed_item_type_suggestions");
  await db.batch([
    db.prepare(
      "INSERT INTO users (id, email) VALUES ('user-a', 'a@example.com'), ('user-a2', 'a2@example.com'), ('user-b', 'b@example.com')",
    ),
    db.prepare(
      "INSERT INTO households (id, name) VALUES ('household-a', 'Household A'), ('household-b', 'Household B')",
    ),
    db.prepare(
      "INSERT INTO household_members (household_id, user_id) VALUES ('household-a', 'user-a'), ('household-a', 'user-a2'), ('household-b', 'user-b')",
    ),
    db.prepare(
      "INSERT INTO consumables (id, household_id, name) VALUES ('eggs', 'household-a', '卵'), ('other-eggs', 'household-b', '別家庭の卵')",
    ),
  ]);

  await applyMigrations(db, ["0025_user_consumable_pins"]);
  await db.batch([
    db.prepare(
      "INSERT INTO user_consumable_pins (user_id, household_id, consumable_id) VALUES ('user-a', 'household-a', 'eggs')",
    ),
    db.prepare(
      "INSERT INTO user_consumable_pins (user_id, household_id, consumable_id) VALUES ('user-a2', 'household-a', 'eggs')",
    ),
  ]);

  await expect(db.prepare(
    "SELECT user_id FROM user_consumable_pins WHERE consumable_id = 'eggs' ORDER BY user_id",
  ).all<{ user_id: string }>()).resolves.toMatchObject({
    results: [{ user_id: "user-a" }, { user_id: "user-a2" }],
  });
  await expect(db.prepare(
    "INSERT INTO user_consumable_pins (user_id, household_id, consumable_id) VALUES ('user-a', 'household-a', 'other-eggs')",
  ).run()).rejects.toThrow();

  await db.prepare("DELETE FROM consumables WHERE id = 'eggs'").run();
  await expect(db.prepare(
    "SELECT count(*) AS count FROM user_consumable_pins",
  ).first<{ count: number }>()).resolves.toEqual({ count: 0 });
});
