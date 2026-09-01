-- Issue #48 / YDR-038: 完了日基準Todoの推奨期間へ、入力した値と単位を
-- 失わない列をexpand-firstで追加する。既存のrecommended_*_offsetは旧Workerと
-- 既存行の日数計算のために残し、新Workerは追加列が3つそろう行でそちらを正にする。

ALTER TABLE task_rules ADD COLUMN recommended_start_value INTEGER;
ALTER TABLE task_rules ADD COLUMN recommended_until_value INTEGER;
ALTER TABLE task_rules ADD COLUMN recommended_unit TEXT;

-- 適用直後も旧Workerが完了日基準Todoを登録できるよう、追加列がすべてNULLの
-- legacy行は許可する。値を持つ場合は3列を必ずそろえ、約10年の単位別上限と
-- start <= untilをDBでも守る。完了日基準以外への越境は拒否する。
CREATE TRIGGER task_rules_completion_interval_insert
BEFORE INSERT ON task_rules
WHEN NOT (
  (NEW.recurrence_basis = 'completion' AND (
    (NEW.recommended_start_value IS NULL
      AND NEW.recommended_until_value IS NULL
      AND NEW.recommended_unit IS NULL)
    OR
    (NEW.recommended_start_value IS NOT NULL
      AND NEW.recommended_until_value IS NOT NULL
      AND NEW.recommended_unit IN ('day', 'week', 'month', 'year')
      AND NEW.recommended_start_value = CAST(NEW.recommended_start_value AS INTEGER)
      AND NEW.recommended_until_value = CAST(NEW.recommended_until_value AS INTEGER)
      AND NEW.recommended_start_value BETWEEN 0 AND NEW.recommended_until_value
      AND NEW.recommended_until_value <= CASE NEW.recommended_unit
        WHEN 'day' THEN 3650
        WHEN 'week' THEN 520
        WHEN 'month' THEN 120
        WHEN 'year' THEN 10
      END)
  ))
  OR
  (NEW.recurrence_basis <> 'completion'
    AND NEW.recommended_start_value IS NULL
    AND NEW.recommended_until_value IS NULL
    AND NEW.recommended_unit IS NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'invalid completion calendar interval');
END;

CREATE TRIGGER task_rules_completion_interval_update
BEFORE UPDATE OF recurrence_basis, recommended_start_value, recommended_until_value, recommended_unit
ON task_rules
WHEN NOT (
  (NEW.recurrence_basis = 'completion' AND (
    (NEW.recommended_start_value IS NULL
      AND NEW.recommended_until_value IS NULL
      AND NEW.recommended_unit IS NULL)
    OR
    (NEW.recommended_start_value IS NOT NULL
      AND NEW.recommended_until_value IS NOT NULL
      AND NEW.recommended_unit IN ('day', 'week', 'month', 'year')
      AND NEW.recommended_start_value = CAST(NEW.recommended_start_value AS INTEGER)
      AND NEW.recommended_until_value = CAST(NEW.recommended_until_value AS INTEGER)
      AND NEW.recommended_start_value BETWEEN 0 AND NEW.recommended_until_value
      AND NEW.recommended_until_value <= CASE NEW.recommended_unit
        WHEN 'day' THEN 3650
        WHEN 'week' THEN 520
        WHEN 'month' THEN 120
        WHEN 'year' THEN 10
      END)
  ))
  OR
  (NEW.recurrence_basis <> 'completion'
    AND NEW.recommended_start_value IS NULL
    AND NEW.recommended_until_value IS NULL
    AND NEW.recommended_unit IS NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'invalid completion calendar interval');
END;
