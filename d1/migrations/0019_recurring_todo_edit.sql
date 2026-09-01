-- Issue #265 / YDR-039: TaskRuleを後から編集しても、既に発生したOccurrenceの
-- 名前・関連する管理対象・繰り返し条件を当時の値で表示できるようにする。
-- SQLiteのALTER TABLEで既存行を参照するDEFAULTは指定できないため、いったん
-- 空のJSONを既定値として列を追加し、現在のTaskRuleから全既存行をbackfillする。

ALTER TABLE task_occurrences
ADD COLUMN rule_snapshot TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(rule_snapshot));

UPDATE task_occurrences
   SET rule_snapshot = (
     SELECT json_object(
       'title', r.title,
       'managedItemId', r.managed_item_id,
       'managedItemName', i.name,
       'recurrenceBasis', r.recurrence_basis,
       'deadlineKind', r.deadline_kind,
       'recommendedStartOffset', r.recommended_start_offset,
       'recommendedUntilOffset', r.recommended_until_offset,
       'recommendedStartValue', r.recommended_start_value,
       'recommendedUntilValue', r.recommended_until_value,
       'recommendedUnit', r.recommended_unit,
       'scheduleKind', r.schedule_kind,
       'scheduleDayOfWeek', r.schedule_day_of_week,
       'scheduleDayOfMonth', r.schedule_day_of_month,
       'scheduleWeekOfMonth', r.schedule_week_of_month,
       'scheduleMonth', r.schedule_month,
       'scheduleMonthEnd', r.schedule_month_end,
       'intervalUnit', r.interval_unit,
       'intervalCount', r.interval_count,
       'intervalAnchorOn', r.interval_anchor_on
     )
       FROM task_rules r
       LEFT JOIN managed_items i
         ON i.id = r.managed_item_id AND i.household_id = r.household_id
      WHERE r.id = task_occurrences.task_rule_id
        AND r.household_id = task_occurrences.household_id
   );

-- ルール編集はActivityLogのOccurrence操作とは別の履歴として追記する。
-- 完了取消・実施日訂正は、この表に対象の次回Occurrenceの変更があれば拒否し、
-- 編集済みの次回を削除・再計算しない。
CREATE TABLE task_rule_changes (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  task_rule_id TEXT NOT NULL,
  task_occurrence_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  previous_rule_snapshot TEXT NOT NULL CHECK (json_valid(previous_rule_snapshot)),
  new_rule_snapshot TEXT NOT NULL CHECK (json_valid(new_rule_snapshot)),
  changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (task_rule_id, household_id)
    REFERENCES task_rules(id, household_id) ON DELETE CASCADE,
  FOREIGN KEY (task_occurrence_id, household_id)
    REFERENCES task_occurrences(id, household_id) ON DELETE CASCADE,
  FOREIGN KEY (household_id, actor_user_id)
    REFERENCES household_members(household_id, user_id)
);

CREATE INDEX task_rule_changes_household_id_idx
  ON task_rule_changes(household_id);
CREATE INDEX task_rule_changes_occurrence_idx
  ON task_rule_changes(task_occurrence_id, changed_at, id);
