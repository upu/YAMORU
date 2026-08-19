-- Issue #30: アカウント単位のニックネーム(profiles)のRLS境界テスト(pgTAP)
--
-- household_rls_isolation.sqlと同じ「純粋RLS」テンプレート。RPCを介さず、
-- authenticated / anonへの`set local role`とJWTクレームを模した
-- `request.jwt.claims`だけで、RLSポリシーとCHECK制約が実際に効いているかを検証する。
-- フィクスチャはこのテスト専用に使い捨てのauth.usersを作り、共有のsupabase/seed.sqlは汚さない。

create extension if not exists pgtap with schema extensions;

begin;

select plan(29);

insert into auth.users (
  instance_id, id, aud, role, email,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
) values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000f1001', 'authenticated', 'authenticated', 'profile-a@example.test', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000f1002', 'authenticated', 'authenticated', 'profile-b@example.test', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000f1003', 'authenticated', 'authenticated', 'profile-c@example.test', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000f1004', 'authenticated', 'authenticated', 'profile-d@example.test', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000f1005', 'authenticated', 'authenticated', 'profile-e@example.test', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000f1006', 'authenticated', 'authenticated', 'profile-f@example.test', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000f1007', 'authenticated', 'authenticated', 'profile-g@example.test', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

-- Issue #36: f1005とf1006を同じ家庭のメンバーとして登録する
-- (f1007はどの家庭にも属さない非メンバーのまま)。
insert into public.households (id, name) values
  ('00000000-0000-0000-0000-0000000f9001', '家庭内共有可視性テスト用');

insert into public.household_members (household_id, user_id) values
  ('00000000-0000-0000-0000-0000000f9001', '00000000-0000-0000-0000-0000000f1005'),
  ('00000000-0000-0000-0000-0000000f9001', '00000000-0000-0000-0000-0000000f1006');

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
-- 更新: 本人は自分のニックネームを編集できる(Issue #76)。他利用者の行を
-- 対象にしたUPDATEはUSING句で対象外になり、エラーにはならず0件で終わる。
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ update public.profiles set nickname = 'たろう二世' where user_id = '00000000-0000-0000-0000-0000000f1001' $$,
  '利用者Aは自分のニックネームを更新できる'
);

select results_eq(
  $$ select nickname from public.profiles where user_id = '00000000-0000-0000-0000-0000000f1001' $$,
  $$ values ('たろう二世'::text) $$,
  '更新後のニックネームがAの行に反映されている'
);

select lives_ok(
  $$ update public.profiles set nickname = '改名' where user_id = '00000000-0000-0000-0000-0000000f1002' $$,
  '利用者Aが利用者Bのuser_idを条件にUPDATEしてもエラーにはならない(RLSのUSING句で対象外になるため)'
);

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000f1002", "role": "authenticated"}';

select results_eq(
  $$ select nickname from public.profiles where user_id = '00000000-0000-0000-0000-0000000f1002' $$,
  $$ values ('はなこ'::text) $$,
  '利用者Aの操作では利用者Bのニックネームは変更されない'
);

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000f1001", "role": "authenticated"}';

select throws_ok(
  $$ update public.profiles set nickname = '' where user_id = '00000000-0000-0000-0000-0000000f1001' $$,
  '23514',
  null,
  '空文字への更新は登録時と同じCHECK制約で拒否される'
);

select throws_ok(
  $$ update public.profiles set nickname = repeat('あ', 21) where user_id = '00000000-0000-0000-0000-0000000f1001' $$,
  '23514',
  null,
  '20文字を超える値への更新は登録時と同じCHECK制約で拒否される'
);

select lives_ok(
  $$ update public.profiles set nickname = '  たろう三世  ' where user_id = '00000000-0000-0000-0000-0000000f1001' $$,
  '前後空白を含む値へも更新できる'
);

select results_eq(
  $$ select nickname from public.profiles where user_id = '00000000-0000-0000-0000-0000000f1001' $$,
  $$ values ('たろう三世'::text) $$,
  '更新後も前後空白がトリガーで取り除かれている'
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
-- Issue #36: 同じ家庭のメンバー同士は互いのニックネームを参照できる。
-- 家庭に属さない利用者は、この共有可視性ポリシーの対象にならない。
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000f1005", "role": "authenticated"}';

select isnt_empty(
  $$ insert into public.profiles (nickname) values ('ごろう') returning user_id $$,
  '家庭メンバーの利用者Eは自分のニックネームを登録できる'
);

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000f1006", "role": "authenticated"}';

select isnt_empty(
  $$ insert into public.profiles (nickname) values ('ろくろう') returning user_id $$,
  '家庭メンバーの利用者Fは自分のニックネームを登録できる'
);

select results_eq(
  $$ select nickname from public.profiles where user_id = '00000000-0000-0000-0000-0000000f1005' $$,
  $$ values ('ごろう'::text) $$,
  '利用者Fは同じ家庭の利用者Eのニックネームを参照できる'
);

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000f1005", "role": "authenticated"}';

select results_eq(
  $$ select nickname from public.profiles where user_id = '00000000-0000-0000-0000-0000000f1006' $$,
  $$ values ('ろくろう'::text) $$,
  '利用者Eは同じ家庭の利用者Fのニックネームを参照できる'
);

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000f1007", "role": "authenticated"}';

select is_empty(
  $$ select nickname from public.profiles where user_id = '00000000-0000-0000-0000-0000000f1005' $$,
  'どの家庭にも属さない利用者Gは、利用者Eのニックネームを参照できない'
);

select is_empty(
  $$ select nickname from public.profiles where user_id = '00000000-0000-0000-0000-0000000f1006' $$,
  'どの家庭にも属さない利用者Gは、利用者Fのニックネームを参照できない'
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

select throws_ok(
  $$ update public.profiles set nickname = '未認証' where user_id = '00000000-0000-0000-0000-0000000f1001' $$,
  '42501',
  null,
  '未認証利用者はニックネームを更新できない(権限エラーで拒否される)'
);

select * from finish();

rollback;
