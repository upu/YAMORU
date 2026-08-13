-- Issue #69 (YDR-019): 招待URLを登録・ログイン後に受諾できるようにするpgTAPテスト。
--
-- 生トークンの交換(open_invitation_claim)は未認証でも呼べ、トークンの有効性に
-- よらず常に同じ形の結果を返すこと(一人一家庭制約下での不変条件)、受諾
-- (accept_household_invitation_by_claim)がメール一致・一人一家庭制約の二段階
-- エラー方針を実装すること、失敗した受諾ではinvitation/membership/claimのいずれも
-- 部分更新しないことを検証する。Service Roleは使わず、Data APIと同じ
-- authenticated / anonロールで境界を通す。

create extension if not exists pgtap with schema extensions;

begin;

select plan(67);

-- ---------------------------------------------------------------------------
-- invitation_pending_claims: スキーマ、RLS、権限の最小性
-- ---------------------------------------------------------------------------
select has_table('public', 'invitation_pending_claims', '招待claimテーブルが存在する');
select has_column('public', 'invitation_pending_claims', 'invitation_id', '交換元の招待を保持する');
select has_column('public', 'invitation_pending_claims', 'claim_secret_hash', 'claim secretのハッシュを保持する');
select hasnt_column('public', 'invitation_pending_claims', 'claim_secret', '生のclaim secretを保存する列を持たない');
select has_column('public', 'invitation_pending_claims', 'expires_at', '一時状態の有効期限を保持する');
select has_column('public', 'invitation_pending_claims', 'consumed_at', '受諾成立日時を保持する');
select col_is_unique('public', 'invitation_pending_claims', 'claim_secret_hash', 'claim secretのハッシュは一意である');
select col_not_null('public', 'household_invitations', 'invited_email', '招待テーブルの招待先メールは必須のまま(回帰確認)');

select is(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.invitation_pending_claims'::regclass),
  true,
  '招待claimテーブルでRLSが有効である'
);
select is(
  (select relforcerowsecurity from pg_catalog.pg_class where oid = 'public.invitation_pending_claims'::regclass),
  true,
  '招待claimテーブルでRLSが強制される'
);
select ok(
  not has_table_privilege('authenticated', 'public.invitation_pending_claims', 'select'),
  'authenticatedは招待claimテーブルを直接参照できない'
);
select ok(
  not has_table_privilege('authenticated', 'public.invitation_pending_claims', 'insert'),
  'authenticatedは招待claimテーブルへ直接追加できない'
);
select ok(
  not has_table_privilege('authenticated', 'public.invitation_pending_claims', 'update'),
  'authenticatedは招待claimテーブルを直接更新できない'
);
select ok(
  not has_table_privilege('anon', 'public.invitation_pending_claims', 'select'),
  'anonは招待claimテーブルを直接参照できない'
);

-- ---------------------------------------------------------------------------
-- open_invitation_claim: 権限とSECURITY DEFINERの最小性
-- ---------------------------------------------------------------------------
select ok(
  has_function_privilege('anon', 'public.open_invitation_claim(text)', 'execute'),
  'anonは交換RPCを実行できる(未ログインで招待リンクを開くため)'
);
select ok(
  has_function_privilege('authenticated', 'public.open_invitation_claim(text)', 'execute'),
  'authenticatedも交換RPCを実行できる'
);
select ok(
  not has_function_privilege('service_role', 'public.open_invitation_claim(text)', 'execute'),
  'Service Roleには交換RPCの実行権限がない'
);
select is(
  (
    select p.prosecdef
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'open_invitation_claim'
  ),
  true,
  '交換RPCはSECURITY DEFINERである'
);
select is(
  (
    select pg_catalog.pg_get_userbyid(p.proowner)
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'open_invitation_claim'
  ),
  'postgres',
  '交換RPCの所有者を明示的にpostgresへ固定する'
);
select is(
  (
    select p.proconfig
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'open_invitation_claim'
  ),
  array['search_path=""']::text[],
  '交換RPCのsearch_pathは空である'
);

