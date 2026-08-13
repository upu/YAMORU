-- Issue #37: 直近の完了を安全に取り消す(YDR-004, YDR-014, YDR-015)。

create or replace function public.undo_maintenance_task_completion(
  occurrence_id uuid,
  idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  acting_user_id uuid := auth.uid();
  current_household_id uuid;
  target_log_id uuid;
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

  -- 同じ冪等性キーの再送には最初の結果を返す。呼び出し側の家庭に属する
  -- ActivityLogだけを対象にし、対象Occurrenceが一致しない場合は拒否する。
  select log.task_occurrence_id
    into replay_occurrence_id
    from public.activity_logs log
    join public.household_members member
      on member.household_id = log.household_id
     and member.user_id = acting_user_id
   where log.idempotency_key = undo_maintenance_task_completion.idempotency_key
     and log.action = 'completion_undone';

  if found then
    if replay_occurrence_id is distinct from occurrence_id then
      raise exception using
        errcode = 'P0001',
        message = 'Idempotency key was already used for a different occurrence';
    end if;
    return occurrence_id;
  end if;

  select occurrence.household_id
    into current_household_id
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

  -- 完了ActivityLogと自動生成Occurrenceを曖昧な日時比較で結び付けず、IDで
  -- 明示的に対応付ける(YDR-015)。同じOccurrenceが完了・取消を繰り返した
  -- 場合でも、直近の完了はstatus='completed'のときの最新の完了ログになる。
  select log.id, log.next_task_occurrence_id
    into target_log_id, next_occurrence_id
    from public.activity_logs log
   where log.task_occurrence_id = occurrence_id
     and log.action = 'completed'
   order by log.recorded_at desc
   limit 1;

  if target_log_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'Occurrence is not completed';
  end if;

  if next_occurrence_id is not null then
    -- 未変更の次回Occurrenceだけを削除する(YDR-015)。この一文の中で
    -- 「利用者操作のActivityLogがない」ことを再確認するため、対象行が
    -- 同時に変更された場合はPostgreSQLがWHERE句を再評価し、削除されない。
    delete from public.task_occurrences target
     where target.id = next_occurrence_id
       and not exists (
         select 1
           from public.activity_logs log
          where log.task_occurrence_id = next_occurrence_id
       );

    if exists (
      select 1 from public.task_occurrences where id = next_occurrence_id
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'Next occurrence has been modified';
    end if;
  end if;

  -- completedの行だけを条件付きで更新する。同時取消はここで一件だけ成功する。
  update public.task_occurrences
     set status = 'pending'
   where id = occurrence_id
     and status = 'completed';

  get diagnostics updated_count = row_count;

  if updated_count = 0 then
    -- 条件付き更新に負けた要求でも、勝った要求と同じ冪等性キーであれば
    -- その結果を返す(同時到着した同一リクエストの再送)。
    if exists (
      select 1
        from public.activity_logs log
       where log.idempotency_key = undo_maintenance_task_completion.idempotency_key
         and log.action = 'completion_undone'
         and log.task_occurrence_id = occurrence_id
    ) then
      return occurrence_id;
    end if;

    raise exception using
      errcode = 'P0001',
      message = 'Occurrence is not completed';
  end if;

  -- 取消自体は現在時刻の記録として扱う(バックデートはYDR-004の完了だけが対象)。
  insert into public.activity_logs (
    household_id, task_occurrence_id, action, actor_user_id,
    occurred_at, idempotency_key
  ) values (
    current_household_id, occurrence_id, 'completion_undone', acting_user_id,
    now(), idempotency_key
  );

  return occurrence_id;
end;
$$;

alter function public.undo_maintenance_task_completion(
  uuid, uuid
) owner to postgres;
revoke all on function public.undo_maintenance_task_completion(
  uuid, uuid
) from public, anon, service_role;
grant execute on function public.undo_maintenance_task_completion(
  uuid, uuid
) to authenticated;

comment on function public.undo_maintenance_task_completion(
  uuid, uuid
) is
  '呼び出し利用者が属する家庭の直近の完了を取消ActivityLogの追記・未変更の次回Occurrence削除・元Occurrenceのpending復帰として原子的に行う。';
