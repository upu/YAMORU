-- Issue #34: 完了日基準メンテナンスTodoのスキーマ、限定RPC、家庭間分離を検証する。
-- fixtureはsupabase/seed.sqlの架空データだけを使う。

create extension if not exists pgtap with schema extensions;

begin;

select plan(46);

select has_function(
  'public',
  'create_maintenance_task',
  array['uuid', 'text', 'integer', 'integer', 'timestamp with time zone', 'timestamp with time zone'],
  'TaskRuleと最初のOccurrenceを原子的に作成するRPCが存在する'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.create_maintenance_task(uuid,text,integer,integer,timestamp with time zone,timestamp with time zone)',
    'execute'
  ),
  'authenticatedだけが作成RPCを実行できる'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.create_maintenance_task(uuid,text,integer,integer,timestamp with time zone,timestamp with time zone)',
    'execute'
  ),
  'anonは作成RPCを実行できない'
);

select ok(
  not has_function_privilege(
    'service_role',
    'public.create_maintenance_task(uuid,text,integer,integer,timestamp with time zone,timestamp with time zone)',
    'execute'
  ),
  'Service Roleにも作成RPCを公開しない'
);

select has_table('public', 'task_rules', 'TaskRuleテーブルが存在する');
select has_table('public', 'task_occurrences', 'TaskOccurrenceテーブルが存在する');
select has_table('public', 'activity_logs', 'ActivityLogテーブルが存在する');

select is(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.task_rules'::regclass),
  true,
  'TaskRuleでRLSが有効である'
);
select is(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.task_occurrences'::regclass),
  true,
  'TaskOccurrenceでRLSが有効である'
);
select is(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.activity_logs'::regclass),
  true,
  'ActivityLogでRLSが有効である'
);

select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.task_rules'::regclass
       and conname = 'task_rules_recommended_offsets_check'
       and contype = 'c'
  ),
  '推奨開始・上限オフセットのCHECK制約がある'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.task_rules'::regclass
       and conname = 'task_rules_item_household_fkey'
       and contype = 'f'
  ),
  'ManagedItemとTaskRuleの家庭IDを複合外部キーで一致させる'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.task_occurrences'::regclass
       and conname = 'task_occurrences_rule_household_fkey'
       and contype = 'f'
  ),
  'TaskRuleとTaskOccurrenceの家庭IDを複合外部キーで一致させる'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.activity_logs'::regclass
       and conname = 'activity_logs_occurrence_household_fkey'
       and contype = 'f'
  ),
  'TaskOccurrenceとActivityLogの家庭IDを複合外部キーで一致させる'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.task_occurrences'::regclass
       and conname = 'task_occurrences_rule_scheduled_key'
       and contype = 'u'
  ),
  '同じTaskRule・scheduled_forの一意制約がある'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_indexes
     where schemaname = 'public'
       and indexname = 'task_occurrences_one_pending_per_rule_idx'
       and indexdef like '%WHERE (status = ''pending''::text)%'
  ),
  'TaskRuleごとのpendingを最大1件にする部分一意制約がある'
);

select ok(
  not has_table_privilege('authenticated', 'public.task_rules', 'insert'),
  'TaskRuleの直接INSERTを許可せず作成をRPCへ限定する'
);
select ok(
  not has_table_privilege('authenticated', 'public.task_occurrences', 'insert'),
  'TaskOccurrenceの直接INSERTを許可せず作成をRPCへ限定する'
);
select ok(
  not has_table_privilege('authenticated', 'public.activity_logs', 'insert'),
  'ActivityLogの直接INSERTを許可しない'
);

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000a1001", "role": "authenticated"}';

select isnt_empty(
  $$ select public.create_maintenance_task(
       '00000000-0000-0000-0000-0000000aa001',
       '  フィルター交換  ',
       28,
       56,
       '2026-10-08 15:00:00+00',
       '2026-11-05 15:00:00+00'
     ) $$,
  '家庭AのManagedItemへメンテナンスTodoを登録できる'
);

select results_eq(
  $$ select title, recurrence_basis, deadline_kind,
            recommended_start_offset, recommended_until_offset
       from public.task_rules
      where title = 'フィルター交換' $$,
  $$ values ('フィルター交換'::text, 'completion'::text, 'maintenance'::text, 28, 56) $$,
  'TaskRuleへ整形済みタイトルと限定されたルールを保存する'
);

select results_eq(
  $$ select occurrence.status, occurrence.scheduled_for, occurrence.due_at
       from public.task_occurrences occurrence
       join public.task_rules rule on rule.id = occurrence.task_rule_id
      where rule.title = 'フィルター交換' $$,
  $$ values (
       'pending'::text,
       '2026-10-08 15:00:00+00'::timestamptz,
       '2026-11-05 15:00:00+00'::timestamptz
     ) $$,
  '最初のpending Occurrenceへscheduled_forとdue_atを別々にUTC保存する'
);

