-- Issue #102 / YDR-040: 一つの定例日ルールが複数の候補指定(毎週の月曜と木曜など)
-- を持てるようにする。候補指定の正本をtask_rulesの単一値列から子テーブルへ移す。
--
-- YDR-040の8で選んだ案2(子テーブルへの正規化)を、次の順で入れる。
--   1. task_rule_schedules(1行=1件の候補指定)を作る
--   2. 既存のcalendarルールから候補指定を1件ずつbackfillする
--   3. YDR-039のrule_snapshotへscheduleSpecs配列をbackfillする
--
-- task_rulesのschedule_*列はこのmigrationでは落とさない。migrationは新Worker
-- より先にproductionへ適用するため(database-change-playbook.mdのexpand-first)、
-- 現在稼働中のWorkerが読む列を同時に消せないからである。新しいコードは
-- task_rule_schedulesだけを読み書きし、単一値列は互換のために書くだけとする。
-- 列の削除と、YDR-040の8が求めるUNIQUE (id, schedule_kind) + 複合外部キーは、
-- schedule_kindの列挙へyearly_nth_weekdayを加えるテーブル再作成(別Issue)と
-- 同じ変更でまとめて行う。それまでの親子の種類の一致はTRIGGERで守る。

CREATE TABLE task_rule_schedules (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  task_rule_id TEXT NOT NULL,
  -- 親のschedule_kindと同じ値。値の組み合わせをこの表のCHECKで表せるよう持つ。
  schedule_kind TEXT NOT NULL,
  -- 未使用の列にはNULLではなく0を入れる。SQLiteのUNIQUEはNULL同士を重複と
  -- 見なさないため、NULLでは同一指定の重複を防げない(YDR-040の8)。
  day_of_week INTEGER NOT NULL DEFAULT 0,
  week_of_month INTEGER NOT NULL DEFAULT 0,
  -- YDR-040の4の「最終○曜日」。第5曜日(week_of_month = 5)と別の意味を持つが、
  -- 有効化は別Issueで行うため、ここでは0だけを許す。列とUNIQUEの形を先に
  -- 決めておき、後から制約の緩和だけで足せるようにする。
  week_last INTEGER NOT NULL DEFAULT 0,
  day_of_month INTEGER NOT NULL DEFAULT 0,
  -- YDR-032の「毎月末」。31日固定と区別する意味だけを持ち、候補計算には
  -- 関与しない。
  month_end INTEGER NOT NULL DEFAULT 0,
  month INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (id, household_id),
  -- 同一の候補指定を同じルールへ二度保存しない(YDR-040の7)。
  UNIQUE (task_rule_id, day_of_week, week_of_month, week_last, day_of_month, month_end, month),
  FOREIGN KEY (task_rule_id, household_id) REFERENCES task_rules(id, household_id) ON DELETE CASCADE,
  CHECK (week_last = 0),
  CHECK (month_end IN (0, 1)),
  CHECK (month_end = 0 OR (schedule_kind = 'monthly_day' AND day_of_month = 31)),
  CHECK (
    (schedule_kind = 'weekly' AND day_of_week BETWEEN 1 AND 7
      AND week_of_month = 0 AND day_of_month = 0 AND month = 0)
    OR (schedule_kind = 'monthly_day' AND day_of_week = 0
      AND week_of_month = 0 AND day_of_month BETWEEN 1 AND 31 AND month = 0)
    OR (schedule_kind = 'monthly_nth_weekday' AND day_of_week BETWEEN 1 AND 7
      AND week_of_month BETWEEN 1 AND 5 AND day_of_month = 0 AND month = 0)
    OR (schedule_kind = 'yearly' AND day_of_week = 0
      AND week_of_month = 0 AND day_of_month BETWEEN 1 AND 31 AND month BETWEEN 1 AND 12)
  )
);

CREATE INDEX task_rule_schedules_task_rule_id_idx
  ON task_rule_schedules (task_rule_id, household_id);

