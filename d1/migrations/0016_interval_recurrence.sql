-- Issue #99 / YDR-037: 「起点日からN日ごと・N週ごと」の固定間隔ルールを
-- recurrence_basis = 'interval' として追加する。
--
-- recurrence_basisと方式ごとの列の組み合わせはtask_rulesの複合CHECK制約で
-- 表現されており、SQLiteではCHECK制約の列挙をALTER TABLEで拡張できない
-- (0004・0010と同じ理由)。新しい方式の値そのものを増やすため、ここでは
-- 0009と同じ手順でtask_rulesを再作成する。
--
-- task_rulesを削除するとON DELETE CASCADEが子へ波及するため(D1は
-- foreign_keys = 1)、子テーブル(task_occurrences、activity_logs、
-- completion_corrections、task_rule_consumables)も同じ順序で作り直し、
-- 既存データ・外部キー・制約・インデックス・トリガーを保持する。
-- 列の追加はtask_rulesのinterval_unit / interval_count / interval_anchor_on
-- だけで、他のテーブルの定義は0009・0012時点のまま変えない。

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
  -- YDR-037: 固定間隔ルールだけが持つ。単位と回数を分けて保存するのは、
  -- 「隔週」と「14日ごと」という利用者の意図を表示に残すため。
  -- interval_anchor_onはAsia/Tokyoの暦日であり、瞬間ではない。
  interval_unit TEXT,
  interval_count INTEGER,
  interval_anchor_on TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (id, household_id),
  FOREIGN KEY (managed_item_id, household_id) REFERENCES managed_items(id, household_id) ON DELETE CASCADE,
  CHECK (title = trim(title) AND length(title) BETWEEN 1 AND 100),
  CHECK (recurrence_basis IN ('completion', 'once', 'calendar', 'interval')),
  CHECK (deadline_kind IN ('maintenance', 'strict')),
  CHECK (unresolved_policy = 'carry_over'),
  CHECK (schedule_month_end IN (0, 1)),
  CHECK (recommended_start_offset BETWEEN 0 AND 3650 AND recommended_until_offset BETWEEN recommended_start_offset AND 3650),
  -- interval_*は固定間隔ルールでだけ非NULLになる(YDR-037の6の越境不変条件)。
  CHECK ((recurrence_basis = 'interval') = (interval_unit IS NOT NULL)
    AND (recurrence_basis = 'interval') = (interval_count IS NOT NULL)
    AND (recurrence_basis = 'interval') = (interval_anchor_on IS NOT NULL)),
  CHECK ((recurrence_basis = 'completion' AND deadline_kind = 'maintenance' AND schedule_kind IS NULL)
    OR (recurrence_basis = 'once' AND deadline_kind = 'strict' AND recommended_start_offset = 0 AND recommended_until_offset = 0 AND schedule_kind IS NULL)
    OR (recurrence_basis = 'calendar' AND deadline_kind = 'strict' AND recommended_start_offset = 0 AND recommended_until_offset = 0
      AND ((schedule_kind = 'weekly' AND schedule_day_of_week BETWEEN 1 AND 7 AND schedule_day_of_month IS NULL AND schedule_week_of_month IS NULL AND schedule_month IS NULL)
        OR (schedule_kind = 'monthly_day' AND schedule_day_of_week IS NULL AND schedule_day_of_month BETWEEN 1 AND 31 AND schedule_week_of_month IS NULL AND schedule_month IS NULL)
        OR (schedule_kind = 'monthly_nth_weekday' AND schedule_day_of_week BETWEEN 1 AND 7 AND schedule_day_of_month IS NULL AND schedule_week_of_month BETWEEN 1 AND 5 AND schedule_month IS NULL)
        OR (schedule_kind = 'yearly' AND schedule_day_of_week IS NULL AND schedule_day_of_month BETWEEN 1 AND 31 AND schedule_week_of_month IS NULL AND schedule_month BETWEEN 1 AND 12)))
    -- YDR-037: 固定間隔は定例日指定を持たず、期限は厳密(scheduled_for = due_at)。
    -- 上限はunit='day'で3650日、unit='week'で520週(=3640日)。既存の
    -- recommended_*_offsetの上限(3650日、約10年)に合わせる。
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

INSERT INTO task_rules_new (
  id, household_id, managed_item_id, title, recurrence_basis, deadline_kind,
  unresolved_policy, recommended_start_offset, recommended_until_offset,
  schedule_kind, schedule_day_of_week, schedule_day_of_month,
  schedule_week_of_month, schedule_month, schedule_month_end, created_at
)
SELECT id, household_id, managed_item_id, title, recurrence_basis, deadline_kind,
       unresolved_policy, recommended_start_offset, recommended_until_offset,
       schedule_kind, schedule_day_of_week, schedule_day_of_month,
       schedule_week_of_month, schedule_month, schedule_month_end, created_at
  FROM task_rules;

INSERT INTO task_occurrences_new (
  id, household_id, task_rule_id, scheduled_for, due_at,
  assignee_user_id, status, created_at
)
SELECT id, household_id, task_rule_id, scheduled_for, due_at,
       assignee_user_id, status, created_at
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

-- 0009・0010・0012のトリガーを、再作成したテーブルへそのまま作り直す。
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