-- ---------------------------------------------------------------------------
-- accept_household_invitation_by_claim: 権限とSECURITY DEFINERの最小性
-- ---------------------------------------------------------------------------
select ok(
  has_function_privilege('authenticated', 'public.accept_household_invitation_by_claim(text)', 'execute'),
  'authenticatedは受諾RPCを実行できる'
);
select ok(
  not has_function_privilege('anon', 'public.accept_household_invitation_by_claim(text)', 'execute'),
  'anonには受諾RPCの実行権限がない'
);
select ok(
  not has_function_privilege('service_role', 'public.accept_household_invitation_by_claim(text)', 'execute'),
  'Service Roleにも受諾RPCの実行権限を与えない'
);
select is(
  (
    select p.prosecdef
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'accept_household_invitation_by_claim'
  ),
  true,
  '受諾RPCはSECURITY DEFINERである'
);
select is(
  (
    select pg_catalog.pg_get_userbyid(p.proowner)
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'accept_household_invitation_by_claim'
  ),
  'postgres',
  '受諾RPCの所有者を明示的にpostgresへ固定する'
);
select is(
  (
    select p.proconfig
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'accept_household_invitation_by_claim'
  ),
  array['search_path=""']::text[],
  '受諾RPCのsearch_pathは空である'
);

-- ---------------------------------------------------------------------------
-- Issue #20/#68の旧受諾RPCはclaimベースの受諾に置き換えて削除されている
-- ---------------------------------------------------------------------------
select is(
  (
    select count(*)
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'accept_household_invitation'
  ),
  0::bigint,
  '旧accept_household_invitation(text)は削除され、claimを経由しないバイパス経路が残らない'
);

-- ---------------------------------------------------------------------------
-- 追加fixture(seedの招待に加え、このテストでだけ使う状態を用意する)
-- ---------------------------------------------------------------------------
insert into public.household_invitations (
  id, household_id, invited_email, created_by, token_hash, expires_at, cancelled_at
) values (
  '00000000-0000-0000-0000-00000000d005',
  '00000000-0000-0000-0000-00000000a001',
  'cancelled-invitation-test@example.test',
  '00000000-0000-0000-0000-0000000a1001',
  extensions.digest(pg_catalog.convert_to('test-only-cancelled-invitation', 'UTF8'), 'sha256'),
  now() + interval '1 day',
  now()
);

insert into public.household_invitations (
  id, household_id, invited_email, created_by, token_hash, expires_at
) values (
  '00000000-0000-0000-0000-00000000d007',
  '00000000-0000-0000-0000-00000000a001',
  'replaced-invitation-test@example.test',
  '00000000-0000-0000-0000-0000000a1001',
  extensions.digest(pg_catalog.convert_to('test-only-replacement-invitation', 'UTF8'), 'sha256'),
  now() + interval '1 day'
);

insert into public.household_invitations (
  id, household_id, invited_email, created_by, token_hash, expires_at, replaced_by
) values (
  '00000000-0000-0000-0000-00000000d006',
  '00000000-0000-0000-0000-00000000a001',
  'replaced-invitation-test@example.test',
  '00000000-0000-0000-0000-0000000a1001',
  extensions.digest(pg_catalog.convert_to('test-only-replaced-invitation', 'UTF8'), 'sha256'),
  now() + interval '1 day',
  '00000000-0000-0000-0000-00000000d007'
);

-- メール不一致の境界テスト用(招待先メールがどのfixtureユーザーとも一致しない)。
insert into public.household_invitations (
  id, household_id, invited_email, created_by, token_hash, expires_at
) values (
  '00000000-0000-0000-0000-00000000d008',
  '00000000-0000-0000-0000-00000000a001',
  'nobody-in-fixtures@example.test',
  '00000000-0000-0000-0000-0000000a1001',
  extensions.digest(pg_catalog.convert_to('test-only-mismatch-invitation', 'UTF8'), 'sha256'),
  now() + interval '1 day'
);

-- 一人一家庭制約下の境界テスト用(招待先は家庭Bメンバーの実メール、招待先家庭は家庭A)。
insert into public.household_invitations (
  id, household_id, invited_email, created_by, token_hash, expires_at
) values (
  '00000000-0000-0000-0000-00000000d009',
  '00000000-0000-0000-0000-00000000a001',
  'household-b-member1@example.test',
  '00000000-0000-0000-0000-0000000a1001',
  extensions.digest(pg_catalog.convert_to('test-only-cross-household-invitation', 'UTF8'), 'sha256'),
  now() + interval '1 day'
);

-- 招待先メールの大文字小文字を区別しない一致確認用(c1004の実メールの大文字版)。
insert into public.household_invitations (
  id, household_id, invited_email, created_by, token_hash, expires_at
) values (
  '00000000-0000-0000-0000-00000000d010',
  '00000000-0000-0000-0000-00000000a001',
  'INVALID-INVITATION-TEST@EXAMPLE.TEST',
  '00000000-0000-0000-0000-0000000a1001',
  extensions.digest(pg_catalog.convert_to('test-only-case-insensitive-invitation', 'UTF8'), 'sha256'),
  now() + interval '1 day'
);

