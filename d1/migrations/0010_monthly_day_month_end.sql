-- Issue #227 / YDR-032: 毎月の定例日指定に「月末」を、固定日1〜31とは別の
-- 意味として追加する。既存の「31日指定→月末補正」(YDR-021)は、そのまま
-- schedule_kind = 'monthly_day' / schedule_day_of_month = 31 として温存し、
-- 暦計算(src/lib/d1/calendar.ts)には一切手を入れない。schedule_month_end
-- は保存形式上の意味を区別するためだけの列で、候補計算には使わない。
--
-- task_rulesの複合CHECK制約(schedule_kindごとの列挙)をSQLiteで安全に
-- 拡張する手段がないため(0004と同じ理由)、テーブル再作成は行わず、単純な
-- ADD COLUMNと、越境不変条件を守るTRIGGERで表現する。
ALTER TABLE task_rules ADD COLUMN schedule_month_end INTEGER NOT NULL DEFAULT 0
  CHECK (schedule_month_end IN (0, 1));

-- 「月末」は常にmonthly_day・日付31との組で保存する(31日は既存の月末補正規則
-- により全ての月で成立するため、意味を持たない別の日付との組み合わせを防ぐ)。
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
