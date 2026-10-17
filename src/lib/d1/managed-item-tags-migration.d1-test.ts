// Issue #226 / YDR-048: 0029はtagsとmanaged_item_tagsを足すだけのexpand
// migration。既存のManagedItemと関連行を保つこと、旧Workerの書き込みが
// そのまま通ること、家庭境界と名前の一意性をDBが守ることを確かめる。
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import { applyMigrations, applyMigrationsThrough } from "./test-support/migrations";

const db = env.DB;

// 同じファイル内のテストはD1を共有するため、0028までの既存データを入れて
// 0029を当てる準備は一度だけ行い、各テストは別々の行を使う。
beforeAll(async () => {
  await applyMigrationsThrough(db, "0028_task_rule_note");
  await db.batch([
    db.prepare("INSERT INTO users (id, email) VALUES ('user-a', 'a@example.com'), ('user-b', 'b@example.com')"),
    db.prepare("INSERT INTO households (id, name) VALUES ('household-a', 'Household A'), ('household-b', 'Household B')"),
    db.prepare("INSERT INTO household_members (household_id, user_id) VALUES ('household-a', 'user-a'), ('household-b', 'user-b')"),
    db.prepare(`INSERT INTO managed_items (id, household_id, name, kind, created_at)
      VALUES ('item-a', 'household-a', 'Legacy A', 'appliance', '2026-01-02T03:04:05.000Z'),
             ('item-b', 'household-b', 'Legacy B', 'appliance', '2026-01-02T03:04:05.000Z')`),
    db.prepare(`INSERT INTO managed_item_classifications (managed_item_id, household_id, kind_code, item_type_code)
      VALUES ('item-a', 'household-a', 'asset', 'appliance')`),
    db.prepare(`INSERT INTO external_links (id, household_id, managed_item_id, url)
      VALUES ('link-a', 'household-a', 'item-a', 'https://example.com/a')`),
  ]);
  await applyMigrations(db, ["0029_managed_item_tags"]);
});

describe("ManagedItemのタグのmigration(0029_managed_item_tags)", () => {
  it("既存のManagedItem・分類・外部リンクを保ったままタグのテーブルを足す", async () => {
    await expect(db.prepare(
      "SELECT id, name, kind, created_at FROM managed_items WHERE id = 'item-a'",
    ).first()).resolves.toEqual({
      created_at: "2026-01-02T03:04:05.000Z",
      id: "item-a",
      kind: "appliance",
      name: "Legacy A",
    });
    await expect(db.prepare(
      "SELECT kind_code, item_type_code FROM managed_item_classifications WHERE managed_item_id = 'item-a'",
    ).first()).resolves.toEqual({ item_type_code: "appliance", kind_code: "asset" });
    await expect(db.prepare(
      "SELECT url FROM external_links WHERE id = 'link-a'",
    ).first()).resolves.toEqual({ url: "https://example.com/a" });
    // 既存行にタグは自動で付かない(タグなし)。
    await expect(db.prepare("SELECT count(*) AS count FROM managed_item_tags").first())
      .resolves.toEqual({ count: 0 });
    await expect(db.prepare("PRAGMA foreign_key_check").all())
      .resolves.toMatchObject({ results: [] });

    // 適用直後も、旧Workerが使うManagedItemの書き込みはそのまま通る。
    await db.batch([
      db.prepare("UPDATE managed_items SET name = 'Renamed by old worker' WHERE id = 'item-a' AND household_id = 'household-a'"),
      db.prepare("INSERT INTO managed_items (id, household_id, name, kind) VALUES ('item-old', 'household-a', 'New by old worker', 'other')"),
    ]);
  });

  it("タグ名は家庭内で一意(英字の大文字小文字を区別しない)、他家庭とは重複してよい", async () => {

    await db.prepare(
      "INSERT INTO tags (id, household_id, name) VALUES ('tag-a', 'household-a', 'Pet')",
    ).run();
    await expect(db.prepare(
      "INSERT INTO tags (id, household_id, name) VALUES ('tag-a-dup', 'household-a', 'pet')",
    ).run()).rejects.toThrow();
    await expect(db.prepare(
      "INSERT INTO tags (id, household_id, name) VALUES ('tag-b', 'household-b', 'Pet')",
    ).run()).resolves.toBeDefined();

    // 空文字、前後の空白、上限超過はDB側でも拒否する。
    for (const name of ["", " 子どもA", "あ".repeat(31)]) {
      await expect(db.prepare(
        "INSERT INTO tags (id, household_id, name) VALUES ('tag-invalid', 'household-a', ?1)",
      ).bind(name).run()).rejects.toThrow();
    }
    await expect(db.prepare(
      "INSERT INTO tags (id, household_id, name) VALUES ('tag-max', 'household-a', ?1)",
    ).bind("あ".repeat(30)).run()).resolves.toBeDefined();
  });

  it("家庭Aのタグを家庭BのManagedItemへ関連付ける行を複合外部キーが拒否する", async () => {
    await db.prepare(
      "INSERT INTO tags (id, household_id, name) VALUES ('tag-child', 'household-a', '子どもA')",
    ).run();

    await expect(db.prepare(
      "INSERT INTO managed_item_tags (household_id, managed_item_id, tag_id) VALUES ('household-b', 'item-b', 'tag-child')",
    ).run()).rejects.toThrow();
    await expect(db.prepare(
      "INSERT INTO managed_item_tags (household_id, managed_item_id, tag_id) VALUES ('household-a', 'item-b', 'tag-child')",
    ).run()).rejects.toThrow();
    await expect(db.prepare(
      "INSERT INTO managed_item_tags (household_id, managed_item_id, tag_id) VALUES ('household-a', 'item-a', 'tag-child')",
    ).run()).resolves.toBeDefined();
  });

  it("ManagedItemやタグを消すと関連だけが消え、残る側は保たれる", async () => {
    await db.batch([
      db.prepare("INSERT INTO managed_items (id, household_id, name, kind) VALUES ('item-a2', 'household-a', 'Second', 'other')"),
      db.prepare("INSERT INTO tags (id, household_id, name) VALUES ('tag-c', 'household-a', '子どもC'), ('tag-c2', 'household-a', '住まい')"),
      db.prepare(`INSERT INTO managed_item_tags (household_id, managed_item_id, tag_id)
        VALUES ('household-a', 'item-old', 'tag-c'), ('household-a', 'item-a2', 'tag-c'), ('household-a', 'item-a2', 'tag-c2')`),
    ]);

    const relationsSql = `SELECT managed_item_id, tag_id FROM managed_item_tags
      WHERE tag_id IN ('tag-c', 'tag-c2') ORDER BY managed_item_id, tag_id`;
    await db.prepare("DELETE FROM managed_items WHERE id = 'item-old'").run();
    await expect(db.prepare(relationsSql).all()).resolves.toMatchObject({
      results: [
        { managed_item_id: "item-a2", tag_id: "tag-c" },
        { managed_item_id: "item-a2", tag_id: "tag-c2" },
      ],
    });

    await db.prepare("DELETE FROM tags WHERE id = 'tag-c2'").run();
    await expect(db.prepare(relationsSql).all()).resolves.toMatchObject({
      results: [{ managed_item_id: "item-a2", tag_id: "tag-c" }],
    });
    await expect(db.prepare("SELECT name FROM managed_items WHERE id = 'item-a2'").first())
      .resolves.toEqual({ name: "Second" });
  });
});
