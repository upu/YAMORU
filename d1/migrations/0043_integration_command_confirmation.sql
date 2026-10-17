-- #437 / YDR-062: 外部commandの追加確認(confirmation_url)。古いpreviewを
-- 作り直した結果、利用者が同意した内容から意味のある差分が出た操作だけ、
-- 本人の確認画面での承認を必須にする。
--
-- 追加だけのexpand migration。既存行は「確認不要」のまま変えない。旧Workerは
-- 新しい列を書かずにINSERTするため既定値(確認不要)になり、これまでどおり動く。
-- 旧Workerへ戻した期間に確認必須の操作が残っていても、下のtriggerが承認の
-- 無い成功を拒否する。contract migrationは不要(列とtriggerを残す)。

-- 何に対する操作か。対象を持つcommandは対象、登録系は正規化payloadから作る。
-- 同じ本人・家庭・subject_keyの最新の記録から、staleな操作と作り直しの対応を
-- サーバー側で追跡する(操作IDや接続を変えても回避できない)。
ALTER TABLE integration_operations ADD COLUMN subject_key TEXT;
-- previewのうち利用者にとって意味のある内容(対象・差分・次回への影響)の指紋。
-- revisionを表す値は含めない。
ALTER TABLE integration_operations ADD COLUMN meaningful_digest TEXT;
-- 作り直した元の記録と、利用者が最後に同意した内容の記録(比較の基準)。
ALTER TABLE integration_operations ADD COLUMN supersedes_operation_id TEXT
  REFERENCES integration_operations(id) ON DELETE SET NULL;
ALTER TABLE integration_operations ADD COLUMN baseline_operation_id TEXT
  REFERENCES integration_operations(id) ON DELETE SET NULL;
ALTER TABLE integration_operations ADD COLUMN confirmation_state TEXT NOT NULL DEFAULT 'not_needed'
  CHECK (confirmation_state IN ('not_needed', 'required'));
ALTER TABLE integration_operations ADD COLUMN confirmation_reason_codes TEXT
  CHECK (confirmation_reason_codes IS NULL OR json_valid(confirmation_reason_codes));
-- 確認必須の操作だけが持つ。承認・拒否は本人の確認画面だけが記録する。
ALTER TABLE integration_operations ADD COLUMN confirmation_status TEXT
  CHECK (confirmation_status IS NULL OR confirmation_status IN ('pending', 'approved', 'denied'));
ALTER TABLE integration_operations ADD COLUMN confirmation_decided_at TEXT;

CREATE INDEX integration_operations_subject_idx
  ON integration_operations(household_id, user_id, subject_key, created_at DESC)
  WHERE subject_key IS NOT NULL;

CREATE TRIGGER integration_operations_confirmation_state_guard
BEFORE INSERT ON integration_operations
WHEN (NEW.confirmation_state = 'required') <> (NEW.confirmation_status IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'confirmation_status requires confirmation_state = required');
END;

-- 確認必須の操作は、承認されていなければ成功にできない。Workerの版に
-- かかわらずDBで守る。
CREATE TRIGGER integration_operations_confirmation_commit_guard
BEFORE UPDATE OF status ON integration_operations
WHEN NEW.status = 'succeeded' AND OLD.confirmation_state = 'required'
  AND OLD.confirmation_status IS NOT 'approved'
BEGIN
  SELECT RAISE(ABORT, 'confirmation required');
END;

-- 確認の状態は確認必須の操作でだけ、未確定の間に一度だけ決める。
CREATE TRIGGER integration_operations_confirmation_decision_guard
BEFORE UPDATE OF confirmation_status ON integration_operations
WHEN OLD.confirmation_state <> 'required'
  OR OLD.confirmation_status IS NOT 'pending'
  OR NEW.confirmation_status NOT IN ('approved', 'denied')
BEGIN
  SELECT RAISE(ABORT, 'invalid confirmation decision');
END;
