-- Issue #106: 取消されていない現在有効な完了だけをホームへ返す。

create index activity_logs_completed_occurrence_recorded_idx
  on public.activity_logs (task_occurrence_id, recorded_at desc, id desc)
  where action = 'completed';

create or replace function public.list_recent_active_completions(
  max_results integer default 10
)
returns table (
  activity_log_id uuid,
  occurred_at timestamptz,
  recorded_at timestamptz,
  performed_by_user_id uuid,
  task_occurrence_id uuid,
  task_rule_title text,
  managed_item_id uuid,
  managed_item_name text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    active.activity_log_id,
    active.occurred_at,
    active.recorded_at,
    active.performed_by_user_id,
    active.task_occurrence_id,
    rule.title as task_rule_title,
    item.id as managed_item_id,
    item.name as managed_item_name
  from (
    select distinct on (log.task_occurrence_id)
      log.id as activity_log_id,
      log.occurred_at,
      log.recorded_at,
      log.performed_by_user_id,
      log.task_occurrence_id,
      occurrence.task_rule_id
    from public.activity_logs log
    join public.task_occurrences occurrence
      on occurrence.id = log.task_occurrence_id
     and occurrence.household_id = log.household_id
    where log.action = 'completed'
      and occurrence.status = 'completed'
    order by
      log.task_occurrence_id,
      log.recorded_at desc,
      log.id desc
  ) active
  join public.task_rules rule on rule.id = active.task_rule_id
  left join public.managed_items item on item.id = rule.managed_item_id
  order by
    active.occurred_at desc,
    active.recorded_at desc,
    active.activity_log_id desc
  limit least(
    greatest(coalesce(max_results, 10), 0),
    100
  );
$$;

comment on function public.list_recent_active_completions(integer) is
  'completed状態のOccurrenceごとにrecorded_atが最新の完了だけを、実施日時順で返す(YDR-012, YDR-015)。';

alter function public.list_recent_active_completions(integer) owner to postgres;
revoke all on function public.list_recent_active_completions(integer)
  from public, anon, service_role;
grant execute on function public.list_recent_active_completions(integer)
  to authenticated;
