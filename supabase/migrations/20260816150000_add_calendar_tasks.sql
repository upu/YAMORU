-- Issue #50: Asia/Tokyoの暦規則で繰り返す定例日基準Todoを追加する。

alter table public.task_rules
  add column schedule_kind text,
  add column schedule_day_of_week integer,
  add column schedule_day_of_month integer,
  add column schedule_week_of_month integer,
  add column schedule_month integer;

alter table public.task_rules
  drop constraint task_rules_recurrence_basis_check,
  drop constraint task_rules_recurrence_configuration_check,
  add constraint task_rules_recurrence_basis_check check (
    recurrence_basis in ('completion', 'once', 'calendar')
  ),
  add constraint task_rules_recurrence_configuration_check check (
    (
      recurrence_basis = 'completion'
      and deadline_kind = 'maintenance'
    )
    or (
      recurrence_basis in ('once', 'calendar')
      and deadline_kind = 'strict'
      and recommended_start_offset = 0
      and recommended_until_offset = 0
    )
  ),
  add constraint task_rules_calendar_schedule_check check (
    (
      recurrence_basis <> 'calendar'
      and schedule_kind is null
      and schedule_day_of_week is null
      and schedule_day_of_month is null
      and schedule_week_of_month is null
      and schedule_month is null
    )
    or (
      recurrence_basis = 'calendar'
      and schedule_kind is not null
      and (
        (
          schedule_kind = 'weekly'
          and schedule_day_of_week is not null
          and schedule_day_of_week between 1 and 7
          and schedule_day_of_month is null
          and schedule_week_of_month is null
          and schedule_month is null
        )
        or (
          schedule_kind = 'monthly_day'
          and schedule_day_of_week is null
          and schedule_day_of_month is not null
          and schedule_day_of_month between 1 and 31
          and schedule_week_of_month is null
          and schedule_month is null
        )
        or (
          schedule_kind = 'monthly_nth_weekday'
          and schedule_day_of_week is not null
          and schedule_day_of_week between 1 and 7
          and schedule_day_of_month is null
          and schedule_week_of_month is not null
          and schedule_week_of_month between 1 and 5
          and schedule_month is null
        )
        or (
          schedule_kind = 'yearly'
          and schedule_day_of_week is null
          and schedule_day_of_month is not null
          and schedule_day_of_month between 1 and case
            when schedule_month = 2 then 29
            when schedule_month in (4, 6, 9, 11) then 30
            else 31
          end
          and schedule_week_of_month is null
          and schedule_month is not null
          and schedule_month between 1 and 12
        )
      )
    )
  );

comment on table public.task_rules is
  'Todoの定義。recurrence_basisで完了日基準、一回限り、定例日基準を区別する。';
comment on column public.task_rules.recurrence_basis is
  'Todoの繰り返し方式。completionは完了日基準、onceは一回限り、calendarは定例日基準。';
comment on column public.task_rules.schedule_kind is
  '定例日基準の種類。weekly、monthly_day、monthly_nth_weekday、yearlyのいずれか。';
comment on column public.task_rules.schedule_day_of_week is
  'ISO曜日。月曜日を1、日曜日を7とする。';
comment on column public.task_rules.schedule_day_of_month is
  '月内の日付。存在しない月日はYDR-021に従って補正する。';
comment on column public.task_rules.schedule_week_of_month is
  '月内の第N曜日のN。1から5。';
comment on column public.task_rules.schedule_month is
  '年次規則の月。1から12。';

create function public._calendar_scheduled_for_on_or_after(
  schedule_kind text,
  schedule_day_of_week integer,
  schedule_day_of_month integer,
  schedule_week_of_month integer,
  schedule_month integer,
  on_or_after date
)
returns timestamptz
language plpgsql
immutable
set search_path = ''
as $$
declare
  candidate_date date;
  first_weekday integer;
  last_day date;
  month_start date;
  target_year integer;
