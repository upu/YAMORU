-- Issue #100 / YDR-040: 毎月の第N曜日を複数持てるようにし、「第5」とは
-- 別の候補指定として「最終」を保存する。0021で作った子テーブルを作り直し、
-- week_last=1はmonthly_nth_weekdayかつweek_of_month=5のときだけ許す。

DROP TRIGGER task_occurrences_schedule_spec_insert;
DROP TRIGGER task_rule_schedules_kind_insert;
DROP TRIGGER task_rule_schedules_kind_update;

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
  FOREIGN KEY (task_rule_id, household_id) REFERENCES task_rules(id, household_id) ON DELETE CASCADE,
  CHECK (week_last IN (0, 1)),
  CHECK (week_last = 0 OR (
    schedule_kind = 'monthly_nth_weekday' AND week_of_month = 5
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
  )
);

INSERT INTO task_rule_schedules_new (
  id, household_id, task_rule_id, schedule_kind,
  day_of_week, week_of_month, week_last, day_of_month, month_end, month, created_at
)
SELECT id, household_id, task_rule_id, schedule_kind,
       day_of_week, week_of_month, week_last, day_of_month, month_end, month, created_at
  FROM task_rule_schedules;

DROP TABLE task_rule_schedules;
ALTER TABLE task_rule_schedules_new RENAME TO task_rule_schedules;

CREATE INDEX task_rule_schedules_task_rule_id_idx
  ON task_rule_schedules (task_rule_id, household_id);

CREATE TRIGGER task_rule_schedules_kind_insert
BEFORE INSERT ON task_rule_schedules
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM task_rules r
   WHERE r.id = NEW.task_rule_id
     AND r.household_id = NEW.household_id
     AND r.recurrence_basis = 'calendar'
     AND r.schedule_kind = NEW.schedule_kind
)
BEGIN
  SELECT RAISE(ABORT, 'task_rule_schedules requires a calendar rule of the same schedule_kind');
END;

CREATE TRIGGER task_rule_schedules_kind_update
BEFORE UPDATE OF task_rule_id, household_id, schedule_kind ON task_rule_schedules
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM task_rules r
   WHERE r.id = NEW.task_rule_id
     AND r.household_id = NEW.household_id
     AND r.recurrence_basis = 'calendar'
     AND r.schedule_kind = NEW.schedule_kind
)
BEGIN
  SELECT RAISE(ABORT, 'task_rule_schedules requires a calendar rule of the same schedule_kind');
END;

-- 0021の複数候補に加え、単独の「最終」も旧Workerでは第5曜日に見えてしまう。
-- 新Workerが明示するversion=1がない書き込みを同じガードで拒否する。
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
         AND s.week_last = 1
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'multi-spec calendar rules require a schedule-spec-aware Worker');
END;
