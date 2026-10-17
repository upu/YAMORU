-- #437: 外部command(todo.update)が書いた繰り返し条件の変更・必達日の変更の
-- 履歴から、受付記録(integration_operations)の接続元を引けるようにする。
-- 担当・期限・完了・訂正の履歴と同じく、操作キー(`<business_key>:rule`・
-- `:deadline`)をidempotency_keyとして残す。Webからの変更はNULLのまま。
--
-- 追加だけのexpand migration。旧Workerは列を指定せずにINSERTするためNULLに
-- なり、読み取りも列を参照しない。新Workerが書いた値は旧Workerの動作に影響
-- しない。既存行は変更しない。
ALTER TABLE task_rule_changes ADD COLUMN idempotency_key TEXT;
ALTER TABLE task_deadline_changes ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX task_rule_changes_idempotency_key_idx
  ON task_rule_changes(household_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX task_deadline_changes_idempotency_key_idx
  ON task_deadline_changes(household_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
