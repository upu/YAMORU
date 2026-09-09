-- Issue #375: ホームへ固定する用途に用語を合わせるため、個人別の
-- お気に入り保存テーブルをピン留めへ改名する。既存データは保持する。
DROP INDEX user_consumable_favorites_household_user_idx;
ALTER TABLE user_consumable_favorites RENAME TO user_consumable_pins;
ALTER TABLE user_consumable_pins RENAME COLUMN favorited_at TO pinned_at;

CREATE INDEX user_consumable_pins_household_user_idx
  ON user_consumable_pins(household_id, user_id, pinned_at DESC);
