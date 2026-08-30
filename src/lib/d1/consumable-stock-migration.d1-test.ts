import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

import { applyMigrations, applyMigrationsThrough } from "./test-support/migrations";

const db = env.DB;

it("#44で登録済みの消耗品を「ある」として移行する(Issue #284)", async () => {
  await applyMigrationsThrough(db, "0012_consumables");
  await db.batch([
    db.prepare("INSERT INTO users (id, email) VALUES ('user-a', 'a@example.com')"),
    db.prepare("INSERT INTO households (id, name) VALUES ('household-a', 'Household A')"),
    db.prepare(
      "INSERT INTO household_members (household_id, user_id) VALUES ('household-a', 'user-a')",
    ),
    db.prepare(
      "INSERT INTO consumables (id, household_id, name) VALUES ('paper', 'household-a', 'トイレットペーパー')",
    ),
  ]);

  await applyMigrations(db, ["0013_consumable_stock_status"]);

  await expect(db.prepare(
    "SELECT stock_status FROM consumables WHERE id = 'paper'",
  ).first<{ stock_status: string }>()).resolves.toEqual({ stock_status: "available" });
});
