-- Issue #48 / YDR-038: 月・年単位を理解しない旧Workerが、ロールバックや
-- version skew中に旧日数列だけで次回Occurrenceを作ることを防ぐ。
-- 新Workerは月・年ルールから作るOccurrenceへversion=1を明示する。

ALTER TABLE task_occurrences
  ADD COLUMN completion_calendar_version INTEGER
  CHECK (completion_calendar_version IS NULL OR completion_calendar_version = 1);

CREATE TRIGGER task_occurrences_completion_calendar_insert
BEFORE INSERT ON task_occurrences
FOR EACH ROW
WHEN NEW.completion_calendar_version IS NOT 1
  AND EXISTS (
    SELECT 1
      FROM task_rules r
     WHERE r.id = NEW.task_rule_id
       AND r.household_id = NEW.household_id
       AND r.recurrence_basis = 'completion'
       AND r.recommended_unit IN ('month', 'year')
  )
BEGIN
  SELECT RAISE(ABORT, 'calendar-aware Worker is required for month/year completion recurrence');
END;
