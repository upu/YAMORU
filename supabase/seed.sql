-- Issue #14 技術スパイク用のローカル専用fixture。
--
-- すべて架空の家庭A/Bとテスト用ユーザーであり、家庭の実データは一切含まない。
-- `supabase db reset` のたびに再生成される。固定UUIDはpgTAPテスト
-- (supabase/tests/database/household_rls_isolation.sql) から参照する。
--
-- このスクリプトはpostgresロール(superuser)で実行されるためRLSの対象外。

-- ---------------------------------------------------------------------------
-- 家庭
-- ---------------------------------------------------------------------------
insert into public.households (id, name) values
  ('00000000-0000-0000-0000-00000000a001', '家庭A(テスト用)'),
  ('00000000-0000-0000-0000-00000000b001', '家庭B(テスト用)');

-- ---------------------------------------------------------------------------
-- Auth利用者(ローカル専用のダミーアカウント)
--   a1001, a1002: 家庭Aのメンバー(2名。全員同権限であることの確認用)
--   b1001       : 家庭Bのメンバー
--   c1001       : どの家庭にも属さない認証済み利用者(非メンバーのケース用)
--   c1002-c1005 : 招待受諾の境界テスト用の非メンバー
-- ---------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
) values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000a1001', 'authenticated', 'authenticated', 'household-a-member1@example.test', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000a1002', 'authenticated', 'authenticated', 'household-a-member2@example.test', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000b1001', 'authenticated', 'authenticated', 'household-b-member1@example.test', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000c1001', 'authenticated', 'authenticated', 'no-household-member@example.test', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000c1002', 'authenticated', 'authenticated', 'used-invitation-test@example.test', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000c1003', 'authenticated', 'authenticated', 'expired-invitation-test@example.test', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000c1004', 'authenticated', 'authenticated', 'invalid-invitation-test@example.test', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000c1005', 'authenticated', 'authenticated', 'atomicity-invitation-test@example.test', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

-- ---------------------------------------------------------------------------
-- membership(c1001はどの家庭にも属さない)
-- ---------------------------------------------------------------------------
insert into public.household_members (household_id, user_id) values
  ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-0000000a1001'),
  ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-0000000a1002'),
  ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-0000000b1001');

-- ---------------------------------------------------------------------------
-- managed_items
-- ---------------------------------------------------------------------------
insert into public.managed_items (id, household_id, name, kind) values
  ('00000000-0000-0000-0000-0000000aa001', '00000000-0000-0000-0000-00000000a001', '家庭Aの管理対象(テスト用)', 'other'),
  ('00000000-0000-0000-0000-0000000bb001', '00000000-0000-0000-0000-00000000b001', '家庭Bの管理対象(テスト用)', 'other');

-- ---------------------------------------------------------------------------
-- 招待(生トークンはfixture生成時にも永続化せず、SHA-256ハッシュだけを保存する)
-- ---------------------------------------------------------------------------
insert into public.household_invitations (
  id, household_id, token_hash, expires_at
) values
  (
    '00000000-0000-0000-0000-00000000d001',
    '00000000-0000-0000-0000-00000000a001',
    extensions.digest(pg_catalog.convert_to('test-only-valid-invitation-c1001', 'UTF8'), 'sha256'),
    now() + interval '1 day'
  ),
  (
    '00000000-0000-0000-0000-00000000d002',
    '00000000-0000-0000-0000-00000000a001',
    extensions.digest(pg_catalog.convert_to('test-only-expired-invitation-c1003', 'UTF8'), 'sha256'),
    now() - interval '1 day'
  ),
  (
    '00000000-0000-0000-0000-00000000d003',
    '00000000-0000-0000-0000-00000000a001',
    extensions.digest(pg_catalog.convert_to('test-only-existing-member-a1002', 'UTF8'), 'sha256'),
    now() + interval '1 day'
  ),
  (
    '00000000-0000-0000-0000-00000000d004',
    '00000000-0000-0000-0000-00000000a001',
    extensions.digest(pg_catalog.convert_to('test-only-atomicity-c1005', 'UTF8'), 'sha256'),
    now() + interval '1 day'
  );
