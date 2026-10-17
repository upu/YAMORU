import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { applyMigrationsAfter, applyMigrationsThrough } from "./test-support/migrations";

describe("必達日の追加migration", () => {
  it("既存行と旧SQLを保ち、存在する暦日だけを受け付ける", async () => {
    const db = env.DB;
    await applyMigrationsThrough(db, "0029_managed_item_tags");
    await db.batch([
      db.prepare("INSERT INTO users(id,email) VALUES ('a','a@example.com')"),
      db.prepare("INSERT INTO households(id,name) VALUES ('h','H')"),
      db.prepare("INSERT INTO household_members(household_id,user_id) VALUES ('h','a')"),
      db.prepare("INSERT INTO task_rules(id,household_id,title,recurrence_basis,deadline_kind) VALUES ('r','h','Todo','once','strict')"),
      db.prepare("INSERT INTO task_occurrences(id,household_id,task_rule_id,created_at) VALUES ('o','h','r','2026-01-01T00:00:00.000Z')"),
    ]);
    await applyMigrationsAfter(db, "0029_managed_item_tags");
    await expect(db.prepare("SELECT id,created_at,must_complete_by FROM task_occurrences").first())
      .resolves.toEqual({ id: "o", created_at: "2026-01-01T00:00:00.000Z", must_complete_by: null });
    for (const value of ["", "2026-02-29", "2026-02-30", "2026-13-01", "2026-1-01", "2026-01-01T00:00:00Z"]) {
      await expect(db.prepare("UPDATE task_occurrences SET must_complete_by=? WHERE id='o'").bind(value).run()).rejects.toThrow();
    }
    await db.prepare("UPDATE task_occurrences SET must_complete_by='2028-02-29' WHERE id='o'").run();
    await db.prepare("UPDATE task_occurrences SET scheduled_for='2026-10-01T00:00:00.000Z', due_at='2026-10-01T00:00:00.000Z' WHERE id='o'").run();
    await expect(db.prepare("SELECT must_complete_by FROM task_occurrences WHERE id='o'").first())
      .resolves.toEqual({ must_complete_by: "2028-02-29" });
    await expect(db.prepare("PRAGMA foreign_key_check").all()).resolves.toMatchObject({ results: [] });
  });
});
