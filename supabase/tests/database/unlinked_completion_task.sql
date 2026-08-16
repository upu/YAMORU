-- Issue #93: ManagedItemなしの完了日基準Todo作成と次回生成を検証する。
-- fixtureはsupabase/seed.sqlの架空データだけを使う。

create extension if not exists pgtap with schema extensions;

begin;

select plan(13);

select has_function(
  'public',
  'create_maintenance_task',
  array['text', 'integer', 'integer', 'timestamp with time zone', 'timestamp with time zone', 'uuid'],
  '任意のManagedItemを末尾に受け取る完了日基準Todo作成RPCが存在する'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.create_maintenance_task(text,integer,integer,timestamp with time zone,timestamp with time zone,uuid)',
    'execute'
  ),
  'authenticatedだけが作成RPCを実行できる'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.create_maintenance_task(text,integer,integer,timestamp with time zone,timestamp with time zone,uuid)',
    'execute'
  ),
  'anonは作成RPCを実行できない'
);

select ok(
  not exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.task_rules'::regclass
       and conname = 'task_rules_unlinked_once_check'
  ),
  '管理対象なしを一回限りへ限定する制約がない'
);

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000a1001", "role": "authenticated"}';

select isnt_empty(
  $$ select public.create_maintenance_task(
       task_title => ' 換気扇の掃除 ',
       recommended_start_offset => 7,
       recommended_until_offset => 14,
       first_scheduled_for => '2026-08-09 15:00:00+00',
       first_due_at => '2026-08-16 15:00:00+00'
     ) $$,
  '管理対象なしの完了日基準Todoを作成できる'
);

select results_eq(
  $$ select managed_item_id, title, recurrence_basis, deadline_kind,
            recommended_start_offset, recommended_until_offset
       from public.task_rules
      where title = '換気扇の掃除' $$,
  $$ values (null::uuid, '換気扇の掃除'::text, 'completion'::text,
             'maintenance'::text, 7, 14) $$,
  'TaskRuleへ管理対象なしと完了日基準の設定を保存する'
);

select results_eq(
  $$ select occurrence.status, occurrence.scheduled_for, occurrence.due_at
       from public.task_occurrences occurrence
       join public.task_rules rule on rule.id = occurrence.task_rule_id
      where rule.title = '換気扇の掃除' $$,
  $$ values ('pending'::text, '2026-08-09 15:00:00+00'::timestamptz,
             '2026-08-16 15:00:00+00'::timestamptz) $$,
  '最初のpending Occurrenceを作成する'
);

select lives_ok(
  $$ select public.complete_maintenance_task(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '換気扇の掃除'
            and occurrence.status = 'pending'
       ),
       '00000000-0000-0000-0000-0000000e0093',
       '2026-08-10 03:00:00+00'
     ) $$,
  '管理対象なしでも完了日基準Todoを完了できる'
);

select results_eq(
  $$ select occurrence.status, occurrence.scheduled_for, occurrence.due_at
       from public.task_occurrences occurrence
       join public.task_rules rule on rule.id = occurrence.task_rule_id
      where rule.title = '換気扇の掃除'
        and occurrence.status = 'pending' $$,
  $$ values ('pending'::text, '2026-08-16 15:00:00+00'::timestamptz,
             '2026-08-23 15:00:00+00'::timestamptz) $$,
  '実施日のAsia/Tokyo暦日から次回Occurrenceを1件生成する'
);

select isnt(
  (
    select log.next_task_occurrence_id
      from public.activity_logs log
     where log.idempotency_key = '00000000-0000-0000-0000-0000000e0093'
  ),
  null::uuid,
  '完了履歴から生成した次回Occurrenceを参照する'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000b1001", "role": "authenticated"}';

select is(
  (select count(*) from public.task_rules where title = '換気扇の掃除'),
  0::bigint,
  '別家庭から管理対象なしのTaskRuleを参照できない'
);

select throws_ok(
  $$ select public.create_maintenance_task(
       task_title => '他家庭の対象へ登録',
       recommended_start_offset => 7,
       recommended_until_offset => 14,
       first_scheduled_for => '2026-08-09 15:00:00+00',
       first_due_at => '2026-08-16 15:00:00+00',
       item_id => '00000000-0000-0000-0000-0000000aa001'
     ) $$,
  'P0001',
  'Managed item not found',
  '他家庭のManagedItemは関連付けられない'
);

select is(
  (
    select count(*)
      from public.task_occurrences occurrence
      join public.task_rules rule on rule.id = occurrence.task_rule_id
     where rule.title = '換気扇の掃除'
       and occurrence.status = 'pending'
  ),
  0::bigint,
  '別家庭から次回Occurrenceを参照できない'
);

reset role;

select * from finish();

rollback;
