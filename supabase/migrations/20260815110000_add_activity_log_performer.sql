-- Issue #18: Todo完了時に実際に行った家族(実施者)を選べるようにする(YDR-020)。

alter table public.activity_logs
  add column performed_by_user_id uuid;

alter table public.activity_logs
  add constraint activity_logs_performed_by_household_fkey
    foreign key (household_id, performed_by_user_id)
    references public.household_members (household_id, user_id);

comment on column public.activity_logs.performed_by_user_id is
  '完了時に実際に作業した実施者。action=''completed''の行にのみ設定される(YDR-020)。追加入力がなければ操作主体(actor_user_id)と同じ値になる。';

-- 既存の完了履歴は実施者=操作主体としてバックフィルする(YDR-020「既存ActivityLogの移行方針」)。
update public.activity_logs
   set performed_by_user_id = actor_user_id
 where action = 'completed';

-- action='completed'の行にのみperformed_by_user_idを持たせる不変条件をCHECK制約として
-- 強制する。将来のDB関数の不具合によって不変条件が破られた行が作られることを防ぐ(YDR-020)。
alter table public.activity_logs
  add constraint activity_logs_performed_by_completed_check check (
    (action = 'completed') = (performed_by_user_id is not null)
  );

-- ---------------------------------------------------------------------------
-- complete_maintenance_task: 実施者(performed_by_user_id)の任意指定に対応する。
-- 省略時は操作主体(auth.uid())を実施者とする(YDR-020)。
-- ---------------------------------------------------------------------------
drop function public.complete_maintenance_task(uuid, uuid, timestamptz);

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

  -- 追加入力がなければ実施者は操作主体と同じ値になる(YDR-020)。
  resolved_performer_user_id := coalesce(
    performed_by_user_id, acting_user_id
  );

  -- 同じ冪等性キーの再送には最初の結果を返す。ただし呼び出し側の家庭に
  -- 属するActivityLogだけを対象にし、対象Occurrenceまたは実施者が一致しない
  -- 場合はクライアント側の不具合として拒否する。保存済みの実施者を黙って
  -- 優先して返さない(YDR-020「実施者(performer)の既定値と範囲」)。
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

  -- 実施者は同じ家庭のログイン済みメンバーに限る。存在しない利用者・他家庭の
  -- 利用者を区別せず同一エラーにし、他家庭の利用者の存在や所属を推測させない
  -- (set_task_occurrence_assigneeの担当者検証と同じ原則、YDR-020)。
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

  -- pendingの行だけを条件付きで更新する(YDR-014)。同時完了はここで一件だけ成功する。
  update public.task_occurrences
     set status = 'completed'
   where id = occurrence_id
     and status = 'pending';

  get diagnostics updated_count = row_count;

  if updated_count = 0 then
    -- 条件付き更新に負けた要求でも、同じ冪等性キー・同じ実施者の同時到着
    -- リクエストであれば、勝った要求の結果を返す。実施者が異なる場合は
    -- 保存済みの値を黙って優先せず、異なる内容の再送として拒否する
    -- (上の冪等性再送チェックと同じ方針、YDR-020)。
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
    occurred_at, idempotency_key, next_task_occurrence_id, performed_by_user_id
  ) values (
    current_household_id, occurrence_id, 'completed', acting_user_id,
    actual_occurred_at, idempotency_key, next_occurrence_id, resolved_performer_user_id
  );

  return next_occurrence_id;
end;
$$;

alter function public.complete_maintenance_task(
  uuid, uuid, timestamptz, uuid
) owner to postgres;
revoke all on function public.complete_maintenance_task(
  uuid, uuid, timestamptz, uuid
) from public, anon, service_role;
grant execute on function public.complete_maintenance_task(
  uuid, uuid, timestamptz, uuid
) to authenticated;

comment on function public.complete_maintenance_task(
  uuid, uuid, timestamptz, uuid
) is
  '呼び出し利用者が属する家庭のpending Occurrenceを完了し、完了ActivityLogと次回pending Occurrenceを原子的に作成する。実施者(performed_by_user_id)は同じ家庭のログイン済みメンバーに限り、省略時は操作主体を使う(YDR-020)。';
