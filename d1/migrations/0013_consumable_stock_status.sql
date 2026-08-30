-- Issue #284: 数量や入出庫履歴を持たず、家庭で更新しやすい粗い在庫状態だけを追加する。
ALTER TABLE consumables
  ADD COLUMN stock_status TEXT NOT NULL DEFAULT 'available'
  CHECK (stock_status IN ('available', 'low', 'out'));

CREATE INDEX consumables_household_stock_status_idx
  ON consumables(household_id, stock_status);