-- claimの有効期限が招待自体の残り有効期限でキャップされることの確認用(残り5分)。
insert into public.household_invitations (
  id, household_id, invited_email, created_by, token_hash, expires_at
) values (
  '00000000-0000-0000-0000-00000000d011',
  '00000000-0000-0000-0000-00000000a001',
  'short-lived-invitation-test@example.test',
  '00000000-0000-0000-0000-0000000a1001',
  extensions.digest(pg_catalog.convert_to('test-only-short-lived-invitation', 'UTF8'), 'sha256'),
  now() + interval '5 minutes'
);

-- ---------------------------------------------------------------------------
-- 交換は未認証でも呼べ、有効性によらず常に同じ形の結果を返す(YDR-019不変条件)
-- ---------------------------------------------------------------------------
set local role anon;

create temporary table claim_from_garbage as
select * from public.open_invitation_claim('this-token-matches-nothing-at-all');

create temporary table claim_from_expired as
select * from public.open_invitation_claim('test-only-expired-invitation-c1003');

create temporary table claim_from_cancelled as
select * from public.open_invitation_claim('test-only-cancelled-invitation');

create temporary table claim_from_replaced as
select * from public.open_invitation_claim('test-only-replaced-invitation');

reset role;

select ok(
  (select pg_catalog.char_length(claim_secret) = 64 from claim_from_garbage),
  '存在しないトークンでも交換は64文字のclaim secretを返す'
);
select ok(
  (select pg_catalog.char_length(claim_secret) = 64 from claim_from_expired),
  '期限切れトークンでも交換は同じ形のclaim secretを返す'
);
select ok(
  (select pg_catalog.char_length(claim_secret) = 64 from claim_from_cancelled),
  '取消済みトークンでも交換は同じ形のclaim secretを返す'
);
select ok(
  (select pg_catalog.char_length(claim_secret) = 64 from claim_from_replaced),
  '再発行で置き換えられた旧トークンでも交換は同じ形のclaim secretを返す'
);
select ok(
  (select expires_at > now() + interval '25 minutes' from claim_from_garbage),
  '無効なトークンのclaimは招待の残り期限に制約されず約30分の有効期限を持つ'
);
select isnt(
  (select claim_secret from claim_from_garbage),
  (select claim_secret from claim_from_expired),
  '無効なトークンごとに異なるclaim secretが発行される(使い回さない)'
);

-- ---------------------------------------------------------------------------
-- claimの有効期限は招待自体の残り有効期限でキャップされる
-- ---------------------------------------------------------------------------
set local role anon;

create temporary table claim_from_short_lived as
select * from public.open_invitation_claim('test-only-short-lived-invitation');

reset role;

select ok(
  (
    select expires_at > now()
      and expires_at <= now() + interval '6 minutes'
    from claim_from_short_lived
  ),
  '有効な招待から交換したclaimの有効期限は招待の残り期限(5分)でキャップされる'
);

-- ---------------------------------------------------------------------------
-- 受諾成功と、受諾後も維持される家庭間RLS分離(d001, c1001)
-- ---------------------------------------------------------------------------
-- 交換自体が未認証でも呼べることは上のセクションで検証済みなので、ここでは
-- 後続の受諾呼び出しと同じauthenticatedロールで交換し、一時テーブルの所有権を
-- 揃える(pgTAPの一時テーブルはロールをまたいで参照できないため)。
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c1001", "role": "authenticated"}';

create temporary table claim_valid_c1001 as
select * from public.open_invitation_claim('test-only-valid-invitation-c1001');

reset role;

select ok(
  (
    select expires_at > now() + interval '25 minutes'
    from claim_valid_c1001
  ),
  '有効な招待(残り1日)から交換したclaimの有効期限は約30分でキャップされる'
);

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
     from public.accept_household_invitation_by_claim(
       (select claim_secret from claim_valid_c1001)
     ) $$,
  $$ values ('00000000-0000-0000-0000-00000000a001'::uuid, true) $$,
  '認証済み利用者は有効なclaimを受諾でき、membershipが新規作成されたと分かる'
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

select ok(
  (
    select consumed_at is not null
    from public.invitation_pending_claims
    where claim_secret_hash = extensions.digest(
      pg_catalog.convert_to((select claim_secret from claim_valid_c1001), 'UTF8'),
      'sha256'
    )
  ),
  '受諾に成功したclaimは使用済みとして記録される'
);

