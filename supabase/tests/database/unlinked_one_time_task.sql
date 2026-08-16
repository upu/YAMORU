-- Issue #73: ManagedItemなしの一回限りTodoについて、登録・家庭分離・完了・取消を検証する。
-- fixtureはsupabase/seed.sqlの架空データだけを使う。

create extension if not exists pgtap with schema extensions;

begin;

select plan(15);

select ok(
  exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'task_rules'
       and column_name = 'managed_item_id'
       and is_nullable = 'YES'
  ),
  'TaskRuleのmanaged_item_idは任意である'
);

select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.task_rules'::regclass
       and conname = 'task_rules_unlinked_once_check'
       and contype = 'c'
  ),
  '管理対象なしを一回限りだけに制限するCHECK制約がある'
);

select has_function(
  'public',
  'create_one_time_task',
  array['text', 'timestamp with time zone', 'uuid'],
  '任意のManagedItemを受け取る一回限りTodo作成RPCが存在する'
);

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000a1001", "role": "authenticated"}';

select isnt_empty(
  $$ select public.create_one_time_task(
       task_title => ' 家族会議 ',
       scheduled_for => '2026-10-09 15:00:00+00'
     ) $$,
  '自家庭へManagedItemなしの一回限りTodoを登録できる'
);

select results_eq(
  $$ select household_id, managed_item_id, title, recurrence_basis, deadline_kind
       from public.task_rules
      where title = '家族会議' $$,
  $$ values (
       '00000000-0000-0000-0000-00000000a001'::uuid,
       null::uuid,
       '家族会議'::text,
       'once'::text,
       'strict'::text
     ) $$,
  '認証利用者の家庭と管理対象なし・一回限りをDBが決定する'
);

select results_eq(
  $$ select occurrence.status, occurrence.scheduled_for, occurrence.due_at
       from public.task_occurrences occurrence
       join public.task_rules rule on rule.id = occurrence.task_rule_id
      where rule.title = '家族会議' $$,
  $$ values (
       'pending'::text,
       '2026-10-09 15:00:00+00'::timestamptz,
       '2026-10-09 15:00:00+00'::timestamptz
     ) $$,
  '予定日をscheduled_forとdue_atへ同じ値で保存する'
);

select throws_ok(
  $$ select public.create_one_time_task(
       task_title => '他家庭の対象',
       scheduled_for => '2026-10-09 15:00:00+00',
       item_id => '00000000-0000-0000-0000-0000000bb001'
     ) $$,
  'P0001',
  'Managed item not found',
  '他家庭のManagedItemへ関連付けできない'
);

reset role;

select throws_ok(
  $$ insert into public.task_rules (
       household_id, managed_item_id, title, recurrence_basis,
       deadline_kind, recommended_start_offset, recommended_until_offset
     ) values (
       '00000000-0000-0000-0000-00000000a001', null,
       '不正な繰り返し', 'completion', 'maintenance', 28, 56
     ) $$,
  '23514',
  null,
  'ManagedItemなしの繰り返しTodoをDB制約が拒否する'
);

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000b1001", "role": "authenticated"}';

select is(
  (select count(*) from public.task_rules where title = '家族会議'),
  0::bigint,
  '別家庭からTaskRuleを参照できない'
);

select throws_ok(
  $$ select public.complete_maintenance_task(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '家族会議'
       ),
       '00000000-0000-0000-0000-0000000e0073'
     ) $$,
  'P0001',
  'Occurrence not found',
  '別家庭から完了操作できない'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000a1001", "role": "authenticated"}';

select lives_ok(
  $$ select public.complete_maintenance_task(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '家族会議'
       ),
       '00000000-0000-0000-0000-0000000e0073',
       '2026-08-10 03:00:00+00'
     ) $$,
  'バックデートして完了できる'
);

select is(
  (
    select count(*)
      from public.task_occurrences occurrence
      join public.task_rules rule on rule.id = occurrence.task_rule_id
     where rule.title = '家族会議'
       and occurrence.status = 'pending'
  ),
  0::bigint,
  '完了しても次回Occurrenceを生成しない'
);

select is(
  (
    select log.next_task_occurrence_id
      from public.activity_logs log
     where log.idempotency_key = '00000000-0000-0000-0000-0000000e0073'
  ),
  null::uuid,
  '完了履歴は次回Occurrenceを参照しない'
);

select lives_ok(
  $$ select public.undo_maintenance_task_completion(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '家族会議'
       ),
       '00000000-0000-0000-0000-0000000e1073'
     ) $$,
  '完了を取り消せる'
);

select results_eq(
  $$ select occurrence.status, array_agg(log.action order by log.recorded_at)
       from public.task_occurrences occurrence
       join public.task_rules rule on rule.id = occurrence.task_rule_id
       join public.activity_logs log on log.task_occurrence_id = occurrence.id
      where rule.title = '家族会議'
      group by occurrence.status $$,
  $$ values (
       'pending'::text,
       array['completed', 'completion_undone']::text[]
     ) $$,
  '取消後はpendingへ戻り、履歴を追記する'
);

select * from finish();

rollback;
