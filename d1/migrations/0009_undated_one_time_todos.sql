-- Issue #194 / YDR-030: 一回限りTodoだけ、予定日未定を
-- scheduled_for = NULL / due_at = NULL のOccurrenceとして保持する。
-- task_occurrencesを参照する二つの追記型履歴テーブルも同時に再構築し、
-- 既存データ、外部キー、制約、インデックスを維持する。

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
  FOREIGN KEY (task_rule_id, household_id) REFERENCES task_rules(id, household_id) ON DELETE CASCADE,
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

DROP TABLE completion_corrections;
DROP TABLE activity_logs;
DROP TABLE task_occurrences;

ALTER TABLE task_occurrences_new RENAME TO task_occurrences;
ALTER TABLE activity_logs_new RENAME TO activity_logs;
ALTER TABLE completion_corrections_new RENAME TO completion_corrections;

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

-- 列同士のNULL整合性はCHECKで保証する。TaskRuleのrecurrence_basisとの
-- 整合性は、INSERT/UPDATEの両方でDB側から照合する。
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
