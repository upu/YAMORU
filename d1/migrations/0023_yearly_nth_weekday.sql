-- Issue #101 / YDR-040の3・8: 「毎年11月の第3木曜」「毎年5月の最終月曜」を
-- 表す候補指定の種類yearly_nth_weekdayを追加する。
--
-- task_rulesのschedule_kindはrecurrence_basisごとの複合CHECK制約で列挙されて
-- おり、SQLiteではCHECK制約の列挙をALTER TABLEで拡張できない(0016と同じ理由)。
-- そのため0016と同じ手順でtask_rulesを再作成する。task_rulesを削除すると
-- ON DELETE CASCADEが子へ波及するため(D1はforeign_keys = 1)、子孫テーブル
-- (task_occurrences、activity_logs、completion_corrections、
-- task_rule_consumables、task_rule_changes、task_rule_schedules)も同じ順序で
-- 作り直し、既存データ・外部キー・制約・索引・トリガーを保持する。
--
-- 0021が次の再作成へ持ち越した二つを、この再作成でまとめて入れる。
--   1. task_rulesへUNIQUE (id, schedule_kind)を足す
--   2. task_rule_schedulesの親子の種類の一致を、TRIGGERではなく複合外部キー
--      (task_rule_id, schedule_kind)で守る(YDR-040の8)
-- schedule_kindが非NULLになるのはrecurrence_basis = 'calendar'の行だけなので
-- (task_rulesのCHECK制約)、この外部キーは種類の一致と「定例日基準の親を持つ」
-- ことの両方を含む。0021・0022のkind一致TRIGGERは外部キーへ置き換えて落とす。
--
-- 0021が予告したschedule_*列の削除は、この再作成では行わない。production
-- migrationは新Workerより先に適用するため、現在稼働中のWorkerが読む列を
-- 同時に消せない(database-change-playbook.mdのexpand-first)。列の削除は
-- 新Workerがproductionへ出た後の別migrationで行う。

