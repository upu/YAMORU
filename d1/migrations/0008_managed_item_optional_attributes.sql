-- Issue #42: 台帳へ任意メモ・商品情報・購入時期を残せるようにする。
-- いずれも任意のため既存行はNULL(未設定)のまま利用でき、登録・編集の
-- 負担も増やさない。purchased_onは分かる精度だけを保持する(YYYY /
-- YYYY-MM / YYYY-MM-DD)。月日の実在確認はアプリ側で行う。
ALTER TABLE managed_items ADD COLUMN note TEXT
  CHECK (note IS NULL OR (note = trim(note) AND length(note) BETWEEN 1 AND 1000));

ALTER TABLE managed_items ADD COLUMN product_info TEXT
  CHECK (product_info IS NULL OR (product_info = trim(product_info) AND length(product_info) BETWEEN 1 AND 200));

ALTER TABLE managed_items ADD COLUMN purchased_on TEXT
  CHECK (purchased_on IS NULL
    OR purchased_on GLOB '[0-9][0-9][0-9][0-9]'
    OR purchased_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'
    OR purchased_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');
