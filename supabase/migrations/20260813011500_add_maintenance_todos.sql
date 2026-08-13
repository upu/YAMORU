-- Issue #34: 完了日基準メンテナンスTodoのMVP基盤を追加する。

create table public.task_rules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  managed_item_id uuid not null,
  title text not null,
  recurrence_basis text not null default 'completion',
  deadline_kind text not null default 'maintenance',
  unresolved_policy text not null default 'carry_over',
  recommended_start_offset integer not null,
  recommended_until_offset integer not null,
  created_at timestamptz not null default now(),
  constraint task_rules_title_length_check check (
    title = pg_catalog.btrim(title)
    and pg_catalog.char_length(title) between 1 and 100
  ),
  constraint task_rules_recurrence_basis_check check (
    recurrence_basis = 'completion'
  ),
  constraint task_rules_deadline_kind_check check (
    deadline_kind = 'maintenance'
  ),
  constraint task_rules_unresolved_policy_check check (
    unresolved_policy = 'carry_over'
  ),
  constraint task_rules_recommended_offsets_check check (
    recommended_start_offset between 0 and 3650
    and recommended_until_offset between recommended_start_offset and 3650
  ),
  constraint task_rules_item_household_fkey
    foreign key (managed_item_id, household_id)
    references public.managed_items (id, household_id)
    on delete cascade,
  constraint task_rules_id_household_key unique (id, household_id)
);

comment on table public.task_rules is
  '定期Todoの定義。Issue #34では完了日基準・maintenance・1件持ち越しだけを扱う。';
comment on column public.task_rules.recommended_start_offset is
  '完了日時から推奨期間の開始までの日数(YDR-017)。';
comment on column public.task_rules.recommended_until_offset is
  '完了日時から推奨期間の上限までの日数(YDR-017)。';

create index task_rules_household_id_idx on public.task_rules (household_id);
create index task_rules_managed_item_id_idx on public.task_rules (managed_item_id);

create table public.task_occurrences (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  task_rule_id uuid not null,
  scheduled_for timestamptz not null,
  due_at timestamptz not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  constraint task_occurrences_schedule_order_check check (
    scheduled_for <= due_at
  ),
  constraint task_occurrences_status_check check (
    status in ('pending', 'completed', 'skipped')
  ),
  constraint task_occurrences_rule_household_fkey
    foreign key (task_rule_id, household_id)
    references public.task_rules (id, household_id)
    on delete cascade,
  constraint task_occurrences_id_household_key unique (id, household_id),
  constraint task_occurrences_rule_scheduled_key unique (
    task_rule_id,
    scheduled_for
  )
);

comment on table public.task_occurrences is
  '一回分のTodoの現在状態。scheduled_forは本来の予定、due_atは現在の期限を表す(YDR-012)。';

create index task_occurrences_household_id_idx
  on public.task_occurrences (household_id);
create unique index task_occurrences_one_pending_per_rule_idx
  on public.task_occurrences (task_rule_id)
  where status = 'pending';

create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  task_occurrence_id uuid not null,
  action text not null,
  actor_user_id uuid not null,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  constraint activity_logs_action_check check (
    action in (
      'completed',
      'completion_undone',
      'postponed',
      'skipped',
      'assignee_changed'
    )
  ),
  constraint activity_logs_occurrence_household_fkey
    foreign key (task_occurrence_id, household_id)
    references public.task_occurrences (id, household_id)
    on delete cascade,
  constraint activity_logs_actor_household_fkey
    foreign key (household_id, actor_user_id)
    references public.household_members (household_id, user_id)
);

comment on table public.activity_logs is
  'TaskOccurrenceへの操作を追記する履歴。occurred_atとサーバー付与のrecorded_atを分離する(YDR-012, YDR-015)。';

create index activity_logs_household_id_idx on public.activity_logs (household_id);
create index activity_logs_occurrence_id_idx
  on public.activity_logs (task_occurrence_id);

alter table public.task_rules enable row level security;
alter table public.task_rules force row level security;
alter table public.task_occurrences enable row level security;
alter table public.task_occurrences force row level security;
alter table public.activity_logs enable row level security;
alter table public.activity_logs force row level security;

grant select on public.task_rules to authenticated;
grant select on public.task_occurrences to authenticated;
grant select on public.activity_logs to authenticated;

create policy task_rules_select_member
  on public.task_rules for select to authenticated
  using (public.is_household_member(household_id));

create policy task_occurrences_select_member
  on public.task_occurrences for select to authenticated
  using (public.is_household_member(household_id));

create policy activity_logs_select_member
  on public.activity_logs for select to authenticated
  using (public.is_household_member(household_id));

create or replace function public.create_maintenance_task(
  item_id uuid,
  task_title text,
  recommended_start_offset integer,
  recommended_until_offset integer,
  first_scheduled_for timestamptz,
  first_due_at timestamptz
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
  uuid, text, integer, integer, timestamptz, timestamptz
) owner to postgres;
revoke all on function public.create_maintenance_task(
  uuid, text, integer, integer, timestamptz, timestamptz
) from public, anon, service_role;
grant execute on function public.create_maintenance_task(
  uuid, text, integer, integer, timestamptz, timestamptz
) to authenticated;

comment on function public.create_maintenance_task(
  uuid, text, integer, integer, timestamptz, timestamptz
) is
  'auth.uid()の家庭に属するManagedItemへTaskRuleと最初のpending Occurrenceを原子的に作成する。';
