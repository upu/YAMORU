-- Issue #35: メンテナンスTodoの原子的な完了、冪等性キー、同時完了、家庭間分離を検証する。
-- Issue #18: 完了時の実施者(performed_by_user_id)の既定値・任意指定・検証・冪等性の
-- 整合も併せて検証する(YDR-020)。
-- fixtureはsupabase/seed.sqlの架空データだけを使う。

create extension if not exists pgtap with schema extensions;

begin;

select plan(47);

select has_function(
  'public',
  'complete_maintenance_task',
  array['uuid', 'uuid', 'timestamp with time zone', 'uuid'],
  'メンテナンスTodoを完了し次回Occurrenceを作るRPCが存在する'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.complete_maintenance_task(uuid,uuid,timestamp with time zone,uuid)',
    'execute'
  ),
  'authenticatedだけが完了RPCを実行できる'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.complete_maintenance_task(uuid,uuid,timestamp with time zone,uuid)',
    'execute'
  ),
  'anonは完了RPCを実行できない'
);

select ok(
  not has_function_privilege(
    'service_role',
    'public.complete_maintenance_task(uuid,uuid,timestamp with time zone,uuid)',
    'execute'
  ),
  'Service Roleにも完了RPCを公開しない'
);

select has_column(
  'public', 'activity_logs', 'idempotency_key',
  'ActivityLogに冪等性キー列がある'
);
select has_column(
  'public', 'activity_logs', 'next_task_occurrence_id',
  'ActivityLogに自動生成した次回Occurrenceへの参照列がある'
);
select has_column(
  'public', 'activity_logs', 'performed_by_user_id',
  'ActivityLogに実施者列がある'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.activity_logs'::regclass
       and conname = 'activity_logs_idempotency_key_key'
       and contype = 'u'
  ),
  '冪等性キーに一意制約がある'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.activity_logs'::regclass
       and conname = 'activity_logs_performed_by_completed_check'
       and contype = 'c'
  ),
  '完了以外の行は実施者を持たない不変条件がCHECK制約で強制されている'
);

-- ---------------------------------------------------------------------------
-- 家庭Aのメンバーとして、検証対象のTaskRule/Occurrenceを準備する
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000a1001", "role": "authenticated"}';

select isnt_empty(
  $$ select public.create_maintenance_task(
       '00000000-0000-0000-0000-0000000aa001',
       '完了フロー確認用', 28, 56,
       '2020-01-01 00:00:00+00', '2020-01-08 00:00:00+00'
     ) $$,
  '検証用TaskRule(完了フロー確認用)を作成できる'
);
select isnt_empty(
  $$ select public.create_maintenance_task(
       '00000000-0000-0000-0000-0000000aa001',
       'バックデート計算確認用', 7, 14,
       '2020-02-01 00:00:00+00', '2020-02-08 00:00:00+00'
     ) $$,
  '検証用TaskRule(バックデート計算確認用)を作成できる'
);
select isnt_empty(
  $$ select public.create_maintenance_task(
       '00000000-0000-0000-0000-0000000aa001',
       '衝突確認用', 0, 0,
       '2020-03-09 15:00:00+00', '2020-03-09 15:00:00+00'
     ) $$,
  '検証用TaskRule(衝突確認用)を作成できる'
);
select isnt_empty(
  $$ select public.create_maintenance_task(
       '00000000-0000-0000-0000-0000000aa001',
       '原子性確認用', 3, 5,
       '2020-04-01 00:00:00+00', '2020-04-08 00:00:00+00'
     ) $$,
  '検証用TaskRule(原子性確認用)を作成できる'
);
select isnt_empty(
  $$ select public.create_maintenance_task(
       '00000000-0000-0000-0000-0000000aa001',
       '実施者指定確認用', 1, 2,
       '2020-05-10 00:00:00+00', '2020-05-11 00:00:00+00'
     ) $$,
  '検証用TaskRule(実施者指定確認用)を作成できる'
);

-- ---------------------------------------------------------------------------
-- 現在時刻での完了(既定挙動)
-- ---------------------------------------------------------------------------
select isnt_empty(
  $$ select public.complete_maintenance_task(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '完了フロー確認用'
       ),
       '00000000-0000-0000-0000-0000000e0001'
     ) $$,
  '追加入力なしで現在時刻に完了できる'
);

select is(
  (
    select occurrence.status
      from public.task_occurrences occurrence
      join public.task_rules rule on rule.id = occurrence.task_rule_id
     where rule.title = '完了フロー確認用'
       and occurrence.scheduled_for = '2020-01-01 00:00:00+00'::timestamptz
  ),
  'completed'::text,
  '元Occurrenceがcompletedになる'
);

