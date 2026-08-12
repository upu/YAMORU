-- Issue #14 技術スパイク: 家庭間データ分離のRLSテスト(pgTAP)
--
-- `supabase test db` から実行する。`supabase db reset` 相当のマイグレーション+seedが
-- 事前に適用されている前提。Service Role(RLSを無条件に回避するロール)は一切使わない。
-- authenticated / anon ロールへの`set local role`と、PostgRESTが送るJWTクレームを模した
-- `request.jwt.claims`だけで、RLSポリシーが実際に効いているかを検証する。
--
-- fixtureのUUIDはsupabase/seed.sqlと共通。
--   家庭A: 00000000-0000-0000-0000-00000000a001
--   家庭B: 00000000-0000-0000-0000-00000000b001
--   家庭Aメンバー1: 00000000-0000-0000-0000-0000000a1001
--   家庭Bメンバー1: 00000000-0000-0000-0000-0000000b1001
--   非メンバー(認証済み): 00000000-0000-0000-0000-0000000c1001
--   家庭Aの管理対象: 00000000-0000-0000-0000-0000000aa001
--   家庭Bの管理対象: 00000000-0000-0000-0000-0000000bb001

-- pgTAPはテスト専用の拡張のためマイグレーションには含めず、ここで有効化する。
create extension if not exists pgtap with schema extensions;

begin;

select plan(16);

-- ---------------------------------------------------------------------------
-- 家庭Aのメンバー: 自家庭のmanaged_itemsを読み書きできる
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000a1001", "role": "authenticated"}';

select isnt_empty(
  $$ select id from public.managed_items where id = '00000000-0000-0000-0000-0000000aa001' $$,
  '家庭Aのメンバーは家庭Aの管理対象を参照できる'
);

select isnt_empty(
  $$ select public.create_managed_item('家庭Aメンバーが作成', 'other', null) $$,
  '家庭Aのメンバーは限定RPCで家庭Aの管理対象を作成できる'
);

select isnt_empty(
  $$ update public.managed_items
     set name = '家庭Aメンバーが更新'
     where id = '00000000-0000-0000-0000-0000000aa001'
     returning id $$,
  '家庭Aのメンバーは家庭Aの管理対象を更新できる'
);

select isnt_empty(
  $$ delete from public.managed_items
     where id = '00000000-0000-0000-0000-0000000aa001'
     returning id $$,
  '家庭Aのメンバーは家庭Aの管理対象を削除できる'
);

-- ---------------------------------------------------------------------------
-- 家庭Aのメンバー: 家庭Bのmanaged_itemsは読み書きできない
-- ---------------------------------------------------------------------------
select is_empty(
  $$ select id from public.managed_items where id = '00000000-0000-0000-0000-0000000bb001' $$,
  '家庭Aのメンバーは家庭Bの管理対象を参照できない'
);

select throws_ok(
  $$ insert into public.managed_items (household_id, name)
     values ('00000000-0000-0000-0000-00000000b001', '家庭Aメンバーが家庭Bへ作成しようとした') $$,
  '42501',
  null,
  '家庭Aのメンバーは家庭Bの管理対象を作成できない(RLS違反で拒否される)'
);

select is_empty(
  $$ update public.managed_items
     set name = '家庭Aメンバーが家庭Bを更新しようとした'
     where id = '00000000-0000-0000-0000-0000000bb001'
     returning id $$,
  '家庭Aのメンバーは家庭Bの管理対象を更新できない'
);

select is_empty(
  $$ delete from public.managed_items
     where id = '00000000-0000-0000-0000-0000000bb001'
     returning id $$,
  '家庭Aのメンバーは家庭Bの管理対象を削除できない'
);

-- ---------------------------------------------------------------------------
-- 家庭Aのメンバー: households / household_members も自家庭分しか見えない
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select id from public.households order by id $$,
  $$ values ('00000000-0000-0000-0000-00000000a001'::uuid) $$,
  '家庭Aのメンバーにはhouseholdsで家庭Aだけが見える'
);

select results_eq(
  $$ select household_id from public.household_members order by user_id $$,
  $$ values
      ('00000000-0000-0000-0000-00000000a001'::uuid),
      ('00000000-0000-0000-0000-00000000a001'::uuid) $$,
  '家庭Aのメンバーにはhousehold_membersで家庭Aのmembership行だけが見える'
);

-- ---------------------------------------------------------------------------
-- 非メンバー(認証済みだがどの家庭にも属さない利用者)
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c1001", "role": "authenticated"}';

select is_empty(
  $$ select id from public.managed_items $$,
  '非メンバーはmanaged_itemsを一件も参照できない'
);

select is_empty(
  $$ select id from public.households $$,
  '非メンバーはhouseholdsを一件も参照できない'
);

select throws_ok(
  $$ insert into public.managed_items (household_id, name)
     values ('00000000-0000-0000-0000-00000000a001', '非メンバーが家庭Aへ作成しようとした') $$,
  '42501',
  null,
  '非メンバーは家庭Aの管理対象を作成できない(RLS違反で拒否される)'
);

-- ---------------------------------------------------------------------------
-- 未認証利用者(anon、JWTなし)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '', true);
set local role anon;

-- anonにはテーブル権限(GRANT)自体を与えていないため、RLSの判定より手前の
-- 権限エラー(42501)で拒否される。
select throws_ok(
  $$ select id from public.managed_items $$,
  '42501',
  null,
  '未認証利用者はmanaged_itemsを一件も参照できない(権限エラーで拒否される)'
);

select throws_ok(
  $$ select id from public.households $$,
  '42501',
  null,
  '未認証利用者はhouseholdsを一件も参照できない(権限エラーで拒否される)'
);

select throws_ok(
  $$ insert into public.managed_items (household_id, name)
     values ('00000000-0000-0000-0000-00000000a001', '未認証利用者が家庭Aへ作成しようとした') $$,
  '42501',
  null,
  '未認証利用者は家庭Aの管理対象を作成できない(権限エラーで拒否される)'
);

select * from finish();

rollback;
