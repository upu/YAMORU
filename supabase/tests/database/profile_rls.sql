-- Issue #30: アカウント単位のニックネーム(profiles)のRLS境界テスト(pgTAP)
--
-- household_rls_isolation.sqlと同じ「純粋RLS」テンプレート。RPCを介さず、
-- authenticated / anonへの`set local role`とJWTクレームを模した
-- `request.jwt.claims`だけで、RLSポリシーとCHECK制約が実際に効いているかを検証する。
-- フィクスチャはこのテスト専用に使い捨てのauth.usersを作り、共有のsupabase/seed.sqlは汚さない。

create extension if not exists pgtap with schema extensions;

begin;

select plan(16);

insert into auth.users (
  instance_id, id, aud, role, email,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
) values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000f1001', 'authenticated', 'authenticated', 'profile-a@example.test', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000f1002', 'authenticated', 'authenticated', 'profile-b@example.test', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000f1003', 'authenticated', 'authenticated', 'profile-c@example.test', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000f1004', 'authenticated', 'authenticated', 'profile-d@example.test', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

-- ---------------------------------------------------------------------------
-- 利用者A: 自分のニックネームを登録・参照できる
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000f1001", "role": "authenticated"}';

select isnt_empty(
  $$ insert into public.profiles (nickname) values ('たろう') returning user_id $$,
  '利用者Aは自分のニックネームを登録できる'
);

select results_eq(
  $$ select nickname from public.profiles where user_id = '00000000-0000-0000-0000-0000000f1001' $$,
  $$ values ('たろう'::text) $$,
  '利用者Aは自分のニックネームをRLS経由で参照できる'
);

select throws_ok(
  $$ insert into public.profiles (user_id, nickname)
     values ('00000000-0000-0000-0000-0000000f1002', '他人のふり') $$,
  '42501',
  null,
  '利用者Aは他利用者のuser_idを指定してニックネームを登録できない(RLS違反で拒否される)'
);

select throws_ok(
  $$ insert into public.profiles (nickname) values ('二つ目') $$,
  '23505',
  null,
  '利用者Aは二つ目のニックネームを登録できない(一意制約違反)'
);

-- ---------------------------------------------------------------------------
-- 利用者B: 自分のニックネームを登録でき、Aの行は参照できない
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000f1002", "role": "authenticated"}';

select isnt_empty(
  $$ insert into public.profiles (nickname) values ('はなこ') returning user_id $$,
  '利用者Bは自分のニックネームを登録できる'
);

select is_empty(
  $$ select nickname from public.profiles where user_id = '00000000-0000-0000-0000-0000000f1001' $$,
  '利用者Bは利用者Aのニックネームを参照できない'
);

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000f1001", "role": "authenticated"}';

select is_empty(
  $$ select nickname from public.profiles where user_id = '00000000-0000-0000-0000-0000000f1002' $$,
  '利用者Aは利用者Bのニックネームを参照できない'
);

-- ---------------------------------------------------------------------------
-- 更新: UPDATEポリシーを一切作らないため、自分の行も他人の行も更新できない
-- (このIssueでは登録のみを扱い、変更は将来Issueとする)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ update public.profiles set nickname = '改名' where user_id = '00000000-0000-0000-0000-0000000f1001' $$,
  '42501',
  null,
  '利用者は自分のニックネームも更新できない(UPDATEポリシー未作成のため権限エラーで拒否される)'
);

select throws_ok(
  $$ update public.profiles set nickname = '改名' where user_id = '00000000-0000-0000-0000-0000000f1002' $$,
  '42501',
  null,
  '利用者は他利用者のニックネームを更新できない(権限エラーで拒否される)'
);

-- ---------------------------------------------------------------------------
-- 入力検証: 空文字・空白のみ・長すぎる値をCHECK制約で拒否する
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000f1004", "role": "authenticated"}';

select throws_ok(
  $$ insert into public.profiles (nickname) values ('') $$,
  '23514',
  null,
  '空文字のニックネームを拒否する'
);

select throws_ok(
  $$ insert into public.profiles (nickname) values ('   ') $$,
  '23514',
  null,
  '空白だけのニックネームを拒否する'
);

select throws_ok(
  $$ insert into public.profiles (nickname) values (repeat('あ', 21)) $$,
  '23514',
  null,
  '20文字を超えるニックネームを拒否する'
);

-- ---------------------------------------------------------------------------
-- 前後空白の正規化(trim trigger)
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000f1003", "role": "authenticated"}';

select isnt_empty(
  $$ insert into public.profiles (nickname) values ('  じろう  ') returning user_id $$,
  '前後に空白を含むニックネームも登録できる'
);

select results_eq(
  $$ select nickname from public.profiles where user_id = '00000000-0000-0000-0000-0000000f1003' $$,
  $$ values ('じろう'::text) $$,
  '保存されたニックネームは前後空白が取り除かれている'
);

-- ---------------------------------------------------------------------------
-- 未認証利用者(anon、JWTなし)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '', true);
set local role anon;

select throws_ok(
  $$ select nickname from public.profiles $$,
  '42501',
  null,
  '未認証利用者はニックネームを一件も参照できない(権限エラーで拒否される)'
);

select throws_ok(
  $$ insert into public.profiles (nickname) values ('未認証') $$,
  '42501',
  null,
  '未認証利用者はニックネームを登録できない(権限エラーで拒否される)'
);

select * from finish();

rollback;
