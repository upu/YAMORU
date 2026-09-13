-- Issue #329 / YDR-047: Todoへ任意のメモ(手順・注意点)を持たせる。
--
-- メモは「今回だけの記録」ではなく「このTodoを実施するときに毎回参照する
-- 情報」なので、Occurrenceではなくtask_rulesへ1列として持つ。繰り返しTodoでは
-- 次のOccurrenceも同じTaskRuleを参照するため、引き継ぎのためのコピーはいらない。
--
-- 列の追加だけなので、0018と同じくALTER TABLE ADD COLUMNで足す(CHECK制約付き
-- の列追加はSQLiteで許されている)。既存行はNULL、つまり「メモ未設定」になる。
--
-- ロールアウト: 追加は後方互換なexpand migrationである。migration適用直後の
-- 旧Workerはこの列を読まず、INSERTでも指定しないためNULLのまま挿入でき、
-- これまでと同じ読み書きを続けられる。新Workerを出した後に旧Workerへ戻して
-- も、保存済みのメモが読まれなくなるだけで、他の操作は壊れない。削除すべき
-- 旧構造・同期処理・暫定制約を残さないため、後続のcontract migrationはない。
--
-- 上限1000文字はsrc/app/todos/todo-input-limits.tsのTASK_NOTE_MAX_LENGTHと
-- 同じ値。空文字は「メモ未設定」と区別できないため保存させず、アプリ側が
-- 前後の空白を落としたうえでNULLへ寄せる。

ALTER TABLE task_rules
  ADD COLUMN note TEXT
  CHECK (note IS NULL OR (length(note) BETWEEN 1 AND 1000));
