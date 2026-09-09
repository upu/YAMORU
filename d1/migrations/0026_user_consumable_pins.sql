-- Issue #375: migrationは新Workerより先に適用されるため、旧Workerが使う
-- 0025のテーブルを残したまま、新しいピン留めテーブルを追加する。
CREATE TABLE user_consumable_pins (
  user_id TEXT NOT NULL,
  household_id TEXT NOT NULL,
  consumable_id TEXT NOT NULL,
  pinned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, consumable_id),
  FOREIGN KEY (household_id, user_id)
    REFERENCES household_members(household_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (consumable_id, household_id)
    REFERENCES consumables(id, household_id) ON DELETE CASCADE
);

INSERT INTO user_consumable_pins (
  user_id, household_id, consumable_id, pinned_at
)
SELECT user_id, household_id, consumable_id, favorited_at
FROM user_consumable_favorites;

CREATE INDEX user_consumable_pins_household_user_idx
  ON user_consumable_pins(household_id, user_id, pinned_at DESC);

-- デプロイ中とロールバック期間は新旧Workerのどちらから書いても一致させる。
-- 旧テーブルと同期triggerの削除は、利用停止を確認した後の別migrationで行う。
CREATE TRIGGER sync_pins_from_legacy_insert
AFTER INSERT ON user_consumable_favorites
BEGIN
  INSERT OR IGNORE INTO user_consumable_pins (
    user_id, household_id, consumable_id, pinned_at
  ) VALUES (
    NEW.user_id, NEW.household_id, NEW.consumable_id, NEW.favorited_at
  );
END;

CREATE TRIGGER sync_pins_from_legacy_delete
AFTER DELETE ON user_consumable_favorites
BEGIN
  DELETE FROM user_consumable_pins
  WHERE user_id = OLD.user_id AND consumable_id = OLD.consumable_id;
END;

CREATE TRIGGER sync_legacy_from_pins_insert
AFTER INSERT ON user_consumable_pins
BEGIN
  INSERT OR IGNORE INTO user_consumable_favorites (
    user_id, household_id, consumable_id, favorited_at
  ) VALUES (
    NEW.user_id, NEW.household_id, NEW.consumable_id, NEW.pinned_at
  );
END;

CREATE TRIGGER sync_legacy_from_pins_delete
AFTER DELETE ON user_consumable_pins
BEGIN
  DELETE FROM user_consumable_favorites
  WHERE user_id = OLD.user_id AND consumable_id = OLD.consumable_id;
END;
