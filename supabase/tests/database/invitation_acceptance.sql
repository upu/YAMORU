-- Issue #20 技術スパイク: 招待トークン受諾とRLSの両立テスト(pgTAP)
--
-- 生トークンを知る認証済み利用者だけが、招待先家庭へ一度だけ参加できることと、
-- 受諾後も家庭間のRLS分離が維持されることを検証する。
-- Service Roleは使わず、Data APIと同じauthenticated / anonロールで境界を通す。

create extension if not exists pgtap with schema extensions;

begin;

select plan(41);

-- ---------------------------------------------------------------------------
-- スキーマ、RLS、権限の最小性
-- ---------------------------------------------------------------------------
select has_table('public', 'household_invitations', '招待テーブルが存在する');
select has_column('public', 'household_invitations', 'household_id', '招待先家庭を保持する');
select has_column('public', 'household_invitations', 'token_hash', 'トークンハッシュを保持する');
select hasnt_column('public', 'household_invitations', 'token', '生トークンを保存する列を持たない');
select has_column('public', 'household_invitations', 'expires_at', '有効期限を保持する');
select has_column('public', 'household_invitations', 'accepted_at', '受諾日時を保持する');
select has_column('public', 'household_invitations', 'accepted_by', '受諾者を保持する');
select col_is_unique('public', 'household_invitations', 'token_hash', 'トークンハッシュは一意である');

select is(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.household_invitations'::regclass),
  true,
  '招待テーブルでRLSが有効である'
);

select is(
  (select relforcerowsecurity from pg_catalog.pg_class where oid = 'public.household_invitations'::regclass),
  true,
  '招待テーブルでRLSが強制される'
);

select ok(
  not has_table_privilege('authenticated', 'public.household_invitations', 'select'),
  'authenticatedは招待テーブルを直接参照できない'
);

select ok(
  not has_table_privilege('authenticated', 'public.household_invitations', 'insert'),
  'authenticatedは招待テーブルへ直接追加できない'
);

select ok(
  not has_table_privilege('authenticated', 'public.household_invitations', 'update'),
  'authenticatedは招待テーブルを直接更新できない'
);

select ok(
  not has_table_privilege('anon', 'public.household_invitations', 'select'),
  'anonは招待テーブルを直接参照できない'
);

select ok(
  has_function_privilege('authenticated', 'public.accept_household_invitation(text)', 'execute'),
  'authenticatedだけに招待受諾RPCの実行権限がある'
);

select ok(
  not has_function_privilege('anon', 'public.accept_household_invitation(text)', 'execute'),
  'anonには招待受諾RPCの実行権限がない'
);

select ok(
  not has_function_privilege('service_role', 'public.accept_household_invitation(text)', 'execute'),
  'Service Roleにも招待受諾RPCの実行権限を与えない'
);

select is(
  (
    select p.prosecdef
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'accept_household_invitation'
  ),
  true,
  '招待受諾RPCはSECURITY DEFINERである'
);

select is(
  (
    select pg_catalog.pg_get_userbyid(p.proowner)
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'accept_household_invitation'
  ),
  'postgres',
  '招待受諾RPCの所有者を明示的にpostgresへ固定する'
);

select is(
  (
    select p.proconfig
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'accept_household_invitation'
  ),
  array['search_path=""']::text[],
  '招待受諾RPCのsearch_pathは空である'
);

select ok(
  (
    select token_hash <> convert_to('test-only-valid-invitation-c1001', 'UTF8')
    from public.household_invitations
    where id = '00000000-0000-0000-0000-00000000d001'
  ),
  'データベースには生トークンではなくハッシュだけを保存する'
);

-- ---------------------------------------------------------------------------
-- 有効な招待の受諾と、受諾後の家庭間分離
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c1001", "role": "authenticated"}';

select is_empty(
  $$ select id from public.managed_items where household_id = '00000000-0000-0000-0000-00000000a001' $$,
  '受諾前は招待先家庭のデータを参照できない'
);

select throws_ok(
  $$ insert into public.household_members (household_id, user_id)
     values ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-0000000c1001') $$,
  '42501',
  null,
  '利用者はmembershipへ直接追加して任意の家庭へ参加できない'
);

select results_eq(
  $$ select household_id, membership_created
     from public.accept_household_invitation('test-only-valid-invitation-c1001') $$,
  $$ values ('00000000-0000-0000-0000-00000000a001'::uuid, true) $$,
  '認証済み利用者は有効な招待を受諾でき、membershipが新規作成されたと分かる'
);

select isnt_empty(
  $$ select user_id from public.household_members
     where household_id = '00000000-0000-0000-0000-00000000a001'
       and user_id = '00000000-0000-0000-0000-0000000c1001' $$,
  '受諾後は招待先家庭のmembershipが存在する'
);

