-- Issue #239: ManagedItemの開始時期を、対象に合う自然な言葉で表示するため、
-- 中立的な意味を持つ列(started_on)へ段階移行する(YDR-033)。列の型・精度・
-- CHECK制約はpurchased_onと同じ(YYYY / YYYY-MM / YYYY-MM-DD、またはNULL)。
-- purchased_onは書き換えず、既存値をstarted_onへ一度だけコピーする。以後の
-- アプリケーションコードはstarted_onだけを読み書きする。
ALTER TABLE managed_items ADD COLUMN started_on TEXT
  CHECK (started_on IS NULL
    OR started_on GLOB '[0-9][0-9][0-9][0-9]'
    OR started_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'
    OR started_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');

UPDATE managed_items SET started_on = purchased_on WHERE purchased_on IS NOT NULL;