select is(
  (
    select count(*)
      from public.activity_logs log
      join public.task_occurrences occurrence on occurrence.id = log.task_occurrence_id
      join public.task_rules rule on rule.id = occurrence.task_rule_id
     where rule.title = '完了フロー確認用'
       and log.action = 'completed'
       and log.idempotency_key = '00000000-0000-0000-0000-0000000e0001'
  ),
  1::bigint,
  '完了ActivityLogを1件だけ追記する'
);

select ok(
  (
    select log.recorded_at > now() - interval '1 minute'
      from public.activity_logs log
      join public.task_occurrences occurrence on occurrence.id = log.task_occurrence_id
      join public.task_rules rule on rule.id = occurrence.task_rule_id
     where rule.title = '完了フロー確認用'
  ),
  'recorded_atはサーバー時刻で自動的に付与される'
);

select results_eq(
  $$ select occurrence.scheduled_for, occurrence.due_at
       from public.task_occurrences occurrence
       join public.task_rules rule on rule.id = occurrence.task_rule_id
      where rule.title = '完了フロー確認用'
        and occurrence.status = 'pending' $$,
  $$ select
       ((log.occurred_at at time zone 'Asia/Tokyo')::date + 28)
         ::timestamp at time zone 'Asia/Tokyo',
       ((log.occurred_at at time zone 'Asia/Tokyo')::date + 56)
         ::timestamp at time zone 'Asia/Tokyo'
       from public.activity_logs log
       join public.task_occurrences occurrence on occurrence.id = log.task_occurrence_id
       join public.task_rules rule on rule.id = occurrence.task_rule_id
      where rule.title = '完了フロー確認用' $$,
  '次回の推奨開始・上限をoccurred_atとTaskRuleのオフセットから計算する'
);

select is(
  (
    select next_occurrence.id
      from public.activity_logs log
      join public.task_occurrences next_occurrence
        on next_occurrence.id = log.next_task_occurrence_id
     where log.idempotency_key = '00000000-0000-0000-0000-0000000e0001'
  ),
  (
    select occurrence.id
      from public.task_occurrences occurrence
      join public.task_rules rule on rule.id = occurrence.task_rule_id
     where rule.title = '完了フロー確認用'
       and occurrence.status = 'pending'
  ),
  'ActivityLogから自動生成した次回Occurrenceを安全にたどれる'
);

select is(
  (
    select count(*)
      from public.task_occurrences occurrence
      join public.task_rules rule on rule.id = occurrence.task_rule_id
     where rule.title = '完了フロー確認用'
  ),
  2::bigint,
  '完了処理で元Occurrenceと次回Occurrenceの2件になる'
);

-- ---------------------------------------------------------------------------
-- 実施者(performer)の既定値・任意指定・検証(Issue #18, YDR-020)
-- ---------------------------------------------------------------------------
select is(
  (
    select log.performed_by_user_id
      from public.activity_logs log
      join public.task_occurrences occurrence on occurrence.id = log.task_occurrence_id
      join public.task_rules rule on rule.id = occurrence.task_rule_id
     where rule.title = '完了フロー確認用'
       and log.action = 'completed'
  ),
  '00000000-0000-0000-0000-0000000a1001'::uuid,
  '追加入力なしでは操作主体が実施者になる'
);

select isnt_empty(
  $$ select public.complete_maintenance_task(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '実施者指定確認用'
       ),
       '00000000-0000-0000-0000-0000000e0010',
       null,
       '00000000-0000-0000-0000-0000000a1002'
     ) $$,
  '同じ家庭の別メンバーを実施者に指定して完了できる'
);

select results_eq(
  $$ select log.actor_user_id, log.performed_by_user_id
       from public.activity_logs log
       join public.task_occurrences occurrence on occurrence.id = log.task_occurrence_id
       join public.task_rules rule on rule.id = occurrence.task_rule_id
      where rule.title = '実施者指定確認用'
        and log.action = 'completed' $$,
  $$ values (
       '00000000-0000-0000-0000-0000000a1001'::uuid,
       '00000000-0000-0000-0000-0000000a1002'::uuid
     ) $$,
  '操作主体(actor_user_id)と実施者(performed_by_user_id)を区別して保持する'
);

select throws_ok(
  $$ select public.complete_maintenance_task(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '衝突確認用'
       ),
       '00000000-0000-0000-0000-0000000e0011',
       null,
       '00000000-0000-0000-0000-0000000b1001'
     ) $$,
  'P0001',
  'Performer not found',
  '他家庭の利用者を実施者に指定できない'
);