-- 候補指定は定例日基準ルールだけが持ち、親のschedule_kindと同じ種類である
-- (YDR-040の3の「一つのルールの候補指定はすべて同じ種類」)。複合外部キーで
-- 守るにはtask_rulesへUNIQUE (id, schedule_kind)が要り、それはテーブル
-- 再作成を伴うため、それまではTRIGGERで同じ不変条件を守る。
CREATE TRIGGER task_rule_schedules_kind_insert
BEFORE INSERT ON task_rule_schedules
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
    FROM task_rules r
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
  SELECT 1
    FROM task_rules r
   WHERE r.id = NEW.task_rule_id
     AND r.household_id = NEW.household_id
     AND r.recurrence_basis = 'calendar'
     AND r.schedule_kind = NEW.schedule_kind
)
BEGIN
  SELECT RAISE(ABORT, 'task_rule_schedules requires a calendar rule of the same schedule_kind');
END;

-- 既存のcalendarルールは候補指定を1件だけ持つ(YDR-040の9)。1要素の候補集合は
-- 移行前と同じ候補列を生むため、pending Occurrenceは作り直さない。
INSERT INTO task_rule_schedules (
  id, household_id, task_rule_id, schedule_kind,
  day_of_week, week_of_month, week_last, day_of_month, month_end, month
)
SELECT lower(hex(randomblob(16))), r.household_id, r.id, r.schedule_kind,
       coalesce(r.schedule_day_of_week, 0),
       coalesce(r.schedule_week_of_month, 0),
       0,
       coalesce(r.schedule_day_of_month, 0),
       r.schedule_month_end,
       coalesce(r.schedule_month, 0)
  FROM task_rules r
 WHERE r.recurrence_basis = 'calendar'
   AND r.schedule_kind IS NOT NULL;

-- YDR-039のスナップショットも候補指定の配列を正本にする。既存の平坦な
-- schedule*キーは残したまま、同じ内容の1要素配列を足す。過去回の表示は
-- 移行前後で変わらない。
UPDATE task_occurrences
   SET rule_snapshot = json_set(
     rule_snapshot,
     '$.scheduleSpecs',
     json((
       SELECT json_group_array(json_object(
         'kind', s.schedule_kind,
         'dayOfWeek', s.day_of_week,
         'weekOfMonth', s.week_of_month,
         'weekLast', s.week_last,
         'dayOfMonth', s.day_of_month,
         'monthEnd', s.month_end,
         'month', s.month
       ))
         FROM task_rule_schedules s
        WHERE s.task_rule_id = task_occurrences.task_rule_id
          AND s.household_id = task_occurrences.household_id
     ))
   )
 WHERE EXISTS (
   SELECT 1
     FROM task_rule_schedules s
    WHERE s.task_rule_id = task_occurrences.task_rule_id
      AND s.household_id = task_occurrences.household_id
 );

-- 0018と同じ理由のロールアウトガード。候補指定を1件しか読まない旧Workerが、
-- 複数候補ルールの次回Occurrenceを最初の曜日だけで作ってしまうことを防ぐ。
-- 新Workerは定例日基準のOccurrenceへversion=1を明示する。
ALTER TABLE task_occurrences
  ADD COLUMN schedule_spec_version INTEGER
  CHECK (schedule_spec_version IS NULL OR schedule_spec_version = 1);

CREATE TRIGGER task_occurrences_schedule_spec_insert
BEFORE INSERT ON task_occurrences
FOR EACH ROW
WHEN NEW.schedule_spec_version IS NOT 1
  AND (
    SELECT count(*)
      FROM task_rule_schedules s
     WHERE s.task_rule_id = NEW.task_rule_id
       AND s.household_id = NEW.household_id
  ) > 1
BEGIN
  SELECT RAISE(ABORT, 'multi-spec calendar rules require a schedule-spec-aware Worker');
END;
