-- Issue #44: ConsumableはManagedItemやTaskRuleから独立した家庭単位の参照情報。
-- 在庫状態・数量・StockMovementは後続Issue #284以降で扱う。
CREATE TABLE consumables (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  note TEXT,
  product_code TEXT,
  external_url TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (id, household_id),
  CHECK (name = trim(name) AND length(name) BETWEEN 1 AND 100),
  CHECK (note IS NULL OR (note = trim(note) AND length(note) BETWEEN 1 AND 1000)),
  CHECK (product_code IS NULL OR (product_code = trim(product_code) AND length(product_code) BETWEEN 1 AND 200)),
  CHECK (external_url IS NULL OR (
    external_url = trim(external_url)
    AND length(external_url) BETWEEN 1 AND 2048
    AND (external_url GLOB 'http://*' OR external_url GLOB 'https://*')
  ))
);
CREATE INDEX consumables_household_id_idx ON consumables(household_id);

CREATE TABLE managed_item_consumables (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  managed_item_id TEXT NOT NULL,
  consumable_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (managed_item_id, consumable_id),
  FOREIGN KEY (managed_item_id, household_id)
    REFERENCES managed_items(id, household_id) ON DELETE CASCADE,
  FOREIGN KEY (consumable_id, household_id)
    REFERENCES consumables(id, household_id) ON DELETE CASCADE
);
CREATE INDEX managed_item_consumables_household_id_idx
  ON managed_item_consumables(household_id);
CREATE INDEX managed_item_consumables_consumable_id_idx
  ON managed_item_consumables(consumable_id);

CREATE TABLE task_rule_consumables (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  task_rule_id TEXT NOT NULL,
  consumable_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (task_rule_id, consumable_id),
  FOREIGN KEY (task_rule_id, household_id)
    REFERENCES task_rules(id, household_id) ON DELETE CASCADE,
  FOREIGN KEY (consumable_id, household_id)
    REFERENCES consumables(id, household_id) ON DELETE CASCADE
);
CREATE INDEX task_rule_consumables_household_id_idx
  ON task_rule_consumables(household_id);
CREATE INDEX task_rule_consumables_consumable_id_idx
  ON task_rule_consumables(consumable_id);

-- #44では「このメンテナンスで通常使う」を表す。厳密期限Todoへ誤って
-- 関連付ける経路をアプリ以外から作られてもDBで拒否する。
CREATE TRIGGER task_rule_consumables_maintenance_only
BEFORE INSERT ON task_rule_consumables
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM task_rules
   WHERE id = NEW.task_rule_id
     AND household_id = NEW.household_id
     AND deadline_kind = 'maintenance'
)
BEGIN
  SELECT RAISE(ABORT, 'Task rule must be maintenance and belong to the household');
END;
