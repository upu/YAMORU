-- Issue #332: 「詳しい種類」のAI提案と、その提案が画面に出ている状態で最終的に
-- 採用された種類を、家庭単位で記録する。次回の提案でこの履歴を文脈として使う。
--
-- 1行 = 1回の提案要求。利用者が💡を押した時点で作られ、そのまま登録・編集が
-- 完了したときだけ採用結果(adopted_label / adoption_kind)が追記される。
--
-- adoption_kindの意味(issue本文の「採用結果からのフィードバック」の表):
--   'ai_suggestion' … 提案した候補がそのまま採用された(強い肯定)
--   'corrected'     … 提案とは別の種類(既存の種類・自由入力)が採用された(強い修正)
--   NULL            … 採用結果を記録していない。候補を閉じただけ、詳しい種類を
--                     指定せず登録した、登録自体をやめた、のいずれか。
-- NULLを「否定」として読まないことがこの設計の要点で、履歴を読む側
-- (listHouseholdItemTypeAdoptions)はadoption_kindがNULLでない行だけを使う。
--
-- 家庭間分離は他のテーブルと同じくhousehold_idとアプリ層で守る(YDR-022)。
-- 提案文脈(item_name)は家庭の実データなので、家庭を跨いで読まない。
CREATE TABLE managed_item_type_suggestions (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  -- 提案を求めたときに選択されていた大分類。次回提案では同じ大分類の履歴
  -- だけを使う(プリセットの詳しい種類が大分類で絞られるのと同じ見え方)。
  kind_code TEXT NOT NULL,
  -- 提案の手がかりにした、入力中の管理対象名。AIへ送ったのと同じ最小限の
  -- 文脈だけを残し、メモや外部リンクは保存しない。
  item_name TEXT NOT NULL,
  -- 実際に画面へ出した候補のJSON配列(文字列の配列)。採用・修正の判定は
  -- この配列との突き合わせで行う。
  suggested_labels TEXT NOT NULL,
  adopted_label TEXT,
  adoption_kind TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  adopted_at TEXT,
  UNIQUE (id, household_id),
  CHECK (adoption_kind IS NULL OR adoption_kind IN ('ai_suggestion', 'corrected')),
  -- 採用結果は3列そろって入るか、3列とも入らないかのどちらかにする。
  -- 「採用された種類が分からないのに採用済み」という中途半端な行を作らない。
  CHECK ((adoption_kind IS NULL) = (adopted_label IS NULL)),
  CHECK ((adoption_kind IS NULL) = (adopted_at IS NULL))
);

-- 次回提案の文脈読み出し(家庭・大分類ごとに、採用済みを新しい順)に合わせる。
CREATE INDEX managed_item_type_suggestions_adopted_idx
  ON managed_item_type_suggestions (household_id, kind_code, adopted_at);
