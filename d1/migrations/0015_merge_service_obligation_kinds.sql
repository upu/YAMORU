-- Issue #302: 家庭向けの大分類を「備品」「サービス・契約」の2択にする。
-- 固定資産税プリセットと既存のobligation分類を同じtransaction内でserviceへ
-- 移し、複合外部キーはmigration終了時に再び整合する。
PRAGMA defer_foreign_keys = ON;

UPDATE managed_item_type_presets
SET kind_code = 'service', sort_order = 30
WHERE code = 'property_tax' AND kind_code = 'obligation';

UPDATE managed_item_classifications
SET kind_code = 'service'
WHERE kind_code = 'obligation';

UPDATE managed_item_kinds
SET label = 'サービス・契約'
WHERE code = 'service';

UPDATE managed_item_kinds
SET is_active = 0
WHERE code = 'obligation';

PRAGMA defer_foreign_keys = OFF;