-- ---------------------------------------------------------------------------
-- 使用済みclaimの再提示: 受諾者は既に家庭Aのメンバーになっているため
-- 「既に別の家庭に所属」エラーに畳み込まれる(トークンの状態を理由に含めない)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c1001", "role": "authenticated"}';

select throws_ok(
  $$ select * from public.accept_household_invitation_by_claim(
       (select claim_secret from claim_valid_c1001)
     ) $$,
  'P0002',
  'Already a member of a different household',
  '使用済みclaimの再提示は、既にメンバーであることを理由に同一のエラーになる'
);

reset role;

-- ---------------------------------------------------------------------------
-- 使用済み・期限切れの招待は、家庭未所属の受諾者には共通エラーを返す
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c1002", "role": "authenticated"}';

create temporary table claim_reused_d001 as
select * from public.open_invitation_claim('test-only-valid-invitation-c1001');

create temporary table claim_expired_d002 as
select * from public.open_invitation_claim('test-only-expired-invitation-c1003');

select throws_ok(
  $$ select * from public.accept_household_invitation_by_claim(
       (select claim_secret from claim_reused_d001)
     ) $$,
  'P0001',
  'Invitation token is invalid, expired, or already used',
  '使用済みの招待は、家庭未所属の受諾者には共通エラーになる'
);

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c1003", "role": "authenticated"}';

select throws_ok(
  $$ select * from public.accept_household_invitation_by_claim(
       (select claim_secret from claim_expired_d002)
     ) $$,
  'P0001',
  'Invitation token is invalid, expired, or already used',
  '期限切れの招待は、家庭未所属の受諾者には共通エラーになる'
);

reset role;

-- ---------------------------------------------------------------------------
-- 存在しないトークン: 家庭未所属者には共通エラー、既存メンバーには別エラー
-- (PIN: 交換時点では区別されなかった無効トークンが、受諾時点で受諾者の
--  所属状態だけに応じて分岐することを確認する)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c1004", "role": "authenticated"}';

create temporary table claim_garbage_for_c1004 as
select * from public.open_invitation_claim('this-token-matches-nothing-either');

select throws_ok(
  $$ select * from public.accept_household_invitation_by_claim(
       (select claim_secret from claim_garbage_for_c1004)
     ) $$,
  'P0001',
  'Invitation token is invalid, expired, or already used',
  '存在しないトークンは、家庭未所属の受諾者には共通エラーになる'
);

reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000b1001", "role": "authenticated"}';

create temporary table claim_garbage_for_b1001 as
select * from public.open_invitation_claim('this-token-also-matches-nothing');

select throws_ok(
  $$ select * from public.accept_household_invitation_by_claim(
       (select claim_secret from claim_garbage_for_b1001)
     ) $$,
  'P0002',
  'Already a member of a different household',
  '存在しないトークンでも、既に別の家庭に所属する受諾者には別のエラーになる(トークンの状態で内容や有無を変えない)'
);

-- ---------------------------------------------------------------------------
-- 取消済み・再発行済みの旧トークンも、既存メンバーには同じ別エラーになる
-- ---------------------------------------------------------------------------
create temporary table claim_cancelled_for_b1001 as
select * from public.open_invitation_claim('test-only-cancelled-invitation');

create temporary table claim_replaced_for_b1001 as
select * from public.open_invitation_claim('test-only-replaced-invitation');

select throws_ok(
  $$ select * from public.accept_household_invitation_by_claim(
       (select claim_secret from claim_cancelled_for_b1001)
     ) $$,
  'P0002',
  'Already a member of a different household',
  '取消済みトークンでも、既存メンバーには同一の別エラーになる'
);

select throws_ok(
  $$ select * from public.accept_household_invitation_by_claim(
       (select claim_secret from claim_replaced_for_b1001)
     ) $$,
  'P0002',
  'Already a member of a different household',
  '再発行で置き換えられた旧トークンでも、既存メンバーには同一の別エラーになる'
);

reset role;

select isnt_empty(
  $$ select id from public.household_invitations
     where id = '00000000-0000-0000-0000-00000000d007' $$,
  '再発行後の新しい招待は受諾可能な状態のまま残る'
);

-- ---------------------------------------------------------------------------
-- メール不一致: 家庭未所属者には共通エラー、大文字小文字を区別しない一致は成功
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c1004", "role": "authenticated"}';

