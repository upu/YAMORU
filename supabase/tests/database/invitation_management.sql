-- Issue #68 (YDR-019): 招待の発行・取消・再発行・一覧RPCの境界テスト(pgTAP)
--
-- 家庭メンバーが自家庭の招待だけを発行・取消・再発行・一覧でき、他家庭の招待には
-- 存在の有無すら分からない共通エラーが返ることを検証する。

create extension if not exists pgtap with schema extensions;

begin;

select plan(35);

-- ---------------------------------------------------------------------------
-- 権限とSECURITY DEFINERの最小性
-- ---------------------------------------------------------------------------
select ok(
  has_function_privilege('authenticated', 'public.issue_household_invitation(text)', 'execute'),
  'authenticatedは招待発行RPCを実行できる'
);
select ok(
  not has_function_privilege('anon', 'public.issue_household_invitation(text)', 'execute'),
  'anonは招待発行RPCを実行できない'
);
select ok(
  not has_function_privilege('service_role', 'public.issue_household_invitation(text)', 'execute'),
  'Service Roleにも招待発行RPCの実行権限を与えない'
);
select ok(
  has_function_privilege('authenticated', 'public.cancel_household_invitation(uuid)', 'execute'),
  'authenticatedは招待取消RPCを実行できる'
);
select ok(
  not has_function_privilege('anon', 'public.cancel_household_invitation(uuid)', 'execute'),
  'anonは招待取消RPCを実行できない'
);
select ok(
  not has_function_privilege('service_role', 'public.cancel_household_invitation(uuid)', 'execute'),
  'Service Roleにも招待取消RPCの実行権限を与えない'
);
select ok(
  has_function_privilege('authenticated', 'public.list_household_invitations()', 'execute'),
  'authenticatedは招待一覧RPCを実行できる'
);
select ok(
  not has_function_privilege('anon', 'public.list_household_invitations()', 'execute'),
  'anonは招待一覧RPCを実行できない'
);
select ok(
  not has_function_privilege('service_role', 'public.list_household_invitations()', 'execute'),
  'Service Roleにも招待一覧RPCの実行権限を与えない'
);

select ok(
  (
    select bool_and(p.prosecdef)
      and bool_and(pg_catalog.pg_get_userbyid(p.proowner) = 'postgres')
      and bool_and(p.proconfig = array['search_path=""']::text[])
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'issue_household_invitation',
        'cancel_household_invitation',
        'list_household_invitations'
      )
  ),
  '招待管理RPCはすべてSECURITY DEFINERで、所有者はpostgres、search_pathは空である'
);

-- ---------------------------------------------------------------------------
-- 発行・一覧: 家庭メンバーは自家庭の招待だけを見える
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000a1001", "role": "authenticated"}';

create temporary table first_issue as
select * from public.issue_household_invitation('first-invite@example.test');

select ok(
  (select token is not null and pg_catalog.char_length(token) = 64 from first_issue),
  '発行RPCは推測困難な生トークンを返す'
);
select is(
  (select invitation_email from first_issue),
  'first-invite@example.test',
  '発行RPCは招待先メールをそのまま返す'
);

select results_eq(
  $$ select status from public.list_household_invitations()
     where id = (select invitation_id from first_issue) $$,
  $$ values ('pending'::text) $$,
  '発行直後の招待は一覧で有効(pending)と表示される'
);

-- 同じ招待先メールへ再度発行すると、旧招待を無効化して新しい招待に置き換える(再発行)。
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000a1002", "role": "authenticated"}';

create temporary table second_issue as
select * from public.issue_household_invitation('first-invite@example.test');

select isnt(
  (select token from second_issue),
  (select token from first_issue),
  '再発行は新しいトークンを発行する'
);

select results_eq(
  $$ select status from public.list_household_invitations()
     where id = (select invitation_id from first_issue) $$,
  $$ values ('replaced'::text) $$,
  '再発行された旧招待は一覧で再発行済み(replaced)と表示される'
);
select results_eq(
  $$ select status from public.list_household_invitations()
     where id = (select invitation_id from second_issue) $$,
  $$ values ('pending'::text) $$,
  '再発行後の新しい招待は一覧で有効(pending)と表示される'
);

reset role;

select is(
  (
    select count(*)
    from public.household_invitations
    where household_id = '00000000-0000-0000-0000-00000000a001'
      and lower(invited_email) = 'first-invite@example.test'
      and accepted_at is null
      and cancelled_at is null
      and replaced_by is null
  ),
  1::bigint,
  '同じ家庭・メールに対して同時に有効な招待は常に高々1件である'
);

-- ---------------------------------------------------------------------------
-- 旧トークンは受諾不能、新トークンは受諾可能
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c1001", "role": "authenticated"}';

select throws_ok(
  $$ select * from public.accept_household_invitation(
       (select token from first_issue)
     ) $$,
  'P0001',
  'Invitation token is invalid, expired, or already used',
  '再発行により置き換えられた旧トークンは受諾できない'
);

