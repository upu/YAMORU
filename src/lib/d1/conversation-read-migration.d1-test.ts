import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { applyMigrationsThrough, applyMigrationsAfter } from "./test-support/migrations";
import { resetHouseholdFixtures } from "./test-support/households";

it("0030の行を保持し、旧SQL・別名の家庭制約・cascade・rollbackを保証する", async () => {
  const db = env.DB;
  await applyMigrationsThrough(db, "0030_occurrence_hard_deadline");
  await resetHouseholdFixtures(db);
  const original = await db.prepare("SELECT * FROM managed_items WHERE id='item-a'").first();
  await applyMigrationsAfter(db, "0030_occurrence_hard_deadline");
  expect(await db.prepare("SELECT * FROM managed_items WHERE id='item-a'").first()).toEqual(original);
  const version = async () => {
    const row = await db.prepare("SELECT version FROM household_read_versions WHERE household_id='household-a'").first<{ version: number }>();
    if (row === null) throw new Error("Missing version");
    return row.version;
  };
  const initial = await version();
  await db.prepare("UPDATE managed_items SET name='旧SQL更新' WHERE id='item-a'").run();
  expect(await version()).toBeGreaterThan(initial);
  const changed = await version();
  await expect(db.batch([
    db.prepare("UPDATE managed_items SET name='rollback' WHERE id='item-a'"),
    db.prepare("INSERT INTO entity_aliases(id,household_id,managed_item_id,alias) VALUES ('bad','household-a','item-b','他家庭')"),
  ])).rejects.toThrow();
  expect(await version()).toBe(changed);
  expect(await db.prepare("SELECT name FROM managed_items WHERE id='item-a'").first()).toEqual({ name: "旧SQL更新" });
  for (let i = 0; i < 10; i++) {
    await db.prepare("INSERT INTO entity_aliases(id,household_id,managed_item_id,alias) VALUES (?,'household-a','item-a',?)").bind(`a${i}`, `別名${i}`).run();
  }
  await expect(db.prepare("INSERT INTO entity_aliases(id,household_id,managed_item_id,alias) VALUES ('overflow','household-a','item-a','多すぎる')").run()).rejects.toThrow();
  await expect(db.prepare("INSERT INTO entity_aliases(id,household_id,alias) VALUES ('no-target','household-a','対象なし')").run()).rejects.toThrow();
  const beforeDelete = await version();
  await db.prepare("DELETE FROM managed_items WHERE id='item-a'").run();
  expect(await version()).toBeGreaterThan(beforeDelete);
  expect((await db.prepare("SELECT * FROM entity_aliases").all()).results).toEqual([]);
  expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
});
