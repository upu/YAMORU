-- Issue #299: 家庭向けの大分類を「備品」「サービス」「支払い・手続き」の
-- 3択にする。otherの行は旧分類の読み取り互換性のため削除せず、通常の
-- 登録・編集候補からだけ外す。
UPDATE managed_item_kinds
SET label = '備品'
WHERE code = 'asset';

UPDATE managed_item_kinds
SET is_active = 0
WHERE code = 'other';

UPDATE managed_item_type_presets
SET is_active = 0
WHERE kind_code = 'other';
