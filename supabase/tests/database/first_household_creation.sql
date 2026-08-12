-- Issue #28: 認証済み利用者による最初の家庭作成RPCの境界テスト(pgTAP)
--
-- 利用者IDはauth.uid()だけから決定し、家庭とmembershipを原子的かつ一度だけ
-- 作成する。Service Roleは使わず、Data APIと同じauthenticated / anonで検証する。

create extension if not exists pgtap with schema extensions;

begin;

select plan(33);

insert into auth.users (
  instance_id, id, aud, role, email,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
) values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000e1001', 'authenticated', 'authenticated', 'first-household@example.test', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000e1002', 'authenticated', 'authenticated', 'other-household@example.test', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000e1003', 'authenticated', 'authenticated', 'atomicity-household@example.test', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

-- ---------------------------------------------------------------------------
-- 関数の公開境界とSECURITY DEFINERのハードニング
-- ---------------------------------------------------------------------------
select has_function('public', 'create_first_household', array['text'], '最初の家庭作成RPCが存在する');

select ok(
  has_function_privilege('authenticated', 'public.create_first_household(text)', 'execute'),
  'authenticatedだけに家庭作成RPCの実行権限がある'
);

select ok(
  not has_function_privilege('anon', 'public.create_first_household(text)', 'execute'),
  'anonには家庭作成RPCの実行権限がない'
);

select ok(
  not has_function_privilege('service_role', 'public.create_first_household(text)', 'execute'),
  'Service Roleにも家庭作成RPCの実行権限を与えない'
);

select is(
  (
    select p.prosecdef
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_first_household'
  ),
  true,
  '家庭作成RPCはSECURITY DEFINERである'
);

select is(
  (
    select pg_catalog.pg_get_userbyid(p.proowner)
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_first_household'
  ),
  'postgres',
  '家庭作成RPCの所有者をpostgresへ固定する'
);

select is(
  (
    select p.proconfig
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_first_household'
  ),
  array['search_path=""']::text[],
  '家庭作成RPCのsearch_pathは空である'
);

select ok(
  (
    select pg_catalog.oidvectortypes(p.proargtypes) = 'text'
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_first_household'
  ),
  '家庭作成RPCが受け取る入力は家庭名だけである'
);

select ok(
  not has_table_privilege('authenticated', 'public.households', 'insert'),
  'authenticatedはhouseholdsへ通常INSERTできない'
);

select ok(
  not has_table_privilege('authenticated', 'public.household_members', 'insert'),
  'authenticatedはhousehold_membersへ通常INSERTできない'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint constraint_definition
    where constraint_definition.conrelid = 'public.households'::regclass
      and constraint_definition.conname = 'households_name_length_check'
      and constraint_definition.contype = 'c'
  ),
  '家庭名の長さをテーブル制約でも守る'
);

select col_is_unique(
  'public',
  'household_members',
  'user_id',
  '一人の利用者が所属できる家庭は一つである'
);

select throws_ok(
  $$ insert into public.household_members (household_id, user_id)
     values ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-0000000a1001') $$,
  '23505',
  null,
  '既存メンバーを別の家庭へ追加できない'
);

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000e1001", "role": "authenticated"}';

select throws_ok(
  $$ insert into public.households (name) values ('迂回作成') $$,
  '42501',
  null,
  '利用者はhouseholdsへ直接追加してRPCを迂回できない'
);

select throws_ok(
  $$ insert into public.household_members (household_id, user_id)
     values ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-0000000e1001') $$,
  '42501',
  null,
  '利用者はmembershipへ直接追加してRPCを迂回できない'
);

-- ---------------------------------------------------------------------------
-- 入力検証、作成、再送時の冪等性
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.create_first_household('') $$,
  'P0001',
  'Household name must be between 1 and 100 characters',
  '空文字の家庭名を拒否する'
);

