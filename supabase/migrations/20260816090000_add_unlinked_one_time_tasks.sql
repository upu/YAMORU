-- Issue #73: ManagedItemなしの一回限りTodoを家庭へ登録できるようにする。

alter table public.task_rules
  alter column managed_item_id drop not null,
  add constraint task_rules_unlinked_once_check check (
    managed_item_id is not null or recurrence_basis = 'once'
  );

comment on column public.task_rules.managed_item_id is
  'Todoに関連する任意のManagedItem。未設定は家庭共通Todoを表し、CHECK制約により一回限りだけを許可する。';

drop function public.create_one_time_task(uuid, text, timestamptz);

create function public.create_one_time_task(
  task_title text,
  scheduled_for timestamptz,
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

  if scheduled_for is null then
    raise exception using
      errcode = 'P0001',
      message = 'Scheduled date is required';
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
    'once',
    'strict',
    'carry_over',
    0,
    0
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
    scheduled_for,
    scheduled_for,
    'pending'
  );

  return new_task_rule_id;
end;
$$;

alter function public.create_one_time_task(
  text, timestamptz, uuid
) owner to postgres;
revoke all on function public.create_one_time_task(
  text, timestamptz, uuid
) from public, anon, service_role;
grant execute on function public.create_one_time_task(
  text, timestamptz, uuid
) to authenticated;

comment on function public.create_one_time_task(
  text, timestamptz, uuid
) is
  'auth.uid()の家庭へ一回限りのTaskRuleと最初のpending Occurrenceを原子的に作成する。item_idは任意で、指定時だけ同じ家庭のManagedItemか検証する。';