select is(
  (
    select count(*)
      from public.task_rules rule
      join public.managed_items item on item.id = rule.managed_item_id
      join public.task_occurrences occurrence on occurrence.task_rule_id = rule.id
     where rule.household_id = item.household_id
       and occurrence.household_id = rule.household_id
       and rule.title = 'フィルター交換'
  ),
  1::bigint,
  'ManagedItem、TaskRule、Occurrenceは同じ家庭IDで作成される'
);

select is(
  (select count(*) from public.activity_logs),
  0::bigint,
  '登録時点ではActivityLogを作成しない'
);

select is(
  (select count(*) from public.task_rules where title = 'フィルター交換'),
  1::bigint,
  '家庭Aは自家庭のTaskRuleを参照できる'
);

select ok(
  not has_table_privilege('authenticated', 'public.task_rules', 'update'),
  'TaskRuleの直接更新を許可しない'
);

select ok(
  not has_table_privilege('authenticated', 'public.task_occurrences', 'update'),
  'TaskOccurrenceの直接更新を許可しない'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000b1001", "role": "authenticated"}';

select is_empty(
  $$ select id from public.task_rules where title = 'フィルター交換' $$,
  '家庭Bは家庭AのTaskRuleを参照できない'
);
select is_empty(
  $$ select occurrence.id
      from public.task_occurrences occurrence
       join public.task_rules rule on rule.id = occurrence.task_rule_id
      where rule.title = 'フィルター交換' $$,
  '家庭Bは家庭AのTaskOccurrenceを参照できない'
);
select throws_ok(
  $$ update public.task_rules
        set title = '家庭Bから変更'
      where title = 'フィルター交換'
      returning id $$,
  '42501',
  null,
  '家庭Bは家庭AのTaskRuleを変更できない（直接更新権限なし）'
);
select throws_ok(
  $$ update public.task_occurrences
        set due_at = '2027-01-01 00:00:00+00'
      where task_rule_id in (
        select id from public.task_rules where title = 'フィルター交換'
      )
      returning id $$,
  '42501',
  null,
  '家庭Bは家庭AのTaskOccurrenceを変更できない（直接更新権限なし）'
);

select throws_ok(
  $$ select public.create_maintenance_task(
       '00000000-0000-0000-0000-0000000aa001',
       '他家庭への登録', 28, 56,
       '2026-10-08 15:00:00+00', '2026-11-05 15:00:00+00'
     ) $$,
  'P0001',
  'Managed item not found',
  '家庭Bは家庭AのManagedItemへTodoを登録できない'
);

reset role;
set local role anon;

select throws_ok(
  $$ select * from public.task_rules $$,
  '42501',
  null,
  '未認証利用者はTaskRuleを参照できない'
);
select throws_ok(
  $$ select public.create_maintenance_task(
       '00000000-0000-0000-0000-0000000aa001',
       '未認証', 28, 56,
       '2026-10-08 15:00:00+00', '2026-11-05 15:00:00+00'
     ) $$,
  '42501',
  null,
  '未認証利用者は作成RPCを実行できない'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000c1001", "role": "authenticated"}';

select throws_ok(
  $$ select public.create_maintenance_task(
       '00000000-0000-0000-0000-0000000aa001',
       '家庭未所属', 28, 56,
       '2026-10-08 15:00:00+00', '2026-11-05 15:00:00+00'
     ) $$,
  'P0001',
  'Household membership required',
  '家庭未所属の利用者はTodoを登録できない'
);
select is_empty(
  $$ select id from public.task_rules $$,
  '家庭未所属の利用者はTodoを参照できない'
);

reset role;

select throws_ok(
  $$ insert into public.task_rules (
       household_id, managed_item_id, title, recurrence_basis,
       deadline_kind, recommended_start_offset, recommended_until_offset
     ) values (
       '00000000-0000-0000-0000-00000000a001',
       '00000000-0000-0000-0000-0000000bb001',
       '家庭不一致', 'completion', 'maintenance', 28, 56
     ) $$,
  '23503',
  null,
  '異なる家庭のManagedItemとTaskRuleを関連付けられない'
);

select throws_ok(
  $$ insert into public.task_occurrences (
       household_id, task_rule_id, scheduled_for, due_at, status
     ) select
       '00000000-0000-0000-0000-00000000b001',
       rule.id,
       '2027-01-01 00:00:00+00',
       '2027-01-02 00:00:00+00',
       'completed'
       from public.task_rules rule
      where rule.title = 'フィルター交換'
        and rule.managed_item_id = '00000000-0000-0000-0000-0000000aa001' $$,
  '23503',
  null,
  '異なる家庭のTaskRuleとOccurrenceを関連付けられない'
);

-- action='completed'の行はperformed_by_user_idを伴う不変条件(YDR-020)を満たすため、
-- 操作主体と同じ値を実施者として入れる。この行自体はFK分離の検証用フィクスチャで
-- あり、実施者機能そのものの検証はcomplete_maintenance_task.sqlで行う。
insert into public.activity_logs (
  household_id, task_occurrence_id, action, actor_user_id, occurred_at,
  performed_by_user_id
)
select
  '00000000-0000-0000-0000-00000000a001',
  occurrence.id,
  'completed',
  '00000000-0000-0000-0000-0000000a1001',
  '2026-10-08 12:00:00+00',
  '00000000-0000-0000-0000-0000000a1001'
from public.task_occurrences occurrence
join public.task_rules rule on rule.id = occurrence.task_rule_id
where rule.title = 'フィルター交換'
  and rule.managed_item_id = '00000000-0000-0000-0000-0000000aa001';

select throws_ok(
  $$ insert into public.activity_logs (
       household_id, task_occurrence_id, action, actor_user_id, occurred_at,
       performed_by_user_id
     ) select
       '00000000-0000-0000-0000-00000000b001',
       occurrence.id,
       'completed',
       '00000000-0000-0000-0000-0000000b1001',
       '2026-10-08 12:00:00+00',
       '00000000-0000-0000-0000-0000000b1001'
       from public.task_occurrences occurrence
       join public.task_rules rule on rule.id = occurrence.task_rule_id
      where rule.title = 'フィルター交換'
        and rule.managed_item_id = '00000000-0000-0000-0000-0000000aa001' $$,
  '23503',
  null,
  '異なる家庭のOccurrenceとActivityLogを関連付けられない'
);

select throws_ok(
  $$ insert into public.task_rules (
       household_id, managed_item_id, title, recurrence_basis,
       deadline_kind, recommended_start_offset, recommended_until_offset
     ) values (
       '00000000-0000-0000-0000-00000000a001',
       '00000000-0000-0000-0000-0000000aa001',
       '負の日数', 'completion', 'maintenance', -1, 56
     ) $$,
  '23514',
  null,
  '推奨開始オフセットは0日以上に制限する'
);

select throws_ok(
  $$ insert into public.task_rules (
       household_id, managed_item_id, title, recurrence_basis,
       deadline_kind, recommended_start_offset, recommended_until_offset
     ) values (
       '00000000-0000-0000-0000-00000000a001',
       '00000000-0000-0000-0000-0000000aa001',
       '大小逆転', 'completion', 'maintenance', 57, 56
     ) $$,
  '23514',
  null,
  '推奨上限オフセットを開始以上に制限する'
);

select throws_ok(
  $$ insert into public.task_occurrences (
       household_id, task_rule_id, scheduled_for, due_at, status
     ) select
       rule.household_id, rule.id,
       '2027-01-03 00:00:00+00',
       '2027-01-02 00:00:00+00',
       'completed'
       from public.task_rules rule
      where rule.title = 'フィルター交換'
        and rule.managed_item_id = '00000000-0000-0000-0000-0000000aa001' $$,
  '23514',
  null,
  '最初の推奨期間は開始を上限以前に制限する'
);

select throws_ok(
  $$ insert into public.task_occurrences (
       household_id, task_rule_id, scheduled_for, due_at, status
     ) select
       rule.household_id, rule.id,
       '2027-01-01 00:00:00+00',
       '2027-01-02 00:00:00+00',
       'pending'
       from public.task_rules rule
      where rule.title = 'フィルター交換'
        and rule.managed_item_id = '00000000-0000-0000-0000-0000000aa001' $$,
  '23505',
  null,
  '同じTaskRuleへpending Occurrenceを2件作成できない'
);

select throws_ok(
  $$ insert into public.task_occurrences (
       household_id, task_rule_id, scheduled_for, due_at, status
     ) select
       rule.household_id, rule.id,
       occurrence.scheduled_for,
       occurrence.due_at,
       'completed'
       from public.task_rules rule
       join public.task_occurrences occurrence on occurrence.task_rule_id = rule.id
      where rule.title = 'フィルター交換'
        and rule.managed_item_id = '00000000-0000-0000-0000-0000000aa001'
      limit 1 $$,
  '23505',
  null,
  '同じTaskRule・scheduled_forのOccurrenceを重複作成できない'
);

create function public.reject_atomicity_test_occurrence()
returns trigger
language plpgsql
as $$
begin
  if new.scheduled_for = '2099-12-30 15:00:00+00'::timestamptz then
    raise exception 'atomicity test failure';
  end if;
  return new;
end;
$$;

create trigger reject_atomicity_test_occurrence
before insert on public.task_occurrences
for each row execute function public.reject_atomicity_test_occurrence();

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000a1001", "role": "authenticated"}';

select throws_ok(
  $$ select public.create_maintenance_task(
       '00000000-0000-0000-0000-0000000aa001',
       '原子性テスト', 28, 56,
       '2099-12-30 15:00:00+00', '2099-12-31 15:00:00+00'
     ) $$,
  'P0001',
  'atomicity test failure',
  'Occurrence作成失敗時はRPC全体が失敗する'
);

reset role;

select is(
  (select count(*) from public.task_rules where title = '原子性テスト'),
  0::bigint,
  'Occurrence作成失敗時にTaskRuleだけを残さない'
);

select * from finish();

rollback;
