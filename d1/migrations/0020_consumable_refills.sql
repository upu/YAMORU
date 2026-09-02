-- Issue #310 / YDR-012: 現在の在庫状態とは別に、実際の補充日と記録時刻を
-- 分けた追記型の履歴を保持する。数量や消費予測はこのテーブルへ持ち込まない。
CREATE TABLE consumable_refills (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  consumable_id TEXT NOT NULL,
  refilled_on TEXT NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (id, household_id),
  FOREIGN KEY (consumable_id, household_id)
    REFERENCES consumables(id, household_id) ON DELETE CASCADE,
  CHECK (
    refilled_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND date(refilled_on, '+0 days') = refilled_on
  )
);

CREATE INDEX consumable_refills_household_consumable_date_idx
  ON consumable_refills(
    household_id,
    consumable_id,
    refilled_on DESC,
    recorded_at DESC,
    id DESC
  );
