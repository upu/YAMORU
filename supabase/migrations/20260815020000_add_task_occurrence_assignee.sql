-- Issue #72: TaskOccurrenceへ任意の担当者を設定・解除できるようにする(YDR-006, YDR-020)。

alter table public.task_occurrences
  add column assignee_user_id uuid;

alter table public.task_occurrences
  add constraint task_occurrences_assignee_household_fkey
    foreign key (household_id, assignee_user_id)
    references public.household_members (household_id, user_id);

comment on column public.task_occurrences.assignee_user_id is
  '事前に引き受けた担当者。未設定(null)は「誰でも可」を表す既定値(YDR-006, YDR-020)。同じ家庭のメンバーに限る。';

-- 担当変更ActivityLogは、TaskOccurrenceが現在の担当者しか保持しないため、
-- 変更前後の値を追記型履歴側にも保持する(YDR-020「担当者(assignee)の扱い」)。
-- 両カラムとも、未設定(null)は「誰でも可」を表す。
alter table public.activity_logs
  add column previous_assignee_user_id uuid,
  add column new_assignee_user_id uuid;

alter table public.activity_logs
  add constraint activity_logs_previous_assignee_household_fkey
    foreign key (household_id, previous_assignee_user_id)
    references public.household_members (household_id, user_id);

alter table public.activity_logs
  add constraint activity_logs_new_assignee_household_fkey
    foreign key (household_id, new_assignee_user_id)
    references public.household_members (household_id, user_id);

-- action='assignee_changed'の行にのみ変更前後の値を持たせ、それ以外のactionでは
-- 常にnullにする(YDR-020のperformed_by_user_id不変条件と同じ考え方)。
-- assignee_changedの行は、変更前後が同じ値(無変化)の記録を許さない。
alter table public.activity_logs
  add constraint activity_logs_assignee_change_check check (
    case
      when action = 'assignee_changed'
        then previous_assignee_user_id is distinct from new_assignee_user_id
      else previous_assignee_user_id is null and new_assignee_user_id is null
    end
  );

comment on column public.activity_logs.previous_assignee_user_id is
  '担当変更前の担当者。action=''assignee_changed''の行にのみ設定される(YDR-020)。';
comment on column public.activity_logs.new_assignee_user_id is
  '担当変更後の担当者。未設定(null)は解除(「誰でも可」)を表す。action=''assignee_changed''の行にのみ設定される(YDR-020)。';

-- ---------------------------------------------------------------------------
-- set_task_occurrence_assignee: pendingなOccurrenceの担当者を設定・解除する。
-- Occurrence更新とActivityLog追記を一トランザクションで行う(YDR-014, YDR-020)。
-- ---------------------------------------------------------------------------
-- new_assignee_user_idはdefault nullを持たせる。担当解除(誰でも可へ戻す)を
-- 呼び出し側から明示的にnullを渡さずとも表現できるようにし、生成される
-- クライアント型もoccurred_at(complete_maintenance_task)と同じ省略可能な形にする。
create or replace function public.set_task_occurrence_assignee(
  occurrence_id uuid,
  new_assignee_user_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  acting_user_id uuid := auth.uid();
  current_household_id uuid;
  current_status text;
  previous_assignee_user_id uuid;
  updated_count integer;
begin
  if acting_user_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'Authentication required';
  end if;

  select occurrence.household_id, occurrence.status, occurrence.assignee_user_id
    into current_household_id, current_status, previous_assignee_user_id
    from public.task_occurrences occurrence
    join public.household_members member
      on member.household_id = occurrence.household_id
     and member.user_id = acting_user_id
   where occurrence.id = set_task_occurrence_assignee.occurrence_id
   for update of occurrence;

  if current_household_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'Occurrence not found';
  end if;

  if current_status is distinct from 'pending' then
    raise exception using
      errcode = 'P0001',
      message = 'Occurrence is not pending';
  end if;

  -- 担当者は同じ家庭のメンバーに限る。存在しない利用者・他家庭の利用者を
  -- 区別せず同一エラーにし、他家庭の利用者の存在や所属を推測させない
  -- (YDR-020の実施者検証と同じ原則)。
  if new_assignee_user_id is not null and not exists (
    select 1
      from public.household_members member
     where member.household_id = current_household_id
       and member.user_id = set_task_occurrence_assignee.new_assignee_user_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Assignee not found';
  end if;

  if previous_assignee_user_id is not distinct from new_assignee_user_id then
    -- 変更なしの再送は無害な成功として扱い、ActivityLogを追記しない
    -- (cancel_household_invitationと同じ、既に目的の状態である場合の方針)。
    return;
  end if;

  -- pendingかつ変更前の値と一致する行だけを条件付きで更新する(YDR-014)。
  update public.task_occurrences
     set assignee_user_id = set_task_occurrence_assignee.new_assignee_user_id
   where id = set_task_occurrence_assignee.occurrence_id
     and status = 'pending'
     and assignee_user_id is not distinct from previous_assignee_user_id;

  get diagnostics updated_count = row_count;

  if updated_count = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'Occurrence is not pending';
  end if;

  insert into public.activity_logs (
    household_id, task_occurrence_id, action, actor_user_id,
    occurred_at, previous_assignee_user_id, new_assignee_user_id
  ) values (
    current_household_id, occurrence_id, 'assignee_changed', acting_user_id,
    now(), previous_assignee_user_id, new_assignee_user_id
  );
end;
$$;

alter function public.set_task_occurrence_assignee(
  uuid, uuid
) owner to postgres;
revoke all on function public.set_task_occurrence_assignee(
  uuid, uuid
) from public, anon, service_role;
grant execute on function public.set_task_occurrence_assignee(
  uuid, uuid
) to authenticated;

comment on function public.set_task_occurrence_assignee(
  uuid, uuid
) is
  '呼び出し利用者が属する家庭のpending Occurrenceへ、同じ家庭のメンバーを担当者として設定・解除し、担当変更ActivityLogを原子的に追記する。';