select results_eq(
  $$ select household_id, membership_created
     from public.accept_household_invitation((select token from second_issue)) $$,
  $$ values ('00000000-0000-0000-0000-00000000a001'::uuid, true) $$,
  '再発行後の新しいトークンは受諾できる'
);

reset role;

-- ---------------------------------------------------------------------------
-- 取消: 自家庭のメンバーは同権限で取消でき、旧リンクは即時に受諾不能になる
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000a1001", "role": "authenticated"}';

create temporary table cancel_target as
select * from public.issue_household_invitation('cancel-me@example.test');

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000a1002", "role": "authenticated"}';

select lives_ok(
  $$ select public.cancel_household_invitation(
       (select invitation_id from cancel_target)
     ) $$,
  '発行者以外の家庭メンバーも同権限で招待を取消できる'
);

select results_eq(
  $$ select status from public.list_household_invitations()
     where id = (select invitation_id from cancel_target) $$,
  $$ values ('cancelled'::text) $$,
  '取消済みの招待は一覧で取消済み(cancelled)と表示される'
);

select lives_ok(
  $$ select public.cancel_household_invitation(
       (select invitation_id from cancel_target)
     ) $$,
  '取消済みの招待を再度取消しても冪等に成功する'
);

reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c1002", "role": "authenticated"}';

select throws_ok(
  $$ select * from public.accept_household_invitation(
       (select token from cancel_target)
     ) $$,
  'P0001',
  'Invitation token is invalid, expired, or already used',
  '取消済みトークンは即時に受諾できなくなる'
);

reset role;

-- ---------------------------------------------------------------------------
-- 受諾済みの招待は取消できない
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c1003", "role": "authenticated"}';

select results_eq(
  $$ select household_id, membership_created
     from public.accept_household_invitation('test-only-valid-invitation-c1001') $$,
  $$ values ('00000000-0000-0000-0000-00000000a001'::uuid, true) $$,
  '境界テスト用の招待を先に受諾させる'
);

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000a1001", "role": "authenticated"}';

select throws_ok(
  $$ select public.cancel_household_invitation('00000000-0000-0000-0000-00000000d001') $$,
  'P0001',
  'Cannot cancel an already accepted invitation',
  '受諾済みの招待は取消できない'
);

reset role;

-- ---------------------------------------------------------------------------
-- 他家庭の招待は参照・取消・一覧できない(存在の有無を漏らさない)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000b1001", "role": "authenticated"}';

create temporary table household_b_issue as
select * from public.issue_household_invitation('household-b-invitee@example.test');

reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000a1001", "role": "authenticated"}';

select throws_ok(
  $$ select public.cancel_household_invitation(
       (select invitation_id from household_b_issue)
     ) $$,
  'P0001',
  'Invitation not found',
  '他家庭の招待は取消できず、存在しないIDと同じエラーになる'
);

select throws_ok(
  $$ select public.cancel_household_invitation('00000000-0000-0000-0000-0000000000ff') $$,
  'P0001',
  'Invitation not found',
  '存在しない招待IDも同じエラーになる(存在確認のオラクルにならない)'
);

select is_empty(
  $$ select id from public.list_household_invitations()
     where id = (select invitation_id from household_b_issue) $$,
  '他家庭の招待は一覧に表示されない'
);

reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000b1001", "role": "authenticated"}';

select isnt_empty(
  $$ select id from public.list_household_invitations()
     where id = (select invitation_id from household_b_issue) $$,
  '自家庭の招待は一覧に表示される'
);

reset role;

-- ---------------------------------------------------------------------------
-- 家庭未所属の利用者は発行できず、一覧は空になる
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c1004", "role": "authenticated"}';

select is_empty(
  $$ select id from public.list_household_invitations() $$,
  '家庭未所属の利用者の招待一覧は空である'
);

select throws_ok(
  $$ select * from public.issue_household_invitation('someone@example.test') $$,
  'P0001',
  'Household membership required',
  '家庭未所属の利用者は招待を発行できない'
);

reset role;

-- ---------------------------------------------------------------------------
-- 招待先メールの簡易検証
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000a1001", "role": "authenticated"}';

select throws_ok(
  $$ select * from public.issue_household_invitation('not-an-email') $$,
  'P0001',
  'Invited email must be a valid email address',
  '@を含まない招待先メールは拒否される'
);

reset role;

-- ---------------------------------------------------------------------------
-- 未認証利用者は招待管理RPCを一切実行できない
-- ---------------------------------------------------------------------------
set local role anon;

select throws_ok(
  $$ select * from public.issue_household_invitation('anon@example.test') $$,
  '42501',
  null,
  '未認証利用者は招待を発行できない'
);
select throws_ok(
  $$ select public.cancel_household_invitation('00000000-0000-0000-0000-00000000d001') $$,
  '42501',
  null,
  '未認証利用者は招待を取消できない'
);
select throws_ok(
  $$ select * from public.list_household_invitations() $$,
  '42501',
  null,
  '未認証利用者は招待一覧を取得できない'
);

reset role;

select * from finish();

rollback;