begin
  if on_or_after is null then
    raise exception using errcode = 'P0001', message = 'Invalid calendar schedule';
  end if;

  case schedule_kind
    when 'weekly' then
      if schedule_day_of_week is null
          or schedule_day_of_week not between 1 and 7
          or schedule_day_of_month is not null
          or schedule_week_of_month is not null
          or schedule_month is not null then
        raise exception using errcode = 'P0001', message = 'Invalid calendar schedule';
      end if;
      candidate_date := on_or_after + pg_catalog.mod(
        schedule_day_of_week - extract(isodow from on_or_after)::integer + 7,
        7
      );

    when 'monthly_day' then
      if schedule_day_of_week is not null
          or schedule_day_of_month is null
          or schedule_day_of_month not between 1 and 31
          or schedule_week_of_month is not null
          or schedule_month is not null then
        raise exception using errcode = 'P0001', message = 'Invalid calendar schedule';
      end if;
      month_start := pg_catalog.date_trunc('month', on_or_after)::date;
      loop
        last_day := (month_start + interval '1 month - 1 day')::date;
        candidate_date := month_start + (
          least(schedule_day_of_month, extract(day from last_day)::integer) - 1
        );
        exit when candidate_date >= on_or_after;
        month_start := (month_start + interval '1 month')::date;
      end loop;

    when 'monthly_nth_weekday' then
      if schedule_day_of_week is null
          or schedule_day_of_week not between 1 and 7
          or schedule_day_of_month is not null
          or schedule_week_of_month is null
          or schedule_week_of_month not between 1 and 5
          or schedule_month is not null then
        raise exception using errcode = 'P0001', message = 'Invalid calendar schedule';
      end if;
      month_start := pg_catalog.date_trunc('month', on_or_after)::date;
      loop
        first_weekday := extract(isodow from month_start)::integer;
        candidate_date := month_start
          + pg_catalog.mod(schedule_day_of_week - first_weekday + 7, 7)
          + (schedule_week_of_month - 1) * 7;
        if extract(month from candidate_date) = extract(month from month_start)
            and candidate_date >= on_or_after then
          exit;
        end if;
        month_start := (month_start + interval '1 month')::date;
      end loop;

    when 'yearly' then
      if schedule_day_of_week is not null
          or schedule_month is null
          or schedule_month not between 1 and 12
          or schedule_day_of_month is null
          or schedule_day_of_month < 1
          or schedule_day_of_month > (case
            when schedule_month = 2 then 29
            when schedule_month in (4, 6, 9, 11) then 30
            else 31
          end)
          or schedule_week_of_month is not null then
        raise exception using errcode = 'P0001', message = 'Invalid calendar schedule';
      end if;
      target_year := extract(year from on_or_after)::integer;
      loop
        month_start := pg_catalog.make_date(target_year, schedule_month, 1);
        last_day := (month_start + interval '1 month - 1 day')::date;
        candidate_date := month_start + (
          least(schedule_day_of_month, extract(day from last_day)::integer) - 1
        );
        exit when candidate_date >= on_or_after;
        target_year := target_year + 1;
      end loop;

    else
      raise exception using errcode = 'P0001', message = 'Invalid calendar schedule';
  end case;

  return candidate_date::timestamp at time zone 'Asia/Tokyo';
end;
$$;

alter function public._calendar_scheduled_for_on_or_after(
  text, integer, integer, integer, integer, date
) owner to postgres;
revoke all on function public._calendar_scheduled_for_on_or_after(
  text, integer, integer, integer, integer, date
) from public, anon, authenticated, service_role;

comment on function public._calendar_scheduled_for_on_or_after(
  text, integer, integer, integer, integer, date
) is
  'YDR-021の補正・スキップ規則で、指定Tokyo暦日以降の最初の候補を返す内部関数。';

