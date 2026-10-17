-- Issue #226 / YDR-048: ManagedItemへ複数のタグを付け、大分類(kind)・詳しい
-- 種類(item_type)とは独立した横断的な文脈(子ども、ペット、住まいなど)で
-- まとめられるようにする(YDR-028の役割分離)。
--
-- タグは家庭単位のマスタ(tags)として持ち、ManagedItemとの多対多関連を
-- managed_item_tagsで表す。将来TodoやConsumableへ広げる場合も、tagsはそのまま
-- 使い、対象ごとの関連テーブルを足す。
--
-- 家庭境界: managed_item_tagsはhousehold_idを持ち、ManagedItemとタグの両方へ
-- (id, household_id)の複合外部キーを張る。家庭Aのタグを家庭BのManagedItemへ
-- 関連付ける行は、アプリ層の確認とは別にDBが拒否する。
--
-- タグ名: 前後の空白を落とした1〜30文字。同じ家庭内では英字の大文字小文字
-- だけが違う名前も同じタグとみなす(COLLATE NOCASE)。全角・半角などの
-- 正規化は行わず、入力どおりの表記を保存する。
--
-- ロールアウト: テーブルと索引を足すだけの後方互換なexpand migrationである。
-- migration適用直後の旧Workerは新しいテーブルを読み書きせず、ManagedItemの
-- 登録・編集もこれまでどおり動く。新Workerから旧Workerへ戻しても、付与済み
-- タグが表示されなくなるだけで、ManagedItemの編集で消えることはない
-- (旧Workerはmanaged_item_tagsへ触れない)。削除すべき旧構造・同期処理・
-- 暫定制約を残さないため、後続のcontract migrationはない。

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (id, household_id),
  UNIQUE (household_id, name),
  CHECK (name = trim(name) AND length(name) BETWEEN 1 AND 30)
);

CREATE TABLE managed_item_tags (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  managed_item_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (managed_item_id, tag_id),
  FOREIGN KEY (managed_item_id, household_id)
    REFERENCES managed_items(id, household_id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id, household_id)
    REFERENCES tags(id, household_id) ON DELETE CASCADE
);

-- 一つのタグが付いたManagedItemを家庭内でたどる(将来の絞り込み、#218)ための索引。
CREATE INDEX managed_item_tags_household_tag_idx
  ON managed_item_tags(household_id, tag_id);
