import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { applyMigrationsAfter, applyMigrationsThrough } from "./test-support/migrations";

// #437: 0038は繰り返し条件・必達日の変更履歴へidempotency_keyを足すだけの
// expand migration。既存の履歴と旧Workerの書き込みを保ち、外部commandのキーが
// 家庭ごとに一意になることを確かめる。
const RULE_CHANGE = `INSERT INTO task_rule_changes(id,household_id,task_rule_id,task_occurrence_id,actor_user_id,previous_rule_snapshot,new_rule_snapshot,changed_at)
  VALUES (?1,?2,?3,?4,?5,'{"title":"前"}','{"title":"後"}','2026-01-02T00:00:00.000Z')`;
const DEADLINE_CHANGE = `INSERT INTO task_deadline_changes(id,household_id,task_occurrence_id,actor_user_id,previous_date,new_date,recorded_at)
  VALUES (?1,?2,?3,?4,NULL,'2026-02-01','2026-01-02T00:00:00.000Z')`;

describe("変更履歴の操作キーのmigration(0038_integration_edit_history_keys)", () => {
  it("既存の履歴と旧Workerの書き込みを保ち、操作キーを家庭ごとに一意にする", async () => {
    const db = env.DB;
    await applyMigrationsThrough(db, "0037_consumable_stock_history");
    await db.batch([
      db.prepare("INSERT INTO users(id,email) VALUES ('a','a@example.com'),('b','b@example.com')"),
      db.prepare("INSERT INTO households(id,name) VALUES ('ha','A'),('hb','B')"),
      db.prepare("INSERT INTO household_members(household_id,user_id) VALUES ('ha','a'),('hb','b')"),
      db.prepare("INSERT INTO task_rules(id,household_id,title,recurrence_basis,deadline_kind) VALUES ('ra','ha','Todo','once','strict'),('rb','hb','Todo','once','strict')"),
      db.prepare("INSERT INTO task_occurrences(id,household_id,task_rule_id) VALUES ('oa','ha','ra'),('ob','hb','rb')"),
      db.prepare(RULE_CHANGE).bind("rc-old", "ha", "ra", "oa", "a"),
      db.prepare(DEADLINE_CHANGE).bind("dc-old", "ha", "oa", "a"),
    ]);
    await applyMigrationsAfter(db, "0037_consumable_stock_history");

    await expect(db.prepare("SELECT id, changed_at, idempotency_key FROM task_rule_changes").first())
      .resolves.toEqual({ changed_at: "2026-01-02T00:00:00.000Z", id: "rc-old", idempotency_key: null });
    await expect(db.prepare("SELECT id, recorded_at, idempotency_key FROM task_deadline_changes").first())
      .resolves.toEqual({ id: "dc-old", idempotency_key: null, recorded_at: "2026-01-02T00:00:00.000Z" });

    // 旧Workerは列を指定せずに書く。キーの無い履歴はいくつでも書ける。
    await db.prepare(RULE_CHANGE).bind("rc-web", "ha", "ra", "oa", "a").run();
    await db.prepare(DEADLINE_CHANGE).bind("dc-web", "ha", "oa", "a").run();

    // 外部commandのキーは家庭ごとに一意。別の家庭なら同じ値でも書ける。
    const keyed = (table: string, id: string, household: string, key: string) => db.prepare(
      `UPDATE ${table} SET idempotency_key = ?3 WHERE id = ?1 AND household_id = ?2`,
    ).bind(id, household, key).run();
    await keyed("task_rule_changes", "rc-old", "ha", "integration:x:rule");
    await expect(keyed("task_rule_changes", "rc-web", "ha", "integration:x:rule")).rejects.toThrow(/UNIQUE/u);
    await db.prepare(RULE_CHANGE).bind("rc-b", "hb", "rb", "ob", "b").run();
    await keyed("task_rule_changes", "rc-b", "hb", "integration:x:rule");
    await keyed("task_deadline_changes", "dc-old", "ha", "integration:x:deadline");
    await expect(keyed("task_deadline_changes", "dc-web", "ha", "integration:x:deadline")).rejects.toThrow(/UNIQUE/u);
    await expect(db.prepare("PRAGMA foreign_key_check").all()).resolves.toMatchObject({ results: [] });
  });
});
