-- Issue #93: 管理対象の有無と完了日基準の繰り返し方式を独立させる。

alter table public.task_rules
  drop constraint task_rules_unlinked_once_check;

comment on column public.task_rules.managed_item_id is
  'Todoに関連する任意のManagedItem。未設定は特定の管理対象にひも付かないTodoを表す。';

drop function public.create_maintenance_task(
  uuid, text, integer, integer, timestamptz, timestamptz
);

create function public.create_maintenance_task(
  task_title text,
  recommended_start_offset integer,
  recommended_until_offset integer,
  first_scheduled_for timestamptz,
  first_due_at timestamptz,
  item_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  creating_user_id uuid := auth.uid();
  current_household_id uuid;
  normalized_title text := pg_catalog.btrim(task_title);
  new_task_rule_id uuid;
begin
  if creating_user_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'Authentication required';
  end if;

  select member.household_id
    into current_household_id
    from public.household_members member
   where member.user_id = creating_user_id;

  if current_household_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'Household membership required';
  end if;

  if item_id is not null and not exists (
    select 1
      from public.managed_items item
     where item.id = item_id
       and item.household_id = current_household_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Managed item not found';
  end if;

  if normalized_title is null
     or pg_catalog.char_length(normalized_title) not between 1 and 100 then
    raise exception using
      errcode = 'P0001',
      message = 'Task title must be between 1 and 100 characters';
  end if;

  if recommended_start_offset is null
     or recommended_until_offset is null
     or recommended_start_offset not between 0 and 3650
     or recommended_until_offset not between recommended_start_offset and 3650 then
    raise exception using
      errcode = 'P0001',
      message = 'Invalid recommended offsets';
  end if;

  if first_scheduled_for is null
     or first_due_at is null
     or first_scheduled_for > first_due_at then
    raise exception using
      errcode = 'P0001',
      message = 'Invalid first recommended window';
  end if;

  insert into public.task_rules (
    household_id,
    managed_item_id,
    title,
    recurrence_basis,
    deadline_kind,
    unresolved_policy,
    recommended_start_offset,
    recommended_until_offset
  ) values (
    current_household_id,
    item_id,
    normalized_title,
    'completion',
    'maintenance',
    'carry_over',
    recommended_start_offset,
    recommended_until_offset
  )
  returning id into new_task_rule_id;

  insert into public.task_occurrences (
    household_id,
    task_rule_id,
    scheduled_for,
    due_at,
    status
  ) values (
    current_household_id,
    new_task_rule_id,
    first_scheduled_for,
    first_due_at,
    'pending'
  );

  return new_task_rule_id;
end;
$$;

alter function public.create_maintenance_task(
  text, integer, integer, timestamptz, timestamptz, uuid
) owner to postgres;
revoke all on function public.create_maintenance_task(
  text, integer, integer, timestamptz, timestamptz, uuid
) from public, anon, service_role;
grant execute on function public.create_maintenance_task(
  text, integer, integer, timestamptz, timestamptz, uuid
) to authenticated;

comment on function public.create_maintenance_task(
  text, integer, integer, timestamptz, timestamptz, uuid
) is
  'auth.uid()の家庭へ完了日基準TaskRuleと最初のpending Occurrenceを原子的に作成する。ManagedItemは任意で、指定時は同じ家庭に限る。';