CREATE TABLE task_rules_new (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  managed_item_id TEXT REFERENCES managed_items(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  recurrence_basis TEXT NOT NULL,
  deadline_kind TEXT NOT NULL,
  unresolved_policy TEXT NOT NULL DEFAULT 'carry_over',
  recommended_start_offset INTEGER NOT NULL DEFAULT 0,
  recommended_until_offset INTEGER NOT NULL DEFAULT 0,
  schedule_kind TEXT,
  schedule_day_of_week INTEGER,
  schedule_day_of_month INTEGER,
  schedule_week_of_month INTEGER,
  schedule_month INTEGER,
  schedule_month_end INTEGER NOT NULL DEFAULT 0,
  interval_unit TEXT,
  interval_count INTEGER,
  interval_anchor_on TEXT,
  recommended_start_value INTEGER,
  recommended_until_value INTEGER,
  recommended_unit TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (id, household_id),
  UNIQUE (id, schedule_kind),
  FOREIGN KEY (managed_item_id, household_id) REFERENCES managed_items(id, household_id) ON DELETE CASCADE,
  CHECK (title = trim(title) AND length(title) BETWEEN 1 AND 100),
  CHECK (recurrence_basis IN ('completion', 'once', 'calendar', 'interval')),
  CHECK (deadline_kind IN ('maintenance', 'strict')),
  CHECK (unresolved_policy = 'carry_over'),
  CHECK (schedule_month_end IN (0, 1)),
  CHECK (recommended_start_offset BETWEEN 0 AND 3650 AND recommended_until_offset BETWEEN recommended_start_offset AND 3650),
  CHECK ((recurrence_basis = 'interval') = (interval_unit IS NOT NULL)
    AND (recurrence_basis = 'interval') = (interval_count IS NOT NULL)
    AND (recurrence_basis = 'interval') = (interval_anchor_on IS NOT NULL)),
  CHECK ((recurrence_basis = 'completion' AND deadline_kind = 'maintenance' AND schedule_kind IS NULL)
    OR (recurrence_basis = 'once' AND deadline_kind = 'strict' AND recommended_start_offset = 0 AND recommended_until_offset = 0 AND schedule_kind IS NULL)
    OR (recurrence_basis = 'calendar' AND deadline_kind = 'strict' AND recommended_start_offset = 0 AND recommended_until_offset = 0
      AND ((schedule_kind = 'weekly' AND schedule_day_of_week BETWEEN 1 AND 7 AND schedule_day_of_month IS NULL AND schedule_week_of_month IS NULL AND schedule_month IS NULL)
        OR (schedule_kind = 'monthly_day' AND schedule_day_of_week IS NULL AND schedule_day_of_month BETWEEN 1 AND 31 AND schedule_week_of_month IS NULL AND schedule_month IS NULL)
        OR (schedule_kind = 'monthly_nth_weekday' AND schedule_day_of_week BETWEEN 1 AND 7 AND schedule_day_of_month IS NULL AND schedule_week_of_month BETWEEN 1 AND 5 AND schedule_month IS NULL)
        OR (schedule_kind = 'yearly' AND schedule_day_of_week IS NULL AND schedule_day_of_month BETWEEN 1 AND 31 AND schedule_week_of_month IS NULL AND schedule_month BETWEEN 1 AND 12)
        OR (schedule_kind = 'yearly_nth_weekday' AND schedule_day_of_week BETWEEN 1 AND 7 AND schedule_day_of_month IS NULL AND schedule_week_of_month BETWEEN 1 AND 5 AND schedule_month BETWEEN 1 AND 12)))
    OR (recurrence_basis = 'interval' AND deadline_kind = 'strict' AND recommended_start_offset = 0 AND recommended_until_offset = 0
      AND schedule_kind IS NULL AND schedule_day_of_week IS NULL AND schedule_day_of_month IS NULL
      AND schedule_week_of_month IS NULL AND schedule_month IS NULL AND schedule_month_end = 0
      AND interval_unit IN ('day', 'week')
      AND interval_count = CAST(interval_count AS INTEGER)
      AND interval_count BETWEEN 1 AND (CASE interval_unit WHEN 'week' THEN 520 ELSE 3650 END)
      AND interval_anchor_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND date(interval_anchor_on) = interval_anchor_on))
);

CREATE TABLE task_occurrences_new (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  task_rule_id TEXT NOT NULL,
  scheduled_for TEXT,
  due_at TEXT,
  assignee_user_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  completion_calendar_version INTEGER
    CHECK (completion_calendar_version IS NULL OR completion_calendar_version = 1),
  schedule_spec_version INTEGER
    CHECK (schedule_spec_version IS NULL OR schedule_spec_version = 1),
  rule_snapshot TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(rule_snapshot)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (id, household_id),
  UNIQUE (task_rule_id, scheduled_for),
  FOREIGN KEY (task_rule_id, household_id) REFERENCES task_rules_new(id, household_id) ON DELETE CASCADE,
  FOREIGN KEY (household_id, assignee_user_id) REFERENCES household_members(household_id, user_id),
  CHECK (
    (scheduled_for IS NULL AND due_at IS NULL)
    OR (scheduled_for IS NOT NULL AND due_at IS NOT NULL AND scheduled_for <= due_at)
  ),
  CHECK (status IN ('pending', 'completed', 'skipped'))
);

CREATE TABLE activity_logs_new (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  task_occurrence_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  performed_by_user_id TEXT,
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  idempotency_key TEXT,
  next_task_occurrence_id TEXT,
  assignee_user_id TEXT,
  previous_due_at TEXT,
  new_due_at TEXT,
  previous_assignee_user_id TEXT,
  new_assignee_user_id TEXT,
  FOREIGN KEY (task_occurrence_id, household_id) REFERENCES task_occurrences_new(id, household_id) ON DELETE CASCADE,
  FOREIGN KEY (household_id, actor_user_id) REFERENCES household_members(household_id, user_id),
  FOREIGN KEY (household_id, performed_by_user_id) REFERENCES household_members(household_id, user_id),
  FOREIGN KEY (household_id, assignee_user_id) REFERENCES household_members(household_id, user_id),
  UNIQUE (household_id, idempotency_key),
  CHECK (action IN ('completed', 'completion_undone', 'postponed', 'skipped', 'assignee_changed')),
  CHECK ((action = 'completed') = (performed_by_user_id IS NOT NULL))
);

CREATE TABLE completion_corrections_new (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  task_occurrence_id TEXT NOT NULL,
  completed_activity_log_id TEXT NOT NULL REFERENCES activity_logs_new(id),
  actor_user_id TEXT NOT NULL,
  corrected_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  idempotency_key TEXT,
  previous_occurred_at TEXT NOT NULL,
  new_occurred_at TEXT,
  previous_performed_by_user_id TEXT,
  new_performed_by_user_id TEXT,
  FOREIGN KEY (task_occurrence_id, household_id) REFERENCES task_occurrences_new(id, household_id) ON DELETE CASCADE,
  FOREIGN KEY (household_id, actor_user_id) REFERENCES household_members(household_id, user_id),
  FOREIGN KEY (household_id, new_performed_by_user_id) REFERENCES household_members(household_id, user_id),
  UNIQUE (household_id, idempotency_key),
  CHECK (((new_occurred_at IS NOT NULL) + (new_performed_by_user_id IS NOT NULL)) = 1)
);

CREATE TABLE task_rule_consumables_new (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  task_rule_id TEXT NOT NULL,
  consumable_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (task_rule_id, consumable_id),
  FOREIGN KEY (task_rule_id, household_id)
    REFERENCES task_rules_new(id, household_id) ON DELETE CASCADE,
  FOREIGN KEY (consumable_id, household_id)
    REFERENCES consumables(id, household_id) ON DELETE CASCADE
);

CREATE TABLE task_rule_changes_new (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  task_rule_id TEXT NOT NULL,
  task_occurrence_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  previous_rule_snapshot TEXT NOT NULL CHECK (json_valid(previous_rule_snapshot)),
  new_rule_snapshot TEXT NOT NULL CHECK (json_valid(new_rule_snapshot)),
  changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (task_rule_id, household_id)
    REFERENCES task_rules_new(id, household_id) ON DELETE CASCADE,
  FOREIGN KEY (task_occurrence_id, household_id)
    REFERENCES task_occurrences_new(id, household_id) ON DELETE CASCADE,
  FOREIGN KEY (household_id, actor_user_id)
    REFERENCES household_members(household_id, user_id)
);

CREATE TABLE task_rule_schedules_new (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  task_rule_id TEXT NOT NULL,
  schedule_kind TEXT NOT NULL,
  day_of_week INTEGER NOT NULL DEFAULT 0,
  week_of_month INTEGER NOT NULL DEFAULT 0,
  week_last INTEGER NOT NULL DEFAULT 0,
  day_of_month INTEGER NOT NULL DEFAULT 0,
  month_end INTEGER NOT NULL DEFAULT 0,
  month INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (id, household_id),
  UNIQUE (task_rule_id, day_of_week, week_of_month, week_last, day_of_month, month_end, month),
  FOREIGN KEY (task_rule_id, household_id) REFERENCES task_rules_new(id, household_id) ON DELETE CASCADE,
  FOREIGN KEY (task_rule_id, schedule_kind) REFERENCES task_rules_new(id, schedule_kind) ON DELETE CASCADE,
  CHECK (week_last IN (0, 1)),
  CHECK (week_last = 0 OR (
    schedule_kind IN ('monthly_nth_weekday', 'yearly_nth_weekday') AND week_of_month = 5
  )),
  CHECK (month_end IN (0, 1)),
  CHECK (month_end = 0 OR (schedule_kind = 'monthly_day' AND day_of_month = 31)),
  CHECK (
    (schedule_kind = 'weekly' AND day_of_week BETWEEN 1 AND 7
      AND week_of_month = 0 AND week_last = 0
      AND day_of_month = 0 AND month = 0)
    OR (schedule_kind = 'monthly_day' AND day_of_week = 0
      AND week_of_month = 0 AND week_last = 0
      AND day_of_month BETWEEN 1 AND 31 AND month = 0)
    OR (schedule_kind = 'monthly_nth_weekday' AND day_of_week BETWEEN 1 AND 7
      AND week_of_month BETWEEN 1 AND 5 AND day_of_month = 0 AND month = 0)
    OR (schedule_kind = 'yearly' AND day_of_week = 0
      AND week_of_month = 0 AND week_last = 0
      AND day_of_month BETWEEN 1 AND 31 AND month BETWEEN 1 AND 12)
    OR (schedule_kind = 'yearly_nth_weekday' AND day_of_week BETWEEN 1 AND 7
      AND week_of_month BETWEEN 1 AND 5 AND day_of_month = 0
      AND month BETWEEN 1 AND 12)
  )
);

INSERT INTO task_rules_new (
  id, household_id, managed_item_id, title, recurrence_basis, deadline_kind,
  unresolved_policy, recommended_start_offset, recommended_until_offset,
  schedule_kind, schedule_day_of_week, schedule_day_of_month,
  schedule_week_of_month, schedule_month, schedule_month_end,
  interval_unit, interval_count, interval_anchor_on,
  recommended_start_value, recommended_until_value, recommended_unit, created_at
)
SELECT id, household_id, managed_item_id, title, recurrence_basis, deadline_kind,
       unresolved_policy, recommended_start_offset, recommended_until_offset,
       schedule_kind, schedule_day_of_week, schedule_day_of_month,
       schedule_week_of_month, schedule_month, schedule_month_end,
       interval_unit, interval_count, interval_anchor_on,
       recommended_start_value, recommended_until_value, recommended_unit, created_at
  FROM task_rules;

INSERT INTO task_occurrences_new (
  id, household_id, task_rule_id, scheduled_for, due_at, assignee_user_id, status,
  completion_calendar_version, schedule_spec_version, rule_snapshot, created_at
)
SELECT id, household_id, task_rule_id, scheduled_for, due_at, assignee_user_id, status,
       completion_calendar_version, schedule_spec_version, rule_snapshot, created_at
  FROM task_occurrences;

INSERT INTO activity_logs_new (
  id, household_id, task_occurrence_id, action, actor_user_id,
  performed_by_user_id, occurred_at, recorded_at, idempotency_key,
  next_task_occurrence_id, assignee_user_id, previous_due_at, new_due_at,
  previous_assignee_user_id, new_assignee_user_id
)
SELECT id, household_id, task_occurrence_id, action, actor_user_id,
       performed_by_user_id, occurred_at, recorded_at, idempotency_key,
       next_task_occurrence_id, assignee_user_id, previous_due_at, new_due_at,
       previous_assignee_user_id, new_assignee_user_id
  FROM activity_logs;

INSERT INTO completion_corrections_new (
  id, household_id, task_occurrence_id, completed_activity_log_id,
  actor_user_id, corrected_at, idempotency_key, previous_occurred_at,
  new_occurred_at, previous_performed_by_user_id, new_performed_by_user_id
)
SELECT id, household_id, task_occurrence_id, completed_activity_log_id,
       actor_user_id, corrected_at, idempotency_key, previous_occurred_at,
       new_occurred_at, previous_performed_by_user_id, new_performed_by_user_id
  FROM completion_corrections;

INSERT INTO task_rule_consumables_new (
  household_id, task_rule_id, consumable_id, created_at
)
SELECT household_id, task_rule_id, consumable_id, created_at
  FROM task_rule_consumables;

INSERT INTO task_rule_changes_new (
  id, household_id, task_rule_id, task_occurrence_id, actor_user_id,
  previous_rule_snapshot, new_rule_snapshot, changed_at
)
SELECT id, household_id, task_rule_id, task_occurrence_id, actor_user_id,
       previous_rule_snapshot, new_rule_snapshot, changed_at
  FROM task_rule_changes;

INSERT INTO task_rule_schedules_new (
  id, household_id, task_rule_id, schedule_kind,
  day_of_week, week_of_month, week_last, day_of_month, month_end, month, created_at
)
SELECT id, household_id, task_rule_id, schedule_kind,
       day_of_week, week_of_month, week_last, day_of_month, month_end, month, created_at
  FROM task_rule_schedules;

DROP TABLE task_rule_schedules;
DROP TABLE task_rule_changes;
DROP TABLE task_rule_consumables;
DROP TABLE completion_corrections;
DROP TABLE activity_logs;
DROP TABLE task_occurrences;
DROP TABLE task_rules;

ALTER TABLE task_rules_new RENAME TO task_rules;
ALTER TABLE task_occurrences_new RENAME TO task_occurrences;
ALTER TABLE activity_logs_new RENAME TO activity_logs;
ALTER TABLE completion_corrections_new RENAME TO completion_corrections;
ALTER TABLE task_rule_consumables_new RENAME TO task_rule_consumables;
ALTER TABLE task_rule_changes_new RENAME TO task_rule_changes;
ALTER TABLE task_rule_schedules_new RENAME TO task_rule_schedules;

CREATE INDEX task_rules_household_id_idx ON task_rules(household_id);

CREATE INDEX task_occurrences_household_id_idx ON task_occurrences(household_id);
CREATE UNIQUE INDEX task_occurrences_one_pending_per_rule_idx
  ON task_occurrences(task_rule_id) WHERE status = 'pending';

CREATE INDEX activity_logs_household_id_idx ON activity_logs(household_id);
CREATE INDEX activity_logs_occurrence_id_idx ON activity_logs(task_occurrence_id);
CREATE INDEX activity_logs_completed_occurrence_recorded_idx
  ON activity_logs(task_occurrence_id, recorded_at DESC, id DESC)
  WHERE action = 'completed';

CREATE INDEX completion_corrections_household_id_idx ON completion_corrections(household_id);
CREATE INDEX completion_corrections_occurrence_idx
  ON completion_corrections(task_occurrence_id, corrected_at DESC, id DESC);
CREATE INDEX completion_corrections_completed_log_idx
  ON completion_corrections(completed_activity_log_id, corrected_at DESC, id DESC);

CREATE INDEX task_rule_consumables_household_id_idx
  ON task_rule_consumables(household_id);
CREATE INDEX task_rule_consumables_consumable_id_idx
  ON task_rule_consumables(consumable_id);

CREATE INDEX task_rule_changes_household_id_idx
  ON task_rule_changes(household_id);
CREATE INDEX task_rule_changes_occurrence_idx
  ON task_rule_changes(task_occurrence_id, changed_at, id);

CREATE INDEX task_rule_schedules_task_rule_id_idx
  ON task_rule_schedules (task_rule_id, household_id);

-- 0009・0010・0012・0016・0017・0018のトリガーを、再作成したテーブルへ
-- そのまま作り直す。0021・0022のkind一致トリガーは複合外部キーへ置き換えた
-- ため作り直さない。
CREATE TRIGGER task_occurrences_undated_once_insert
BEFORE INSERT ON task_occurrences
WHEN NEW.scheduled_for IS NULL
BEGIN
  SELECT RAISE(ABORT, 'undated occurrence requires once recurrence')
   WHERE NOT EXISTS (
     SELECT 1 FROM task_rules r
      WHERE r.id = NEW.task_rule_id
        AND r.household_id = NEW.household_id
        AND r.recurrence_basis = 'once'
   );
END;

CREATE TRIGGER task_occurrences_undated_once_update
BEFORE UPDATE OF scheduled_for, due_at, task_rule_id, household_id ON task_occurrences
WHEN NEW.scheduled_for IS NULL
BEGIN
  SELECT RAISE(ABORT, 'undated occurrence requires once recurrence')
   WHERE NOT EXISTS (
     SELECT 1 FROM task_rules r
      WHERE r.id = NEW.task_rule_id
        AND r.household_id = NEW.household_id
        AND r.recurrence_basis = 'once'
   );
END;

CREATE TRIGGER task_rules_keep_undated_occurrences_once
BEFORE UPDATE OF recurrence_basis ON task_rules
WHEN NEW.recurrence_basis <> 'once'
BEGIN
  SELECT RAISE(ABORT, 'undated occurrence requires once recurrence')
   WHERE EXISTS (
     SELECT 1 FROM task_occurrences o
      WHERE o.task_rule_id = OLD.id
        AND o.household_id = OLD.household_id
        AND o.scheduled_for IS NULL
   );
END;

CREATE TRIGGER task_rules_month_end_requires_monthly_day_insert
BEFORE INSERT ON task_rules
WHEN NEW.schedule_month_end = 1
  AND (NEW.schedule_kind IS NOT 'monthly_day' OR NEW.schedule_day_of_month IS NOT 31)
BEGIN
  SELECT RAISE(ABORT, 'schedule_month_end requires monthly_day at day 31');
END;

CREATE TRIGGER task_rules_month_end_requires_monthly_day_update
BEFORE UPDATE OF schedule_month_end, schedule_kind, schedule_day_of_month ON task_rules
WHEN NEW.schedule_month_end = 1
  AND (NEW.schedule_kind IS NOT 'monthly_day' OR NEW.schedule_day_of_month IS NOT 31)
BEGIN
  SELECT RAISE(ABORT, 'schedule_month_end requires monthly_day at day 31');
END;

CREATE TRIGGER task_rule_consumables_maintenance_only
BEFORE INSERT ON task_rule_consumables
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM task_rules
   WHERE id = NEW.task_rule_id
     AND household_id = NEW.household_id
     AND deadline_kind = 'maintenance'
)
BEGIN
  SELECT RAISE(ABORT, 'Task rule must be maintenance and belong to the household');
END;

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

-- 0021・0022と同じロールアウトガード。yearly_nth_weekdayは旧Workerが
-- 知らない種類であり、候補指定が1件でも次回を計算できない。複数候補・
-- 最終曜日と同じく、version=1を明示しない書き込みを拒否する。
CREATE TRIGGER task_occurrences_schedule_spec_insert
BEFORE INSERT ON task_occurrences
FOR EACH ROW
WHEN NEW.schedule_spec_version IS NOT 1
  AND (
    (SELECT count(*) FROM task_rule_schedules s
      WHERE s.task_rule_id = NEW.task_rule_id
        AND s.household_id = NEW.household_id) > 1
    OR EXISTS (
      SELECT 1 FROM task_rule_schedules s
       WHERE s.task_rule_id = NEW.task_rule_id
         AND s.household_id = NEW.household_id
         AND (s.week_last = 1 OR s.schedule_kind = 'yearly_nth_weekday')
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'multi-spec calendar rules require a schedule-spec-aware Worker');
END;