select throws_ok(
  $$ select public.complete_maintenance_task(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '衝突確認用'
       ),
       '00000000-0000-0000-0000-0000000e0012',
       null,
       '00000000-0000-0000-0000-00000000ffff'
     ) $$,
  'P0001',
  'Performer not found',
  '存在しない利用者IDも同一のエラーにする(所属を推測させない)'
);

select is(
  (
    select occurrence.status
      from public.task_occurrences occurrence
      join public.task_rules rule on rule.id = occurrence.task_rule_id
     where rule.title = '衝突確認用'
  ),
  'pending'::text,
  '実施者検証で失敗した場合、Occurrenceはpendingのまま残る(部分更新なし)'
);

-- ---------------------------------------------------------------------------
-- 同じ冪等性キーの再送は最初の結果を返し、重複作成しない
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select public.complete_maintenance_task(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '完了フロー確認用'
            and occurrence.status = 'completed'
       ),
       '00000000-0000-0000-0000-0000000e0001'
     ) $$,
  $$ select next_occurrence.id
       from public.task_occurrences next_occurrence
       join public.task_rules rule on rule.id = next_occurrence.task_rule_id
      where rule.title = '完了フロー確認用'
        and next_occurrence.status = 'pending' $$,
  '同じ冪等性キーの再送は最初の結果(次回Occurrence ID)を返す'
);

select is(
  (
    select count(*)
      from public.task_occurrences occurrence
      join public.task_rules rule on rule.id = occurrence.task_rule_id
     where rule.title = '完了フロー確認用'
  ),
  2::bigint,
  '再送してもOccurrenceを重複作成しない'
);

select is(
  (
    select count(*)
      from public.activity_logs log
      join public.task_occurrences occurrence on occurrence.id = log.task_occurrence_id
      join public.task_rules rule on rule.id = occurrence.task_rule_id
     where rule.title = '完了フロー確認用'
  ),
  1::bigint,
  '再送してもActivityLogを重複作成しない'
);

-- ---------------------------------------------------------------------------
-- 同じ冪等性キーを異なる実施者で再送すると、保存済みの値を黙って優先せず
-- 「異なる内容の再送」として拒否する(YDR-020)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.complete_maintenance_task(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '完了フロー確認用'
            and occurrence.status = 'completed'
       ),
       '00000000-0000-0000-0000-0000000e0001',
       null,
       '00000000-0000-0000-0000-0000000a1002'
     ) $$,
  'P0001',
  'Idempotency key was already used for a different occurrence',
  '同じ冪等性キーを保存済みと異なる実施者で再送すると拒否する'
);

-- ---------------------------------------------------------------------------
-- 既に完了済みのOccurrenceを異なるキーで完了できない
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.complete_maintenance_task(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '完了フロー確認用'
            and occurrence.status = 'completed'
       ),
       '00000000-0000-0000-0000-0000000e0002'
     ) $$,
  'P0001',
  'Occurrence is not pending',
  '既に完了済みのOccurrenceを再度完了できない'
);

-- ---------------------------------------------------------------------------
-- 同じ冪等性キーを別Occurrenceへ使い回せない
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.complete_maintenance_task(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = 'バックデート計算確認用'
       ),
       '00000000-0000-0000-0000-0000000e0001'
     ) $$,
  'P0001',
  'Idempotency key was already used for a different occurrence',
  '同じ冪等性キーを別Occurrenceへ使い回すと拒否する'
);

-- ---------------------------------------------------------------------------
-- 過去のoccurred_atを指定したバックデート完了
-- ---------------------------------------------------------------------------
select isnt_empty(
  $$ select public.complete_maintenance_task(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = 'バックデート計算確認用'
       ),
       '00000000-0000-0000-0000-0000000e0003',
       '2020-06-15 03:00:00+00'
     ) $$,
  '過去のoccurred_atを指定してバックデート完了できる'
);

select results_eq(
  $$ select occurrence.scheduled_for, occurrence.due_at
       from public.task_occurrences occurrence
       join public.task_rules rule on rule.id = occurrence.task_rule_id
      where rule.title = 'バックデート計算確認用'
        and occurrence.status = 'pending' $$,
  $$ values (
       '2020-06-21 15:00:00+00'::timestamptz,
       '2020-06-28 15:00:00+00'::timestamptz
     ) $$,
  'バックデートしたoccurred_atの日本時間の日付からオフセット日数で次回を計算する'
);

-- ---------------------------------------------------------------------------
-- バックデートで計算結果が既存のscheduled_forと衝突する場合、分かりやすく失敗する
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.complete_maintenance_task(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '衝突確認用'
       ),
       '00000000-0000-0000-0000-0000000e0004',
       '2020-03-10 00:30:00+00'
     ) $$,
  'P0001',
  'Next occurrence already exists for the computed schedule',
  '次回の計算結果が既存のscheduled_forと衝突する場合は分かりやすく失敗する'
);

