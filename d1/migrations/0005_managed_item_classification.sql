-- Issue #41: 既存のmanaged_items.kindを互換用に残しながら、
-- 大分類と詳しい種類を独立したマスタ・分類テーブルへ段階移行する。
CREATE TABLE managed_item_kinds (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1,
  legacy_kind TEXT NOT NULL,
  CHECK (code = trim(code) AND length(code) BETWEEN 1 AND 50),
  CHECK (label = trim(label) AND length(label) BETWEEN 1 AND 50),
  CHECK (is_active IN (0, 1)),
  CHECK (legacy_kind IN ('pet_supplies', 'appliance', 'housing_equipment', 'contract', 'other'))
);

CREATE TABLE managed_item_type_presets (
  code TEXT PRIMARY KEY,
  kind_code TEXT NOT NULL REFERENCES managed_item_kinds(code),
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  legacy_kind TEXT NOT NULL,
  UNIQUE (code, kind_code),
  UNIQUE (kind_code, sort_order),
  CHECK (code = trim(code) AND length(code) BETWEEN 1 AND 50),
  CHECK (label = trim(label) AND length(label) BETWEEN 1 AND 50),
  CHECK (is_active IN (0, 1)),
  CHECK (legacy_kind IN ('pet_supplies', 'appliance', 'housing_equipment', 'contract', 'other'))
);

CREATE TABLE managed_item_classifications (
  managed_item_id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  kind_code TEXT NOT NULL REFERENCES managed_item_kinds(code),
  item_type_code TEXT,
  custom_item_type TEXT,
  FOREIGN KEY (managed_item_id, household_id) REFERENCES managed_items(id, household_id) ON DELETE CASCADE,
  FOREIGN KEY (item_type_code, kind_code) REFERENCES managed_item_type_presets(code, kind_code),
  CHECK (item_type_code IS NULL OR custom_item_type IS NULL),
  CHECK (custom_item_type IS NULL OR (custom_item_type = trim(custom_item_type) AND length(custom_item_type) BETWEEN 1 AND 50))
);
CREATE INDEX managed_item_classifications_household_id_idx ON managed_item_classifications(household_id);
CREATE INDEX managed_item_classifications_kind_code_idx ON managed_item_classifications(kind_code);

INSERT INTO managed_item_kinds (code, label, sort_order, legacy_kind) VALUES
  ('asset', 'モノ・設備', 10, 'other'),
  ('service', 'サービス・契約', 20, 'contract'),
  ('obligation', '継続的な義務', 30, 'other'),
  ('other', 'その他', 40, 'other');

INSERT INTO managed_item_type_presets (code, kind_code, label, sort_order, legacy_kind) VALUES
  ('appliance', 'asset', '家電', 10, 'appliance'),
  ('housing_equipment', 'asset', '住宅設備', 20, 'housing_equipment'),
  ('pet_supplies', 'asset', 'ペット用品', 30, 'pet_supplies'),
  ('washing_machine', 'asset', '洗濯機', 40, 'appliance'),
  ('coffee_machine', 'asset', 'コーヒーメーカー', 50, 'appliance'),
  ('bath', 'asset', '浴室', 60, 'housing_equipment'),
  ('pet_water_fountain', 'asset', 'ペット用給水機', 70, 'pet_supplies'),
  ('contract', 'service', '契約', 10, 'contract'),
  ('lesson', 'service', '習い事', 20, 'contract'),
  ('other', 'other', 'その他', 10, 'other');

INSERT INTO managed_item_classifications (
  managed_item_id, household_id, kind_code, item_type_code, custom_item_type
)
SELECT
  id,
  household_id,
  CASE kind
    WHEN 'contract' THEN 'service'
    WHEN 'other' THEN 'other'
    ELSE 'asset'
  END,
  kind,
  NULL
FROM managed_items;
