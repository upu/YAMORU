import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

import { applyMigrations, applyMigrationsThrough } from "./test-support/migrations";

const db = env.DB;

it("0025の既存データと登録日時を0026のピン留めへ引き継ぐ(Issue #375)", async () => {
  await applyMigrationsThrough(db, "0025_user_consumable_favorites");
  await db.batch([
    db.prepare("INSERT INTO users (id, email) VALUES ('user-a', 'a@example.com')"),
    db.prepare("INSERT INTO households (id, name) VALUES ('household-a', 'Household A')"),
    db.prepare(
      "INSERT INTO household_members (household_id, user_id) VALUES ('household-a', 'user-a')",
    ),
    db.prepare(
      "INSERT INTO consumables (id, household_id, name) VALUES ('eggs', 'household-a', '卵')",
    ),
    db.prepare(
      `INSERT INTO user_consumable_favorites (
        user_id, household_id, consumable_id, favorited_at
      ) VALUES ('user-a', 'household-a', 'eggs', '2026-09-07T12:34:56.000Z')`,
    ),
  ]);

  await applyMigrations(db, ["0026_user_consumable_pins"]);

  await expect(db.prepare(
    "SELECT user_id, household_id, consumable_id, pinned_at FROM user_consumable_pins",
  ).all()).resolves.toMatchObject({
    results: [{
      consumable_id: "eggs",
      household_id: "household-a",
      pinned_at: "2026-09-07T12:34:56.000Z",
      user_id: "user-a",
    }],
  });
  await expect(db.prepare(
    "SELECT count(*) AS count FROM user_consumable_favorites",
  ).first()).rejects.toThrow();

  await db.prepare("DELETE FROM consumables WHERE id = 'eggs'").run();
  await expect(db.prepare(
    "SELECT count(*) AS count FROM user_consumable_pins",
  ).first<{ count: number }>()).resolves.toEqual({ count: 0 });
});
