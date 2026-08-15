-- Issue #49: ManagedItemにひも付く一回限りTodoを追加する。

alter table public.task_rules
  drop constraint task_rules_recurrence_basis_check,
  drop constraint task_rules_deadline_kind_check;

alter table public.task_rules
  add constraint task_rules_recurrence_basis_check check (
    recurrence_basis in ('completion', 'once')
  ),
  add constraint task_rules_deadline_kind_check check (
    deadline_kind in ('maintenance', 'strict')
  ),
  add constraint task_rules_recurrence_configuration_check check (
    (
      recurrence_basis = 'completion'
      and deadline_kind = 'maintenance'
    )
    or (
      recurrence_basis = 'once'
      and deadline_kind = 'strict'
      and recommended_start_offset = 0
      and recommended_until_offset = 0
    )
  );

comment on table public.task_rules is
  'Todoの定義。recurrence_basisで完了日基準の繰り返しと一回限りを明示的に区別する。';
comment on column public.task_rules.recurrence_basis is
  'Todoの繰り返し方式。completionは完了日基準、onceは一回限り。';

create or replace function public.create_one_time_task(
  item_id uuid,
  task_title text,
  scheduled_for timestamptz
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

  if not exists (
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
  uuid, text, timestamptz
) owner to postgres;
revoke all on function public.create_one_time_task(
  uuid, text, timestamptz
) from public, anon, service_role;
grant execute on function public.create_one_time_task(
  uuid, text, timestamptz
) to authenticated;

comment on function public.create_one_time_task(
  uuid, text, timestamptz
) is
  'auth.uid()の家庭に属するManagedItemへ一回限りTaskRuleと最初のpending Occurrenceを原子的に作成する。';

create or replace function public.complete_maintenance_task(
  occurrence_id uuid,
  idempotency_key uuid,
  occurred_at timestamptz default null,
  performed_by_user_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  acting_user_id uuid := auth.uid();
  resolved_performer_user_id uuid;
  actual_occurred_at timestamptz := coalesce(occurred_at, now());
  current_household_id uuid;
  current_task_rule_id uuid;
  current_recurrence_basis text;
  start_offset integer;
  until_offset integer;
  next_scheduled_for timestamptz;
  next_due_at timestamptz;
  next_occurrence_id uuid;
  replay_occurrence_id uuid;
  replay_performer_user_id uuid;
  updated_count integer;
begin
  if acting_user_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'Authentication required';
  end if;

  if idempotency_key is null then
    raise exception using
      errcode = 'P0001',
      message = 'Idempotency key is required';
  end if;

  resolved_performer_user_id := coalesce(
    performed_by_user_id, acting_user_id
  );

  select log.next_task_occurrence_id, log.task_occurrence_id, log.performed_by_user_id
    into next_occurrence_id, replay_occurrence_id, replay_performer_user_id
    from public.activity_logs log
    join public.household_members member
      on member.household_id = log.household_id
     and member.user_id = acting_user_id
   where log.idempotency_key = complete_maintenance_task.idempotency_key
     and log.action = 'completed';

  if found then
    if replay_occurrence_id is distinct from occurrence_id
        or replay_performer_user_id is distinct from resolved_performer_user_id then
      raise exception using
        errcode = 'P0001',
        message = 'Idempotency key was already used for a different occurrence';
    end if;
    return next_occurrence_id;
  end if;

  select occurrence.household_id, occurrence.task_rule_id
    into current_household_id, current_task_rule_id
    from public.task_occurrences occurrence
    join public.household_members member
      on member.household_id = occurrence.household_id
     and member.user_id = acting_user_id
   where occurrence.id = occurrence_id;

  if current_household_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'Occurrence not found';
  end if;

  if actual_occurred_at > now() then
    raise exception using
      errcode = 'P0001',
      message = 'occurred_at must not be in the future';
  end if;

  if performed_by_user_id is not null and not exists (
    select 1
      from public.household_members member
     where member.household_id = current_household_id
       and member.user_id = complete_maintenance_task.performed_by_user_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Performer not found';
  end if;

  update public.task_occurrences
     set status = 'completed'
   where id = occurrence_id
     and status = 'pending';

  get diagnostics updated_count = row_count;

  if updated_count = 0 then
    select log.next_task_occurrence_id, log.performed_by_user_id
      into next_occurrence_id, replay_performer_user_id
      from public.activity_logs log
     where log.idempotency_key = complete_maintenance_task.idempotency_key
       and log.action = 'completed'
       and log.task_occurrence_id = occurrence_id;

    if found then
      if replay_performer_user_id is distinct from resolved_performer_user_id then
        raise exception using
          errcode = 'P0001',
          message = 'Idempotency key was already used for a different occurrence';
      end if;
      return next_occurrence_id;
    end if;

    raise exception using
      errcode = 'P0001',
      message = 'Occurrence is not pending';
  end if;

  select rule.recurrence_basis,
         rule.recommended_start_offset,
         rule.recommended_until_offset
    into current_recurrence_basis, start_offset, until_offset
    from public.task_rules rule
   where rule.id = current_task_rule_id;

  if current_recurrence_basis = 'once' then
    insert into public.activity_logs (
      household_id, task_occurrence_id, action, actor_user_id,
      occurred_at, idempotency_key, next_task_occurrence_id, performed_by_user_id
    ) values (
      current_household_id, occurrence_id, 'completed', acting_user_id,
      actual_occurred_at, idempotency_key, null, resolved_performer_user_id
    );

    return null;
  end if;

  if current_recurrence_basis <> 'completion' then
    raise exception using
      errcode = 'P0001',
      message = 'Unsupported recurrence basis';
  end if;

  -- Phase 2では家庭のタイムゾーンをAsia/Tokyoに固定する。
  next_scheduled_for :=
    ((actual_occurred_at at time zone 'Asia/Tokyo')::date + start_offset)
      ::timestamp at time zone 'Asia/Tokyo';
  next_due_at :=
    ((actual_occurred_at at time zone 'Asia/Tokyo')::date + until_offset)
      ::timestamp at time zone 'Asia/Tokyo';

  if exists (
    select 1
      from public.task_occurrences occurrence
     where occurrence.task_rule_id = current_task_rule_id
       and occurrence.scheduled_for = next_scheduled_for
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Next occurrence already exists for the computed schedule';
  end if;

  insert into public.task_occurrences (
    household_id, task_rule_id, scheduled_for, due_at, status
  ) values (
    current_household_id, current_task_rule_id,
    next_scheduled_for, next_due_at, 'pending'
  )
  returning id into next_occurrence_id;

  insert into public.activity_logs (
    household_id, task_occurrence_id, action, actor_user_id,
    occurred_at, idempotency_key, next_task_occurrence_id, performed_by_user_id
  ) values (
    current_household_id, occurrence_id, 'completed', acting_user_id,
    actual_occurred_at, idempotency_key, next_occurrence_id, resolved_performer_user_id
  );

  return next_occurrence_id;
end;
$$;

comment on function public.complete_maintenance_task(
  uuid, uuid, timestamptz, uuid
) is
  '自家庭のpending Todoを原子的に完了する。完了日基準は次回Occurrenceを生成し、一回限りはActivityLogだけを追記する。';
