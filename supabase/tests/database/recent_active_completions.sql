-- Issue #106: 取消済みの完了を除外し、現在有効な完了だけを最近の実施へ返す。

create extension if not exists pgtap with schema extensions;

begin;

select plan(10);

select has_function(
  'public',
  'list_recent_active_completions',
  array['integer'],
  '現在有効な完了を取得するRPCが存在する'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.list_recent_active_completions(integer)',
    'execute'
  ),
  'authenticatedだけが取得RPCを実行できる'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.list_recent_active_completions(integer)',
    'execute'
  ),
  'anonは取得RPCを実行できない'
);

select ok(
  not has_function_privilege(
    'service_role',
    'public.list_recent_active_completions(integer)',
    'execute'
  ),
  'Service Roleにも取得RPCを公開しない'
);

-- 家庭A: 同一Occurrenceの旧完了と再完了、pendingへ戻った完了、上限確認用10件。
insert into public.task_rules (
  id, household_id, managed_item_id, title,
  recurrence_basis, deadline_kind, unresolved_policy,
  recommended_start_offset, recommended_until_offset
) values
  (
    '00000000-0000-0000-0000-0000000106a1',
    '00000000-0000-0000-0000-00000000a001',
    '00000000-0000-0000-0000-0000000aa001',
    '再完了の表示確認', 'completion', 'maintenance', 'carry_over', 1, 2
  ),
  (
    '00000000-0000-0000-0000-0000000106a2',
    '00000000-0000-0000-0000-00000000a001',
    '00000000-0000-0000-0000-0000000aa001',
    '最近10件の確認', 'completion', 'maintenance', 'carry_over', 1, 2
  );

insert into public.task_occurrences (
  id, household_id, task_rule_id, scheduled_for, due_at, status
) values
  (
    '00000000-0000-0000-0000-0000000106b1',
    '00000000-0000-0000-0000-00000000a001',
    '00000000-0000-0000-0000-0000000106a1',
    '2026-08-01 00:00:00+00', '2026-08-02 00:00:00+00', 'completed'
  ),
  (
    '00000000-0000-0000-0000-0000000106b2',
    '00000000-0000-0000-0000-00000000a001',
    '00000000-0000-0000-0000-0000000106a1',
    '2026-08-03 00:00:00+00', '2026-08-04 00:00:00+00', 'pending'
  );

insert into public.activity_logs (
  id, household_id, task_occurrence_id, action, actor_user_id,
  occurred_at, recorded_at, performed_by_user_id
) values
  (
    '00000000-0000-0000-0000-0000000106c1',
    '00000000-0000-0000-0000-00000000a001',
    '00000000-0000-0000-0000-0000000106b1',
    'completed', '00000000-0000-0000-0000-0000000a1001',
    '2026-08-30 00:00:00+00', '2026-08-10 00:00:00+00',
    '00000000-0000-0000-0000-0000000a1001'
  ),
  (
    '00000000-0000-0000-0000-0000000106c2',
    '00000000-0000-0000-0000-00000000a001',
    '00000000-0000-0000-0000-0000000106b1',
    'completed', '00000000-0000-0000-0000-0000000a1002',
    '2026-08-01 00:00:00+00', '2026-08-20 00:00:00+00',
    '00000000-0000-0000-0000-0000000a1002'
  ),
  (
    '00000000-0000-0000-0000-0000000106c3',
    '00000000-0000-0000-0000-00000000a001',
    '00000000-0000-0000-0000-0000000106b2',
    'completed', '00000000-0000-0000-0000-0000000a1001',
    '2026-08-31 00:00:00+00', '2026-08-21 00:00:00+00',
    '00000000-0000-0000-0000-0000000a1001'
  );

