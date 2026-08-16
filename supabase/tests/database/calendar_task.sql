-- Issue #50: 定例日基準Todoの登録、暦補正、次回生成、家庭分離を検証する。
-- fixtureはsupabase/seed.sqlの架空データだけを使う。

create extension if not exists pgtap with schema extensions;

begin;

select plan(32);

select has_function(
  'public',
  'create_calendar_task',
  array['text', 'text', 'integer', 'integer', 'integer', 'integer', 'uuid'],
  '任意のManagedItemと構造化された暦規則を受け取る作成RPCが存在する'
);

select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.create_calendar_task(text,text,integer,integer,integer,integer,uuid)',
    'execute'
  ),
  '認証利用者は定例日基準Todo作成RPCを実行できる'
);

select ok(
  not pg_catalog.has_function_privilege(
    'service_role',
    'public.create_calendar_task(text,text,integer,integer,integer,integer,uuid)',
    'execute'
  ),
  'Service Roleへ定例日基準Todo作成RPCを公開しない'
);

select ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'public._calendar_scheduled_for_on_or_after(text,integer,integer,integer,integer,date)',
    'execute'
  ),
  '認証利用者へ内部の暦候補計算関数を直接公開しない'
);

select has_function(
  'public',
  '_calendar_scheduled_for_on_or_after',
  array['text', 'integer', 'integer', 'integer', 'integer', 'date'],
  '暦候補をAsia/Tokyo基準で計算する内部関数が存在する'
);

select has_column(
  'public', 'task_rules', 'schedule_kind',
  'TaskRuleに定例パターン列がある'
);
select has_column(
  'public', 'task_rules', 'schedule_day_of_week',
  'TaskRuleに曜日列がある'
);
select has_column(
  'public', 'task_rules', 'schedule_day_of_month',
  'TaskRuleに日付列がある'
);
select has_column(
  'public', 'task_rules', 'schedule_week_of_month',
  'TaskRuleに第N週列がある'
);
select has_column(
  'public', 'task_rules', 'schedule_month',
  'TaskRuleに月列がある'
);

select is(
  public._calendar_scheduled_for_on_or_after(
    'weekly', 1, null, null, null, '2026-08-16'::date
  ),
  '2026-08-16 15:00:00+00'::timestamptz,
  '週次は指定曜日のTokyo 00:00を返す'
);

select is(
  public._calendar_scheduled_for_on_or_after(
    'monthly_day', null, 31, null, null, '2026-04-01'::date
  ),
  '2026-04-29 15:00:00+00'::timestamptz,
  '毎月31日は存在しない月で月末へ補正する'
);

select is(
  public._calendar_scheduled_for_on_or_after(
    'monthly_day', null, 31, null, null, '2028-02-01'::date
  ),
  '2028-02-28 15:00:00+00'::timestamptz,
  '毎月31日はうるう年の2月29日へ補正する'
);

select is(
  public._calendar_scheduled_for_on_or_after(
    'monthly_nth_weekday', 1, null, 5, null, '2026-02-01'::date
  ),
  '2026-03-29 15:00:00+00'::timestamptz,
  '存在しない第5曜日は成立する次の月まで進める'
);

select is(
  public._calendar_scheduled_for_on_or_after(
    'yearly', null, 29, null, 2, '2029-01-01'::date
  ),
  '2029-02-27 15:00:00+00'::timestamptz,
  '毎年2月29日は平年の2月28日へ補正する'
);

select is(
  public._calendar_scheduled_for_on_or_after(
    'yearly', null, 1, null, 1, '2026-12-31'::date
  ),
  '2026-12-31 15:00:00+00'::timestamptz,
  '年またぎで翌年の候補を返す'
);

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000a1001", "role": "authenticated"}';

select isnt_empty(
  $$ select public.create_calendar_task(
       task_title => '毎週の家族会議',
       schedule_kind => 'weekly',
       schedule_day_of_week => extract(
         isodow from (now() at time zone 'Asia/Tokyo')::date
       )::integer
     ) $$,
  '管理対象なしの週次Todoを登録できる'
);

select results_eq(
  $$ select managed_item_id, recurrence_basis, deadline_kind,
            schedule_kind, schedule_day_of_week,
            recommended_start_offset, recommended_until_offset
       from public.task_rules
      where title = '毎週の家族会議' $$,
  $$ values (
       null::uuid, 'calendar'::text, 'strict'::text, 'weekly'::text,
       extract(isodow from (now() at time zone 'Asia/Tokyo')::date)::integer,
       0, 0
     ) $$,
  '認証利用者の家庭へ週次規則を保存する'
);

select results_eq(
  $$ select occurrence.scheduled_for, occurrence.due_at
       from public.task_occurrences occurrence
       join public.task_rules rule on rule.id = occurrence.task_rule_id
      where rule.title = '毎週の家族会議' $$,
  $$ values (
       ((now() at time zone 'Asia/Tokyo')::date)::timestamp
         at time zone 'Asia/Tokyo',
       ((now() at time zone 'Asia/Tokyo')::date)::timestamp
         at time zone 'Asia/Tokyo'
     ) $$,
  '登録日のTokyo暦日を含む最初の候補をstrict期限で生成する'
);

