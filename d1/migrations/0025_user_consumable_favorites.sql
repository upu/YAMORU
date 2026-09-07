-- Issue #345: よく使うConsumableへの最短導線を、家庭共有ではなく利用者ごとの
-- お気に入りとして保持する。Consumable本体と在庫状態は引き続き家庭共有。
CREATE TABLE user_consumable_favorites (
  user_id TEXT NOT NULL,
  household_id TEXT NOT NULL,
  consumable_id TEXT NOT NULL,
  favorited_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, consumable_id),
  FOREIGN KEY (household_id, user_id)
    REFERENCES household_members(household_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (consumable_id, household_id)
    REFERENCES consumables(id, household_id) ON DELETE CASCADE
);

CREATE INDEX user_consumable_favorites_household_user_idx
  ON user_consumable_favorites(household_id, user_id, favorited_at DESC);