select is(
  (
    select occurrence.status
      from public.task_occurrences occurrence
      join public.task_rules rule on rule.id = occurrence.task_rule_id
     where rule.title = '衝突確認用'
  ),
  'pending'::text,
  '衝突で失敗した場合、元Occurrenceはpendingのまま残る(部分更新なし)'
);

select is(
  (
    select count(*)
      from public.task_occurrences occurrence
      join public.task_rules rule on rule.id = occurrence.task_rule_id
     where rule.title = '衝突確認用'
  ),
  1::bigint,
  '衝突で失敗した場合、次回Occurrenceを作成しない'
);

-- ---------------------------------------------------------------------------
-- 未来のoccurred_atは許可しない
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.complete_maintenance_task(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '衝突確認用'
       ),
       '00000000-0000-0000-0000-0000000e0005',
       now() + interval '1 day'
     ) $$,
  'P0001',
  'occurred_at must not be in the future',
  '未来のoccurred_atを指定して完了できない'
);

-- ---------------------------------------------------------------------------
-- 冪等性キーは必須
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.complete_maintenance_task(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '衝突確認用'
       ),
       null
     ) $$,
  'P0001',
  'Idempotency key is required',
  '冪等性キーを省略すると失敗する'
);

-- ---------------------------------------------------------------------------
-- 家庭Bのメンバーは家庭AのOccurrenceを完了できない
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000b1001", "role": "authenticated"}';

select throws_ok(
  $$ select public.complete_maintenance_task(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '衝突確認用'
       ),
       '00000000-0000-0000-0000-0000000e0006'
     ) $$,
  'P0001',
  'Occurrence not found',
  '家庭Bの利用者は家庭AのOccurrenceを完了できない'
);

-- ---------------------------------------------------------------------------
-- 存在しないOccurrenceへの要求は安全に失敗する
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000a1001", "role": "authenticated"}';

select throws_ok(
  $$ select public.complete_maintenance_task(
       '00000000-0000-0000-0000-00000000ffff',
       '00000000-0000-0000-0000-0000000e0007'
     ) $$,
  'P0001',
  'Occurrence not found',
  '存在しないOccurrenceへの要求は安全に失敗する'
);

-- ---------------------------------------------------------------------------
-- 未認証利用者は完了RPCを実行できない
-- ---------------------------------------------------------------------------
reset role;
set local role anon;

select throws_ok(
  $$ select public.complete_maintenance_task(
       '00000000-0000-0000-0000-00000000ffff',
       '00000000-0000-0000-0000-0000000e0008'
     ) $$,
  '42501',
  null,
  '未認証利用者は完了RPCを実行できない'
);

-- ---------------------------------------------------------------------------
-- 原子性: 次回Occurrence作成に失敗すると完了処理全体が失敗する
-- ---------------------------------------------------------------------------
reset role;

create function public.reject_completion_atomicity_test_occurrence()
returns trigger
language plpgsql
as $$
begin
  if new.scheduled_for = '2020-04-07 15:00:00+00'::timestamptz then
    raise exception 'atomicity test failure';
  end if;
  return new;
end;
$$;

create trigger reject_completion_atomicity_test_occurrence
before insert on public.task_occurrences
for each row execute function public.reject_completion_atomicity_test_occurrence();

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000a1001", "role": "authenticated"}';

select throws_ok(
  $$ select public.complete_maintenance_task(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '原子性確認用'
       ),
       '00000000-0000-0000-0000-0000000e0009',
       '2020-04-05 00:00:00+00'
     ) $$,
  'atomicity test failure',
  '次回Occurrence作成失敗時は完了処理全体が失敗する'
);

reset role;

select is(
  (
    select occurrence.status
      from public.task_occurrences occurrence
      join public.task_rules rule on rule.id = occurrence.task_rule_id
     where rule.title = '原子性確認用'
  ),
  'pending'::text,
  '原子性テスト失敗時、元Occurrenceはpendingのまま残る'
);

select is(
  (
    select count(*)
      from public.activity_logs log
      join public.task_occurrences occurrence on occurrence.id = log.task_occurrence_id
      join public.task_rules rule on rule.id = occurrence.task_rule_id
     where rule.title = '原子性確認用'
  ),
  0::bigint,
  '原子性テスト失敗時、ActivityLogを残さない'
);

select is(
  (
    select count(*)
      from public.task_occurrences
     where scheduled_for = '2020-04-07 15:00:00+00'::timestamptz
  ),
  0::bigint,
  '原子性テスト失敗時、次回Occurrenceを残さない'
);

select * from finish();

rollback;
