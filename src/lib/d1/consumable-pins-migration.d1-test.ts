import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

import { applyMigrations, applyMigrationsThrough } from "./test-support/migrations";

const db = env.DB;

it("0025の既存データを引き継ぎ、新旧Workerの書き込みを同期する(Issue #375)", async () => {
  await applyMigrationsThrough(db, "0025_user_consumable_favorites");
  await db.batch([
    db.prepare("INSERT INTO users (id, email) VALUES ('user-a', 'a@example.com')"),
    db.prepare("INSERT INTO households (id, name) VALUES ('household-a', 'Household A')"),
    db.prepare(
      "INSERT INTO household_members (household_id, user_id) VALUES ('household-a', 'user-a')",
    ),
    db.prepare(
      `INSERT INTO consumables (id, household_id, name) VALUES
        ('eggs', 'household-a', '卵'),
        ('paper', 'household-a', 'トイレットペーパー'),
        ('soap', 'household-a', '洗剤')`,
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
  await db.prepare(
    `INSERT INTO user_consumable_favorites (
      user_id, household_id, consumable_id, favorited_at
    ) VALUES ('user-a', 'household-a', 'paper', '2026-09-08T01:02:03.000Z')`,
  ).run();
  await expect(db.prepare(
    "SELECT pinned_at FROM user_consumable_pins WHERE consumable_id = 'paper'",
  ).first()).resolves.toEqual({ pinned_at: "2026-09-08T01:02:03.000Z" });

  await db.prepare(
    `INSERT INTO user_consumable_pins (
      user_id, household_id, consumable_id, pinned_at
    ) VALUES ('user-a', 'household-a', 'soap', '2026-09-09T04:05:06.000Z')`,
  ).run();
  await expect(db.prepare(
    "SELECT favorited_at FROM user_consumable_favorites WHERE consumable_id = 'soap'",
  ).first()).resolves.toEqual({ favorited_at: "2026-09-09T04:05:06.000Z" });

  await db.prepare(
    "DELETE FROM user_consumable_favorites WHERE consumable_id = 'paper'",
  ).run();
  await expect(db.prepare(
    "SELECT count(*) AS count FROM user_consumable_pins WHERE consumable_id = 'paper'",
  ).first<{ count: number }>()).resolves.toEqual({ count: 0 });

  await db.prepare(
    "DELETE FROM user_consumable_pins WHERE consumable_id = 'soap'",
  ).run();
  await expect(db.prepare(
    "SELECT count(*) AS count FROM user_consumable_favorites WHERE consumable_id = 'soap'",
  ).first<{ count: number }>()).resolves.toEqual({ count: 0 });

  await db.prepare("DELETE FROM consumables WHERE id = 'eggs'").run();
  await expect(db.prepare(
    "SELECT count(*) AS count FROM user_consumable_pins",
  ).first<{ count: number }>()).resolves.toEqual({ count: 0 });
});
