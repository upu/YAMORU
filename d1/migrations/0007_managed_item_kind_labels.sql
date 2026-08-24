-- Issue #193: YDR-029に基づき、大分類の表示ラベルを家庭向けの短い表現へ揃える。
-- codeとsort_order、有効状態、legacy_kind、詳しい種類との親子関係は変更しない。
UPDATE managed_item_kinds SET label = 'モノ' WHERE code = 'asset';
UPDATE managed_item_kinds SET label = 'サービス' WHERE code = 'service';
UPDATE managed_item_kinds SET label = '支払い・手続き' WHERE code = 'obligation';