with occurrences as (
  insert into public.task_occurrences (
    household_id, task_rule_id, scheduled_for, due_at, status
  )
  select
    '00000000-0000-0000-0000-00000000a001'::uuid,
    '00000000-0000-0000-0000-0000000106a2'::uuid,
    '2026-07-01 00:00:00+00'::timestamptz + number * interval '1 day',
    '2026-07-02 00:00:00+00'::timestamptz + number * interval '1 day',
    'completed'
  from generate_series(1, 10) as number
  returning id, scheduled_for
)
insert into public.activity_logs (
  household_id, task_occurrence_id, action, actor_user_id,
  occurred_at, recorded_at, performed_by_user_id
)
select
  '00000000-0000-0000-0000-00000000a001'::uuid,
  id,
  'completed',
  '00000000-0000-0000-0000-0000000a1001'::uuid,
  '2026-08-09 00:00:00+00'::timestamptz
    + extract(day from scheduled_for)::integer * interval '1 day',
  '2026-08-22 00:00:00+00'::timestamptz
    + extract(day from scheduled_for)::integer * interval '1 minute',
  '00000000-0000-0000-0000-0000000a1001'::uuid
from occurrences;

-- 家庭B: 家庭Aの利用者からはRPC経由でも見えない。
insert into public.task_rules (
  id, household_id, managed_item_id, title,
  recurrence_basis, deadline_kind, unresolved_policy,
  recommended_start_offset, recommended_until_offset
) values (
  '00000000-0000-0000-0000-0000000106d1',
  '00000000-0000-0000-0000-00000000b001',
  '00000000-0000-0000-0000-0000000bb001',
  '家庭Bの完了', 'completion', 'maintenance', 'carry_over', 1, 2
);

insert into public.task_occurrences (
  id, household_id, task_rule_id, scheduled_for, due_at, status
) values (
  '00000000-0000-0000-0000-0000000106d2',
  '00000000-0000-0000-0000-00000000b001',
  '00000000-0000-0000-0000-0000000106d1',
  '2026-08-01 00:00:00+00', '2026-08-02 00:00:00+00', 'completed'
);

insert into public.activity_logs (
  id, household_id, task_occurrence_id, action, actor_user_id,
  occurred_at, recorded_at, performed_by_user_id
) values (
  '00000000-0000-0000-0000-0000000106d3',
  '00000000-0000-0000-0000-00000000b001',
  '00000000-0000-0000-0000-0000000106d2',
  'completed', '00000000-0000-0000-0000-0000000b1001',
  '2026-09-01 00:00:00+00', '2026-09-01 00:00:00+00',
  '00000000-0000-0000-0000-0000000b1001'
);

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000a1001", "role": "authenticated"}';

select is(
  (
    select activity_log_id
      from public.list_recent_active_completions(100)
     where task_occurrence_id = '00000000-0000-0000-0000-0000000106b1'
  ),
  '00000000-0000-0000-0000-0000000106c2'::uuid,
  '同じOccurrenceではrecorded_atが最新の再完了だけを返す'
);

select is(
  (
    select count(*)
      from public.list_recent_active_completions(100)
     where activity_log_id = '00000000-0000-0000-0000-0000000106c1'
  ),
  0::bigint,
  '取消済みの旧完了は返さない'
);

select is(
  (
    select count(*)
      from public.list_recent_active_completions(100)
     where task_occurrence_id = '00000000-0000-0000-0000-0000000106b2'
  ),
  0::bigint,
  'pendingへ戻ったOccurrenceの完了は返さない'
);

select is(
  (select count(*) from public.list_recent_active_completions(10)),
  10::bigint,
  '重複と取消済み完了を除外した後に上限10件を適用する'
);

select is(
  (select min(occurred_at) from public.list_recent_active_completions(10)),
  '2026-08-11 00:00:00+00'::timestamptz,
  '有効な完了だけをoccurred_at降順で選ぶ'
);

select is(
  (
    select count(*)
      from public.list_recent_active_completions(100)
     where task_rule_title = '家庭Bの完了'
  ),
  0::bigint,
  'RLSにより他家庭の完了は返さない'
);

select * from finish();

rollback;