select isnt_empty(
  $$ select public.create_calendar_task(
       task_title => '給料日の確認',
       schedule_kind => 'monthly_day',
       schedule_day_of_month => 25,
       item_id => '00000000-0000-0000-0000-0000000aa001'
     ) $$,
  '管理対象ありの月次Todoを登録できる'
);

select is(
  (select managed_item_id from public.task_rules where title = '給料日の確認'),
  '00000000-0000-0000-0000-0000000aa001'::uuid,
  '自家庭のManagedItemを関連付ける'
);

select throws_ok(
  $$ select public.create_calendar_task(
       task_title => '他家庭の定例',
       schedule_kind => 'weekly',
       schedule_day_of_week => 1,
       item_id => '00000000-0000-0000-0000-0000000bb001'
     ) $$,
  'P0001',
  'Managed item not found',
  '他家庭のManagedItemへ関連付けできない'
);

select throws_ok(
  $$ select public.create_calendar_task(
       task_title => '不正な曜日', schedule_kind => 'weekly',
       schedule_day_of_week => 0
     ) $$,
  'P0001',
  'Invalid calendar schedule',
  '範囲外の曜日を拒否する'
);

reset role;

select throws_ok(
  $$ insert into public.task_rules (
       household_id, managed_item_id, title, recurrence_basis,
       deadline_kind, recommended_start_offset, recommended_until_offset,
       schedule_kind, schedule_day_of_week, schedule_day_of_month,
       schedule_week_of_month, schedule_month
     ) values (
       '00000000-0000-0000-0000-00000000a001', null, '不正な週次',
       'calendar', 'strict', 0, 0,
       'weekly', 1, 25, null, null
     ) $$,
  '23514',
  null,
  '週次規則へ不要な日付を混在できない'
);

select throws_ok(
  $$ insert into public.task_rules (
       household_id, managed_item_id, title, recurrence_basis,
       deadline_kind, recommended_start_offset, recommended_until_offset,
       schedule_kind, schedule_day_of_week, schedule_day_of_month,
       schedule_week_of_month, schedule_month
     ) values (
       '00000000-0000-0000-0000-00000000a001', null, '不正な年次',
       'calendar', 'strict', 0, 0,
       'yearly', null, 30, null, 2
     ) $$,
  '23514',
  null,
  '存在しない年次月日を保存できない'
);

insert into public.task_rules (
  id, household_id, managed_item_id, title, recurrence_basis,
  deadline_kind, recommended_start_offset, recommended_until_offset,
  schedule_kind, schedule_day_of_week
) values (
  '00000000-0000-0000-0000-000000005001',
  '00000000-0000-0000-0000-00000000a001', null,
  '毎月曜日', 'calendar', 'strict', 0, 0, 'weekly', 1
);

insert into public.task_occurrences (
  id, household_id, task_rule_id, scheduled_for, due_at, status
) values (
  '00000000-0000-0000-0000-000000005002',
  '00000000-0000-0000-0000-00000000a001',
  '00000000-0000-0000-0000-000000005001',
  '2025-12-28 15:00:00+00', '2025-12-28 15:00:00+00', 'pending'
);

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000a1001", "role": "authenticated"}';

select lives_ok(
  $$ select public.complete_maintenance_task(
       '00000000-0000-0000-0000-000000005002',
       '00000000-0000-0000-0000-0000000e0050',
       '2026-01-06 03:00:00+00'
     ) $$,
  '遅れて完了した定例日基準Todoを完了できる'
);

select results_eq(
  $$ select scheduled_for, due_at, status
       from public.task_occurrences
      where task_rule_id = '00000000-0000-0000-0000-000000005001'
        and status = 'pending' $$,
  $$ values (
       '2026-01-11 15:00:00+00'::timestamptz,
       '2026-01-11 15:00:00+00'::timestamptz,
       'pending'::text
     ) $$,
  '遅延完了日ではなく元の週次規則から次回を生成する'
);

select is(
  (
    select log.next_task_occurrence_id
      from public.activity_logs log
     where log.idempotency_key = '00000000-0000-0000-0000-0000000e0050'
  ),
  (
    select occurrence.id
      from public.task_occurrences occurrence
     where occurrence.task_rule_id = '00000000-0000-0000-0000-000000005001'
       and occurrence.status = 'pending'
  ),
  '完了履歴から次回Occurrenceを参照する'
);

select lives_ok(
  $$ select public.complete_maintenance_task(
       '00000000-0000-0000-0000-000000005002',
       '00000000-0000-0000-0000-0000000e0050',
       '2026-01-06 03:00:00+00'
     ) $$,
  '同じ冪等性キーの再送で重複生成しない'
);

select is(
  (
    select count(*)
      from public.task_occurrences
     where task_rule_id = '00000000-0000-0000-0000-000000005001'
  ),
  2::bigint,
  '定例日基準の完了再送後もOccurrenceは元と次回の2件だけである'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000b1001", "role": "authenticated"}';

select is(
  (select count(*) from public.task_rules where title = '毎週の家族会議'),
  0::bigint,
  '別家庭から定例日基準TaskRuleを参照できない'
);

select throws_ok(
  $$ select public.complete_maintenance_task(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '毎週の家族会議'
       ),
       '00000000-0000-0000-0000-0000000e1050'
     ) $$,
  'P0001',
  'Occurrence not found',
  '別家庭から定例日基準Todoを完了できない'
);

select * from finish();

rollback;
