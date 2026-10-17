-- 各回の必達日。予定日・推奨期間から独立した東京の暦日。
ALTER TABLE task_occurrences ADD COLUMN must_complete_by TEXT
  CHECK (must_complete_by IS NULL OR (
    length(must_complete_by) = 10
    AND must_complete_by GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND substr(must_complete_by, 1, 4) >= '0001'
    AND date(must_complete_by, '+0 days') IS must_complete_by
  ));

CREATE INDEX task_occurrences_hard_deadline_idx
  ON task_occurrences(household_id, must_complete_by)
  WHERE status = 'pending' AND must_complete_by IS NOT NULL;

CREATE TABLE task_deadline_changes (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  task_occurrence_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  previous_date TEXT,
  new_date TEXT,
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY(task_occurrence_id, household_id) REFERENCES task_occurrences(id, household_id) ON DELETE CASCADE,
  FOREIGN KEY(household_id, actor_user_id) REFERENCES household_members(household_id, user_id),
  CHECK(previous_date IS NOT new_date)
);
CREATE INDEX task_deadline_changes_occurrence_idx
  ON task_deadline_changes(task_occurrence_id, household_id);

-- 新履歴を知らない旧Workerも、操作済みの次回を削除できない。
CREATE TRIGGER protect_deadline_from_completion_undo
BEFORE INSERT ON activity_logs
WHEN NEW.action = 'completion_undone' AND EXISTS (
  SELECT 1 FROM activity_logs c JOIN task_deadline_changes d
    ON d.task_occurrence_id = c.next_task_occurrence_id AND d.household_id = c.household_id
  WHERE c.task_occurrence_id = NEW.task_occurrence_id AND c.household_id = NEW.household_id
    AND c.action = 'completed'
)
BEGIN
  SELECT RAISE(ABORT, 'NEXT_OCCURRENCE_DEADLINE_MODIFIED');
END;

-- 日付を持つ次回だけが実施日訂正で再計算される。必要時の実施日訂正は妨げない。
CREATE TRIGGER protect_deadline_from_completion_correction
BEFORE INSERT ON completion_corrections
WHEN NEW.new_occurred_at IS NOT NULL AND EXISTS (
  SELECT 1 FROM activity_logs c JOIN task_occurrences n
    ON n.id = c.next_task_occurrence_id AND n.household_id = c.household_id
  JOIN task_deadline_changes d ON d.task_occurrence_id = n.id AND d.household_id = n.household_id
  WHERE c.id = NEW.completed_activity_log_id AND c.household_id = NEW.household_id
    AND n.scheduled_for IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'NEXT_OCCURRENCE_DEADLINE_MODIFIED');
END;
