-- Issue #49: ManagedItemにひも付く一回限りTodoの登録・制約・完了を検証する。
-- fixtureはsupabase/seed.sqlの架空データだけを使う。

create extension if not exists pgtap with schema extensions;

begin;

select plan(20);

select has_function(
  'public',
  'create_one_time_task',
  array['text', 'timestamp with time zone', 'uuid'],
  '一回限りTaskRuleと最初のOccurrenceを原子的に作成するRPCが存在する'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.create_one_time_task(text,timestamp with time zone,uuid)',
    'execute'
  ),
  'authenticatedだけが一回限りTodo作成RPCを実行できる'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.create_one_time_task(text,timestamp with time zone,uuid)',
    'execute'
  ),
  'anonは一回限りTodo作成RPCを実行できない'
);

select ok(
  not has_function_privilege(
    'service_role',
    'public.create_one_time_task(text,timestamp with time zone,uuid)',
    'execute'
  ),
  'Service Roleにも一回限りTodo作成RPCを公開しない'
);

select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.task_rules'::regclass
       and conname = 'task_rules_recurrence_basis_check'
       and contype = 'c'
  ),
  '繰り返し方式を許可値へ限定するCHECK制約がある'
);

select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.task_rules'::regclass
       and conname = 'task_rules_deadline_kind_check'
       and contype = 'c'
  ),
  '期限方式を許可値へ限定するCHECK制約がある'
);

select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.task_rules'::regclass
       and conname = 'task_rules_recurrence_configuration_check'
       and contype = 'c'
  ),
  '繰り返し方式と期限方式・オフセットの整合を強制するCHECK制約がある'
);

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000a1001", "role": "authenticated"}';

select isnt_empty(
  $$ select public.create_one_time_task(
       '  今回だけ点検  ',
       '2026-10-09 15:00:00+00',
       '00000000-0000-0000-0000-0000000aa001'
     ) $$,
  '自家庭のManagedItemへ一回限りTodoを登録できる'
);

select results_eq(
  $$ select title, recurrence_basis, deadline_kind,
            recommended_start_offset, recommended_until_offset
       from public.task_rules
      where title = '今回だけ点検' $$,
  $$ values ('今回だけ点検'::text, 'once'::text, 'strict'::text, 0, 0) $$,
  '一回限りを間隔0の代用ではなく明示的な方式として保存する'
);

select results_eq(
  $$ select occurrence.status, occurrence.scheduled_for, occurrence.due_at
       from public.task_occurrences occurrence
       join public.task_rules rule on rule.id = occurrence.task_rule_id
      where rule.title = '今回だけ点検' $$,
  $$ values (
       'pending'::text,
       '2026-10-09 15:00:00+00'::timestamptz,
       '2026-10-09 15:00:00+00'::timestamptz
     ) $$,
  '一回限りの予定日はscheduled_forとdue_atへ同じ値で保存する'
);

select lives_ok(
  $$ select public.complete_maintenance_task(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '今回だけ点検'
       ),
       '00000000-0000-0000-0000-0000000e0049',
       '2026-08-10 03:00:00+00'
     ) $$,
  '一回限りTodoを既存の完了操作で完了できる'
);

select is(
  (
    select occurrence.status
      from public.task_occurrences occurrence
      join public.task_rules rule on rule.id = occurrence.task_rule_id
     where rule.title = '今回だけ点検'
  ),
  'completed'::text,
  '一回限りの元Occurrenceがcompletedになる'
);

select is(
  (
    select count(*)
      from public.activity_logs log
      join public.task_occurrences occurrence on occurrence.id = log.task_occurrence_id
      join public.task_rules rule on rule.id = occurrence.task_rule_id
     where rule.title = '今回だけ点検'
       and log.action = 'completed'
  ),
  1::bigint,
  '一回限りでも完了ActivityLogを1件追記する'
);

select is(
  (
    select count(*)
      from public.task_occurrences occurrence
      join public.task_rules rule on rule.id = occurrence.task_rule_id
     where rule.title = '今回だけ点検'
       and occurrence.status = 'pending'
  ),
  0::bigint,
  '一回限りの完了後に次回Occurrenceを生成しない'
);

select is(
  (
    select count(*)
      from public.task_occurrences occurrence
      join public.task_rules rule on rule.id = occurrence.task_rule_id
     where rule.title = '今回だけ点検'
  ),
  1::bigint,
  '一回限りのTaskRuleには完了済みOccurrenceだけが残る'
);

select is(
  (
    select log.next_task_occurrence_id
      from public.activity_logs log
     where log.idempotency_key = '00000000-0000-0000-0000-0000000e0049'
  ),
  null::uuid,
  '一回限りの完了履歴は次回Occurrenceを参照しない'
);

select lives_ok(
  $$ select public.complete_maintenance_task(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '今回だけ点検'
       ),
       '00000000-0000-0000-0000-0000000e0049',
       '2026-08-10 03:00:00+00'
     ) $$,
  '一回限りの完了要求を同じ冪等性キーで再送できる'
);

select is(
  (
    select count(*)
      from public.activity_logs log
      join public.task_occurrences occurrence on occurrence.id = log.task_occurrence_id
      join public.task_rules rule on rule.id = occurrence.task_rule_id
     where rule.title = '今回だけ点検'
       and log.action = 'completed'
  ),
  1::bigint,
  '一回限りの完了再送でもActivityLogを重複作成しない'
);

reset role;

select throws_ok(
  $$ insert into public.task_rules (
       household_id, managed_item_id, title, recurrence_basis,
       deadline_kind, recommended_start_offset, recommended_until_offset
     ) values (
       '00000000-0000-0000-0000-00000000a001',
       '00000000-0000-0000-0000-0000000aa001',
       '不正な一回限り', 'once', 'maintenance', 0, 0
     ) $$,
  '23514',
  null,
  '一回限りをmaintenance期限方式では保存できない'
);

select throws_ok(
  $$ insert into public.task_rules (
       household_id, managed_item_id, title, recurrence_basis,
       deadline_kind, recommended_start_offset, recommended_until_offset
     ) values (
       '00000000-0000-0000-0000-00000000a001',
       '00000000-0000-0000-0000-0000000aa001',
       '不正な完了日基準', 'completion', 'strict', 28, 56
     ) $$,
  '23514',
  null,
  '完了日基準をstrict期限方式では保存できない'
);

select * from finish();

rollback;