select isnt_empty(
  $$ select id from public.managed_items where id = '00000000-0000-0000-0000-0000000aa001' $$,
  '受諾後は招待先家庭のデータを参照できる'
);

select isnt_empty(
  $$ select public.create_managed_item('招待受諾者が作成', 'other', null) $$,
  '受諾後は限定RPCで招待先家庭のデータを書き込める'
);

select is_empty(
  $$ select id from public.managed_items where id = '00000000-0000-0000-0000-0000000bb001' $$,
  '受諾後も別家庭のデータは参照できない'
);

select throws_ok(
  $$ insert into public.managed_items (household_id, name)
     values ('00000000-0000-0000-0000-00000000b001', '別家庭への不正作成') $$,
  '42501',
  null,
  '受諾後も別家庭のデータは書き込めない'
);

reset role;

select ok(
  (
    select accepted_at is not null
      and accepted_by = '00000000-0000-0000-0000-0000000c1001'
    from public.household_invitations
    where id = '00000000-0000-0000-0000-00000000d001'
  ),
  '受諾した招待に受諾日時と受諾者が記録される'
);

-- ---------------------------------------------------------------------------
-- 無効・期限切れ・使用済み・未認証の拒否
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c1002", "role": "authenticated"}';

select throws_ok(
  $$ select * from public.accept_household_invitation('test-only-valid-invitation-c1001') $$,
  'P0001',
  'Invitation token is invalid, expired, or already used',
  '使用済みトークンを別の利用者は再利用できない'
);

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c1004", "role": "authenticated"}';

select throws_ok(
  $$ select * from public.accept_household_invitation('test-only-invalid-invitation') $$,
  'P0001',
  'Invitation token is invalid, expired, or already used',
  '無効なトークンは受諾できない'
);

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c1003", "role": "authenticated"}';

select throws_ok(
  $$ select * from public.accept_household_invitation('test-only-expired-invitation-c1003') $$,
  'P0001',
  'Invitation token is invalid, expired, or already used',
  '期限切れトークンは受諾できない'
);

select set_config('request.jwt.claims', '', true);
set local role anon;

select throws_ok(
  $$ select * from public.accept_household_invitation('test-only-anon-invitation') $$,
  '42501',
  null,
  '未認証利用者は招待を受諾できない'
);

reset role;

select is(
  (
    select count(*)
    from public.household_members
    where user_id in (
      '00000000-0000-0000-0000-0000000c1002',
      '00000000-0000-0000-0000-0000000c1003',
      '00000000-0000-0000-0000-0000000c1004'
    )
  ),
  0::bigint,
  '失敗した受諾ではmembershipを作成しない'
);

select ok(
  (
    select accepted_at is null and accepted_by is null
    from public.household_invitations
    where id = '00000000-0000-0000-0000-00000000d002'
  ),
  '期限切れ招待は未使用のまま変わらない'
);

-- ---------------------------------------------------------------------------
-- 既存membershipとトランザクション原子性
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000a1002", "role": "authenticated"}';

select results_eq(
  $$ select household_id, membership_created
     from public.accept_household_invitation('test-only-existing-member-a1002') $$,
  $$ values ('00000000-0000-0000-0000-00000000a001'::uuid, false) $$,
  '既存メンバーが同じ家庭の招待を受諾した場合は重複を作らなかったと分かる'
);

reset role;

select is(
  (
    select count(*)
    from public.household_members
    where household_id = '00000000-0000-0000-0000-00000000a001'
      and user_id = '00000000-0000-0000-0000-0000000a1002'
  ),
  1::bigint,
  '同じ家庭へのmembershipは重複しない'
);

create function public.reject_atomicity_test_membership()
returns trigger
language plpgsql
as $$
begin
  if new.user_id = '00000000-0000-0000-0000-0000000c1005' then
    raise exception 'atomicity test failure';
  end if;
  return new;
end;
$$;

create trigger reject_atomicity_test_membership
before insert on public.household_members
for each row execute function public.reject_atomicity_test_membership();

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c1005", "role": "authenticated"}';

select throws_ok(
  $$ select * from public.accept_household_invitation('test-only-atomicity-c1005') $$,
  'P0001',
  'atomicity test failure',
  'membership追加に失敗した受諾は例外になる'
);

reset role;

select is(
  (
    select count(*)
    from public.household_members
    where user_id = '00000000-0000-0000-0000-0000000c1005'
  ),
  0::bigint,
  '失敗した受諾ではmembershipが部分追加されない'
);

select ok(
  (
    select accepted_at is null and accepted_by is null
    from public.household_invitations
    where id = '00000000-0000-0000-0000-00000000d004'
  ),
  '失敗した受諾では招待も使用済みへ部分更新されない'
);

select * from finish();

rollback;
