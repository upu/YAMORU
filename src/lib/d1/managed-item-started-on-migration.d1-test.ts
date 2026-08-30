import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

import { applyMigrations, applyMigrationsThrough } from "./test-support/migrations";

const db = env.DB;

// Issue #239: 0011は既存のpurchased_onを書き換えず、started_onへコピーする
// (YDR-033)。分かる精度(年・年月・年月日)それぞれで値が失われないことと、
// 未設定行がNULLのまま残ることを確認する。
it("既存のpurchased_onを書き換えず、同じ値をstarted_onへコピーする(Issue #239)", async () => {
  await applyMigrationsThrough(db, "0008_managed_item_optional_attributes");
  await db.batch([
    db.prepare("INSERT INTO users (id, email) VALUES ('user-a', 'a@example.com')"),
    db.prepare("INSERT INTO households (id, name) VALUES ('household-a', 'Household A')"),
    db.prepare("INSERT INTO household_members (household_id, user_id) VALUES ('household-a', 'user-a')"),
    db.prepare(
      "INSERT INTO managed_items (id, household_id, name, kind, purchased_on) VALUES ('item-year', 'household-a', '年だけの対象', 'other', '2024')",
    ),
    db.prepare(
      "INSERT INTO managed_items (id, household_id, name, kind, purchased_on) VALUES ('item-month', 'household-a', '年月の対象', 'other', '2024-05')",
    ),
    db.prepare(
      "INSERT INTO managed_items (id, household_id, name, kind, purchased_on) VALUES ('item-day', 'household-a', '年月日の対象', 'other', '2024-05-10')",
    ),
    db.prepare(
      "INSERT INTO managed_items (id, household_id, name, kind) VALUES ('item-unset', 'household-a', '未設定の対象', 'other')",
    ),
  ]);

  await applyMigrations(db, ["0011_managed_item_started_on"]);

  const rows = await db.prepare(
    "SELECT id, purchased_on, started_on FROM managed_items ORDER BY id",
  ).all<{ id: string; purchased_on: string | null; started_on: string | null }>();
  expect(rows.results).toEqual([
    { id: "item-day", purchased_on: "2024-05-10", started_on: "2024-05-10" },
    { id: "item-month", purchased_on: "2024-05", started_on: "2024-05" },
    { id: "item-unset", purchased_on: null, started_on: null },
    { id: "item-year", purchased_on: "2024", started_on: "2024" },
  ]);
});