create function public.create_calendar_task(
  task_title text,
  schedule_kind text,
  schedule_day_of_week integer default null,
  schedule_day_of_month integer default null,
  schedule_week_of_month integer default null,
  schedule_month integer default null,
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
  first_scheduled_for timestamptz;
  normalized_title text := pg_catalog.btrim(task_title);
  new_task_rule_id uuid;
begin
  if creating_user_id is null then
    raise exception using errcode = 'P0001', message = 'Authentication required';
  end if;

  select member.household_id
    into current_household_id
    from public.household_members member
   where member.user_id = creating_user_id;

  if current_household_id is null then
    raise exception using errcode = 'P0001', message = 'Household membership required';
  end if;

  if item_id is not null and not exists (
    select 1 from public.managed_items item
     where item.id = item_id and item.household_id = current_household_id
  ) then
    raise exception using errcode = 'P0001', message = 'Managed item not found';
  end if;

  if normalized_title is null
      or pg_catalog.char_length(normalized_title) not between 1 and 100 then
    raise exception using
      errcode = 'P0001', message = 'Task title must be between 1 and 100 characters';
  end if;

  first_scheduled_for := public._calendar_scheduled_for_on_or_after(
    schedule_kind,
    schedule_day_of_week,
    schedule_day_of_month,
    schedule_week_of_month,
    schedule_month,
    (now() at time zone 'Asia/Tokyo')::date
  );

  insert into public.task_rules (
    household_id, managed_item_id, title, recurrence_basis,
    deadline_kind, unresolved_policy,
    recommended_start_offset, recommended_until_offset,
    schedule_kind, schedule_day_of_week, schedule_day_of_month,
    schedule_week_of_month, schedule_month
  ) values (
    current_household_id, item_id, normalized_title, 'calendar',
    'strict', 'carry_over', 0, 0,
    schedule_kind, schedule_day_of_week, schedule_day_of_month,
    schedule_week_of_month, schedule_month
  )
  returning id into new_task_rule_id;

  insert into public.task_occurrences (
    household_id, task_rule_id, scheduled_for, due_at, status
  ) values (
    current_household_id, new_task_rule_id,
    first_scheduled_for, first_scheduled_for, 'pending'
  );

  return new_task_rule_id;
end;
$$;

alter function public.create_calendar_task(
  text, text, integer, integer, integer, integer, uuid
) owner to postgres;
revoke all on function public.create_calendar_task(
  text, text, integer, integer, integer, integer, uuid
) from public, anon, service_role;
grant execute on function public.create_calendar_task(
  text, text, integer, integer, integer, integer, uuid
) to authenticated;

comment on function public.create_calendar_task(
  text, text, integer, integer, integer, integer, uuid
) is
  'auth.uid()の家庭へ定例日基準TaskRuleと最初のpending Occurrenceを原子的に作成する。予定日はDBがAsia/Tokyo暦で決定する。';

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
  current_scheduled_for timestamptz;
  current_recurrence_basis text;
  current_schedule_kind text;
  current_schedule_day_of_week integer;
  current_schedule_day_of_month integer;
  current_schedule_week_of_month integer;
  current_schedule_month integer;
  start_offset integer;
  until_offset integer;
  next_search_date date;
  next_scheduled_for timestamptz;
  next_due_at timestamptz;
  next_occurrence_id uuid;
  replay_occurrence_id uuid;
  replay_performer_user_id uuid;
  updated_count integer;
begin
  if acting_user_id is null then
    raise exception using errcode = 'P0001', message = 'Authentication required';
  end if;

  if idempotency_key is null then
    raise exception using errcode = 'P0001', message = 'Idempotency key is required';
  end if;

  resolved_performer_user_id := coalesce(performed_by_user_id, acting_user_id);

  select log.next_task_occurrence_id, log.task_occurrence_id, log.performed_by_user_id
    into next_occurrence_id, replay_occurrence_id, replay_performer_user_id
    from public.activity_logs log
    join public.household_members member
      on member.household_id = log.household_id and member.user_id = acting_user_id
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

  select occurrence.household_id, occurrence.task_rule_id, occurrence.scheduled_for
    into current_household_id, current_task_rule_id, current_scheduled_for
    from public.task_occurrences occurrence
    join public.household_members member
      on member.household_id = occurrence.household_id and member.user_id = acting_user_id
   where occurrence.id = occurrence_id;

  if current_household_id is null then
    raise exception using errcode = 'P0001', message = 'Occurrence not found';
  end if;

  if actual_occurred_at > now() then
    raise exception using errcode = 'P0001', message = 'occurred_at must not be in the future';
  end if;

  if performed_by_user_id is not null and not exists (
    select 1 from public.household_members member
     where member.household_id = current_household_id
       and member.user_id = complete_maintenance_task.performed_by_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'Performer not found';
  end if;

  update public.task_occurrences
     set status = 'completed'
   where id = occurrence_id and status = 'pending';
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
    raise exception using errcode = 'P0001', message = 'Occurrence is not pending';
  end if;

  select rule.recurrence_basis,
         rule.recommended_start_offset,
         rule.recommended_until_offset,
         rule.schedule_kind,
         rule.schedule_day_of_week,
         rule.schedule_day_of_month,
         rule.schedule_week_of_month,
         rule.schedule_month
    into current_recurrence_basis, start_offset, until_offset,
         current_schedule_kind, current_schedule_day_of_week,
         current_schedule_day_of_month, current_schedule_week_of_month,
         current_schedule_month
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
  elsif current_recurrence_basis = 'completion' then
    next_scheduled_for :=
      ((actual_occurred_at at time zone 'Asia/Tokyo')::date + start_offset)
        ::timestamp at time zone 'Asia/Tokyo';
    next_due_at :=
      ((actual_occurred_at at time zone 'Asia/Tokyo')::date + until_offset)
        ::timestamp at time zone 'Asia/Tokyo';
  elsif current_recurrence_basis = 'calendar' then
    next_search_date := greatest(
      (current_scheduled_for at time zone 'Asia/Tokyo')::date + 1,
      (actual_occurred_at at time zone 'Asia/Tokyo')::date
    );
    next_scheduled_for := public._calendar_scheduled_for_on_or_after(
      current_schedule_kind,
      current_schedule_day_of_week,
      current_schedule_day_of_month,
      current_schedule_week_of_month,
      current_schedule_month,
      next_search_date
    );
    if next_scheduled_for <= actual_occurred_at then
      next_scheduled_for := public._calendar_scheduled_for_on_or_after(
        current_schedule_kind,
        current_schedule_day_of_week,
        current_schedule_day_of_month,
        current_schedule_week_of_month,
        current_schedule_month,
        (next_scheduled_for at time zone 'Asia/Tokyo')::date + 1
      );
    end if;
    next_due_at := next_scheduled_for;
  else
    raise exception using errcode = 'P0001', message = 'Unsupported recurrence basis';
  end if;

  if exists (
    select 1 from public.task_occurrences occurrence
     where occurrence.task_rule_id = current_task_rule_id
       and occurrence.scheduled_for = next_scheduled_for
  ) then
    raise exception using
      errcode = 'P0001', message = 'Next occurrence already exists for the computed schedule';
  end if;

  insert into public.task_occurrences (
    household_id, task_rule_id, scheduled_for, due_at, status
  ) values (
    current_household_id, current_task_rule_id,
    next_scheduled_for, next_due_at, 'pending'
  ) returning id into next_occurrence_id;

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
  '自家庭のpending Todoを原子的に完了する。完了日基準と定例日基準は次回Occurrenceを生成し、一回限りは履歴だけを追記する。';
