-- Issue #35: メンテナンスTodoを原子的に完了し、次回Occurrenceを生成する。

alter table public.activity_logs
  add column idempotency_key uuid,
  add column next_task_occurrence_id uuid
    references public.task_occurrences (id) on delete set null;

alter table public.activity_logs
  add constraint activity_logs_idempotency_key_key unique (idempotency_key);

comment on column public.activity_logs.idempotency_key is
  '同じクライアント要求の再送を検知する冪等性キー。actionによっては使わないためNULLを許容する(YDR-014)。';
comment on column public.activity_logs.next_task_occurrence_id is
  '完了時に自動生成した次回Occurrenceへの参照。取消処理が対応関係を安全にたどるために保持する(YDR-015)。';

create or replace function public.complete_maintenance_task(
  occurrence_id uuid,
  idempotency_key uuid,
  occurred_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  acting_user_id uuid := auth.uid();
  actual_occurred_at timestamptz := coalesce(occurred_at, now());
  current_household_id uuid;
  current_task_rule_id uuid;
  start_offset integer;
  until_offset integer;
  next_scheduled_for timestamptz;
  next_due_at timestamptz;
  next_occurrence_id uuid;
  replay_occurrence_id uuid;
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

  -- 同じ冪等性キーの再送には最初の結果を返す。ただし呼び出し側の家庭に
  -- 属するActivityLogだけを対象にし、対象Occurrenceが一致しない場合は
  -- クライアント側の不具合として拒否する(他家庭・他Occurrenceへの誤用を防ぐ)。
  select log.next_task_occurrence_id, log.task_occurrence_id
    into next_occurrence_id, replay_occurrence_id
    from public.activity_logs log
    join public.household_members member
      on member.household_id = log.household_id
     and member.user_id = acting_user_id
   where log.idempotency_key = complete_maintenance_task.idempotency_key
     and log.action = 'completed';

  if found then
    if replay_occurrence_id is distinct from occurrence_id then
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

  -- pendingの行だけを条件付きで更新する(YDR-014)。同時完了はここで一件だけ成功する。
  update public.task_occurrences
     set status = 'completed'
   where id = occurrence_id
     and status = 'pending';

  get diagnostics updated_count = row_count;

  if updated_count = 0 then
    -- 条件付き更新に負けた要求でも、勝った要求と同じ冪等性キーであれば
    -- その結果を返す(同時到着した同一リクエストの再送)。
    select log.next_task_occurrence_id
      into next_occurrence_id
      from public.activity_logs log
     where log.idempotency_key = complete_maintenance_task.idempotency_key
       and log.action = 'completed'
       and log.task_occurrence_id = occurrence_id;

    if found then
      return next_occurrence_id;
    end if;

    raise exception using
      errcode = 'P0001',
      message = 'Occurrence is not pending';
  end if;

  select rule.recommended_start_offset, rule.recommended_until_offset
    into start_offset, until_offset
    from public.task_rules rule
   where rule.id = current_task_rule_id;

  -- Phase 1では家庭のタイムゾーンをAsia/Tokyoに固定する
  -- (app/managed-items/[id]/time-zone.tsのPHASE_ONE_TIME_ZONEと同じ前提)。
  next_scheduled_for :=
    ((actual_occurred_at at time zone 'Asia/Tokyo')::date + start_offset)
      ::timestamp at time zone 'Asia/Tokyo';
  next_due_at :=
    ((actual_occurred_at at time zone 'Asia/Tokyo')::date + until_offset)
      ::timestamp at time zone 'Asia/Tokyo';

  -- バックデート完了では計算結果が既存のscheduled_forと衝突しうる。
  -- 一意制約を最後の防御として維持しつつ、ここで分かりやすい理由を返す。
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
    occurred_at, idempotency_key, next_task_occurrence_id
  ) values (
    current_household_id, occurrence_id, 'completed', acting_user_id,
    actual_occurred_at, idempotency_key, next_occurrence_id
  );

  return next_occurrence_id;
end;
$$;

alter function public.complete_maintenance_task(
  uuid, uuid, timestamptz
) owner to postgres;
revoke all on function public.complete_maintenance_task(
  uuid, uuid, timestamptz
) from public, anon, service_role;
grant execute on function public.complete_maintenance_task(
  uuid, uuid, timestamptz
) to authenticated;

comment on function public.complete_maintenance_task(
  uuid, uuid, timestamptz
) is
  '呼び出し利用者が属する家庭のpending Occurrenceを完了し、完了ActivityLogと次回pending Occurrenceを原子的に作成する。';