create temporary table claim_mismatch_d008 as
select * from public.open_invitation_claim('test-only-mismatch-invitation');

create temporary table claim_case_insensitive_d010 as
select * from public.open_invitation_claim('test-only-case-insensitive-invitation');

select throws_ok(
  $$ select * from public.accept_household_invitation_by_claim(
       (select claim_secret from claim_mismatch_d008)
     ) $$,
  'P0001',
  'Invitation token is invalid, expired, or already used',
  'Authのメールと招待先メールが一致しない場合は共通エラーになる'
);

select results_eq(
  $$ select household_id, membership_created
     from public.accept_household_invitation_by_claim(
       (select claim_secret from claim_case_insensitive_d010)
     ) $$,
  $$ values ('00000000-0000-0000-0000-00000000a001'::uuid, true) $$,
  '招待先メールとAuthのメールは大文字小文字を区別せず一致すれば受諾できる'
);

reset role;

-- ---------------------------------------------------------------------------
-- 一人一家庭制約下での受諾結果: 別家庭所属者は拒否、状態は変更しない
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000b1001", "role": "authenticated"}';

create temporary table claim_cross_household_d009 as
select * from public.open_invitation_claim('test-only-cross-household-invitation');

select throws_ok(
  $$ select * from public.accept_household_invitation_by_claim(
       (select claim_secret from claim_cross_household_d009)
     ) $$,
  'P0002',
  'Already a member of a different household',
  '有効かつメール一致でも、招待先が所属家庭と異なれば拒否される'
);

reset role;

select ok(
  (
    select accepted_at is null and accepted_by is null
    from public.household_invitations
    where id = '00000000-0000-0000-0000-00000000d009'
  ),
  '別家庭所属者による拒否では招待の状態を変更しない'
);

select is(
  (
    select count(*)
    from public.household_members
    where user_id = '00000000-0000-0000-0000-0000000b1001'
  ),
  1::bigint,
  '別家庭所属者による拒否ではmembershipを変更しない(家庭Bのままである)'
);

-- ---------------------------------------------------------------------------
-- 一人一家庭制約下での受諾結果: 同じ家庭の既存メンバーは冪等に成功する
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000a1002", "role": "authenticated"}';

create temporary table claim_existing_member_d003 as
select * from public.open_invitation_claim('test-only-existing-member-a1002');

select results_eq(
  $$ select household_id, membership_created
     from public.accept_household_invitation_by_claim(
       (select claim_secret from claim_existing_member_d003)
     ) $$,
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

select ok(
  (
    select accepted_at is not null and accepted_by = '00000000-0000-0000-0000-0000000a1002'
    from public.household_invitations
    where id = '00000000-0000-0000-0000-00000000d003'
  ),
  '冪等な受諾でも招待は使用済みとして記録される'
);

-- ---------------------------------------------------------------------------
-- 失敗した受諾はinvitation/membership/claimを部分更新しない(トリガーで模擬)
-- ---------------------------------------------------------------------------
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

create temporary table claim_atomicity_d004 as
select * from public.open_invitation_claim('test-only-atomicity-c1005');

select throws_ok(
  $$ select * from public.accept_household_invitation_by_claim(
       (select claim_secret from claim_atomicity_d004)
     ) $$,
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

select ok(
  (
    select consumed_at is null
    from public.invitation_pending_claims
    where claim_secret_hash = extensions.digest(
      pg_catalog.convert_to((select claim_secret from claim_atomicity_d004), 'UTF8'),
      'sha256'
    )
  ),
  '失敗した受諾ではclaimも使用済みにならない(raiseで全体がロールバックするため)'
);

drop trigger reject_atomicity_test_membership on public.household_members;
drop function public.reject_atomicity_test_membership();

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c1005", "role": "authenticated"}';

select results_eq(
  $$ select household_id, membership_created
     from public.accept_household_invitation_by_claim(
       (select claim_secret from claim_atomicity_d004)
     ) $$,
  $$ values ('00000000-0000-0000-0000-00000000a001'::uuid, true) $$,
  '失敗が解消された後、同じclaimで改めて受諾できる(claimが誤って消費されていなかった証拠)'
);

reset role;

-- ---------------------------------------------------------------------------
-- 未認証利用者は受諾RPCを実行できない
-- ---------------------------------------------------------------------------
set local role anon;

select throws_ok(
  $$ select * from public.accept_household_invitation_by_claim('irrelevant-value') $$,
  '42501',
  null,
  '未認証利用者は招待を受諾できない'
);

reset role;

select * from finish();

rollback;