select throws_ok(
  $$ select public.create_first_household('   ') $$,
  'P0001',
  'Household name must be between 1 and 100 characters',
  '空白だけの家庭名を拒否する'
);

select throws_ok(
  $$ select public.create_first_household(E'\t\n') $$,
  'P0001',
  'Household name must be between 1 and 100 characters',
  'タブや改行だけの家庭名を拒否する'
);

select throws_ok(
  $$ select public.create_first_household(repeat('あ', 101)) $$,
  'P0001',
  'Household name must be between 1 and 100 characters',
  '100文字を超える家庭名を拒否する'
);

reset role;

select is(
  (select count(*) from public.households where name in ('', '   ', repeat('あ', 101))),
  0::bigint,
  '無効な入力では家庭を作成しない'
);

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000e1001", "role": "authenticated"}';

select isnt_empty(
  $$ select public.create_first_household('  最初の家庭  ') $$,
  '認証済みの非メンバーは最初の家庭を作成できる'
);

select results_eq(
  $$ select name from public.households $$,
  $$ values ('最初の家庭'::text) $$,
  '作成した家庭をRLS経由で参照でき、前後空白は保存しない'
);

select results_eq(
  $$ select user_id from public.household_members $$,
  $$ values ('00000000-0000-0000-0000-0000000e1001'::uuid) $$,
  '作成者自身のmembershipをauth.uid()から作成する'
);

select results_eq(
  $$ select public.create_first_household('再送で使われない名前') $$,
  $$ select id from public.households where name = '最初の家庭' $$,
  '作成要求の再送には既存の家庭IDを返す'
);

reset role;

select is(
  (select count(*) from public.households where name in ('最初の家庭', '再送で使われない名前')),
  1::bigint,
  '同じ利用者の再送で家庭を重複作成しない'
);

select is(
  (select count(*) from public.household_members where user_id = '00000000-0000-0000-0000-0000000e1001'),
  1::bigint,
  '同じ利用者の再送でmembershipを重複作成しない'
);

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000a1001", "role": "authenticated"}';

select results_eq(
  $$ select public.create_first_household('既存メンバーの追加家庭') $$,
  $$ values ('00000000-0000-0000-0000-00000000a001'::uuid) $$,
  '既に所属する利用者には既存の家庭IDを返す'
);

reset role;

select is(
  (select count(*) from public.households where name = '既存メンバーの追加家庭'),
  0::bigint,
  '既存メンバーへ新しい家庭を追加作成しない'
);

-- ---------------------------------------------------------------------------
-- 未認証、家庭間分離、トランザクション原子性
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '', true);
set local role anon;

select throws_ok(
  $$ select public.create_first_household('未認証の家庭') $$,
  '42501',
  null,
  '未認証利用者は家庭作成RPCを実行できない'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000e1002", "role": "authenticated"}';

select is_empty(
  $$ select id from public.households where name = '最初の家庭' $$,
  '別の利用者から作成済み家庭を参照できない'
);

reset role;

create function public.reject_first_household_membership()
returns trigger
language plpgsql
as $$
begin
  if new.user_id = '00000000-0000-0000-0000-0000000e1003' then
    raise exception 'atomicity test failure';
  end if;
  return new;
end;
$$;

create trigger reject_first_household_membership
before insert on public.household_members
for each row execute function public.reject_first_household_membership();

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000e1003", "role": "authenticated"}';

select throws_ok(
  $$ select public.create_first_household('原子性テスト家庭') $$,
  'P0001',
  'atomicity test failure',
  'membership作成に失敗した場合はRPC全体が失敗する'
);

reset role;

select is(
  (select count(*) from public.households where name = '原子性テスト家庭'),
  0::bigint,
  'membership作成失敗時にHouseholdだけを残さない'
);

select is(
  (select count(*) from public.household_members where user_id = '00000000-0000-0000-0000-0000000e1003'),
  0::bigint,
  'membership作成失敗時にmembershipも残らない'
);

select * from finish();

rollback;
