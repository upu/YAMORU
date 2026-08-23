-- Issue #177: YDR-028の分類体系へ固定資産税の詳しい種類を追加する。
-- 互換列managed_items.kindにはobligationの既定値otherを書き込む。
INSERT INTO managed_item_type_presets (
  code, kind_code, label, sort_order, legacy_kind
) VALUES (
  'property_tax', 'obligation', '固定資産税', 10, 'other'
);
