-- Issue #148: 完了記録の実施日時・実施者を、元のactivity_logs行を書き換えずに
-- 訂正できるようにする。activity_logsのCHECK制約(action列挙)をSQLiteで
-- 安全に拡張する手段がないため、新しいテーブルへ追記型の訂正イベントとして
-- 記録する(YDR-026)。有効な実施日時・実施者は読み取り時にこのテーブルを
-- 相関サブクエリで解決して求める。
CREATE TABLE completion_corrections (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  task_occurrence_id TEXT NOT NULL,
  completed_activity_log_id TEXT NOT NULL REFERENCES activity_logs(id),
  actor_user_id TEXT NOT NULL,
  corrected_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  idempotency_key TEXT,
  previous_occurred_at TEXT NOT NULL,
  new_occurred_at TEXT,
  previous_performed_by_user_id TEXT,
  new_performed_by_user_id TEXT,
  FOREIGN KEY (task_occurrence_id, household_id) REFERENCES task_occurrences(id, household_id) ON DELETE CASCADE,
  FOREIGN KEY (household_id, actor_user_id) REFERENCES household_members(household_id, user_id),
  FOREIGN KEY (household_id, new_performed_by_user_id) REFERENCES household_members(household_id, user_id),
  UNIQUE (household_id, idempotency_key),
  -- 1回の訂正は実施日時・実施者のどちらか一方だけを対象にする(true=1/false=0の
  -- 加算でXORを表す)。
  CHECK (((new_occurred_at IS NOT NULL) + (new_performed_by_user_id IS NOT NULL)) = 1)
);
CREATE INDEX completion_corrections_household_id_idx ON completion_corrections(household_id);
CREATE INDEX completion_corrections_occurrence_idx
  ON completion_corrections(task_occurrence_id, corrected_at DESC, id DESC);
CREATE INDEX completion_corrections_completed_log_idx
  ON completion_corrections(completed_activity_log_id, corrected_at DESC, id DESC);
