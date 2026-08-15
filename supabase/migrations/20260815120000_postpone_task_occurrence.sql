-- Issue #19: 未完了Todoを指定日まで延期できるようにする(YDR-012, YDR-020)。
-- 延期はscheduled_forを変えずdue_atだけを変更する。実施者という概念はなく、
-- 操作主体と操作日時だけを記録する(YDR-020「実施者(performer)の既定値と範囲」)。

-- TaskOccurrenceは現在のdue_atしか保持しないため、変更前後の値を
-- 追記型履歴側にも保持する(set_task_occurrence_assigneeと同じ考え方)。
alter table public.activity_logs
  add column previous_due_at timestamptz,
  add column new_due_at timestamptz;

-- action='postponed'の行にのみ変更前後の値を持たせ、それ以外のactionでは
-- 常にnullにする(activity_logs_assignee_change_checkと同じ考え方)。
-- 変更前後が同じ値(無変化)の記録は許さない。
alter table public.activity_logs
  add constraint activity_logs_postpone_check check (
    case
      when action = 'postponed'
        then new_due_at is not null and previous_due_at is distinct from new_due_at
      else previous_due_at is null and new_due_at is null
    end
  );

comment on column public.activity_logs.previous_due_at is
  '延期前のdue_at。action=''postponed''の行にのみ設定される(YDR-012, YDR-020)。';
comment on column public.activity_logs.new_due_at is
  '延期後のdue_at。action=''postponed''の行にのみ設定される(YDR-012, YDR-020)。';

-- ---------------------------------------------------------------------------
-- postpone_task_occurrence: pendingなOccurrenceのdue_atだけを未来日へ変更する。
-- scheduled_forは変更しない(YDR-012)。Occurrence更新とActivityLog追記を
-- 一トランザクションで行う(YDR-014の条件付き更新パターンを踏襲する)。
-- ---------------------------------------------------------------------------
create or replace function public.postpone_task_occurrence(
  occurrence_id uuid,
  new_due_at timestamptz
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
  current_scheduled_for timestamptz;
  previous_due_at timestamptz;
  updated_count integer;
begin
  if acting_user_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'Authentication required';
  end if;

  if new_due_at is null then
    raise exception using
      errcode = 'P0001',
      message = 'new_due_at is required';
  end if;

  select occurrence.household_id, occurrence.status,
         occurrence.scheduled_for, occurrence.due_at
    into current_household_id, current_status,
         current_scheduled_for, previous_due_at
    from public.task_occurrences occurrence
    join public.household_members member
      on member.household_id = occurrence.household_id
     and member.user_id = acting_user_id
   where occurrence.id = postpone_task_occurrence.occurrence_id
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

  -- 「未来の日付を指定して延期できる」(Issue #19の受け入れ基準)。日付の
  -- タイムゾーン解釈は呼び出し側(app/time-zone.tsのtokyoDateToUtcIso)が
  -- Asia/Tokyoの日付境界で行う。ここでは現在時刻より後であることだけを検証する。
  if new_due_at <= now() then
    raise exception using
      errcode = 'P0001',
      message = 'new_due_at must be in the future';
  end if;

  -- scheduled_forより前へは延期できない(task_occurrences_schedule_order_check
  -- の生の制約違反ではなく、分かりやすい理由を返す)。
  if new_due_at < current_scheduled_for then
    raise exception using
      errcode = 'P0001',
      message = 'new_due_at must not be before scheduled_for';
  end if;

  if previous_due_at = new_due_at then
    -- 変更なしの再送は無害な成功として扱い、ActivityLogを追記しない
    -- (set_task_occurrence_assigneeと同じ、既に目的の状態である場合の方針)。
    return;
  end if;

  -- pendingかつ変更前の値と一致する行だけを条件付きで更新する(YDR-014)。
  update public.task_occurrences
     set due_at = postpone_task_occurrence.new_due_at
   where id = postpone_task_occurrence.occurrence_id
     and status = 'pending'
     and due_at = previous_due_at;

  get diagnostics updated_count = row_count;

  if updated_count = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'Occurrence is not pending';
  end if;

  insert into public.activity_logs (
    household_id, task_occurrence_id, action, actor_user_id,
    occurred_at, previous_due_at, new_due_at
  ) values (
    current_household_id, occurrence_id, 'postponed', acting_user_id,
    now(), previous_due_at, new_due_at
  );
end;
$$;

alter function public.postpone_task_occurrence(
  uuid, timestamptz
) owner to postgres;
revoke all on function public.postpone_task_occurrence(
  uuid, timestamptz
) from public, anon, service_role;
grant execute on function public.postpone_task_occurrence(
  uuid, timestamptz
) to authenticated;

comment on function public.postpone_task_occurrence(
  uuid, timestamptz
) is
  '呼び出し利用者が属する家庭のpending Occurrenceのdue_atだけを未来日へ変更し、延期ActivityLogを原子的に追記する。scheduled_forは変更しない(YDR-012)。';
