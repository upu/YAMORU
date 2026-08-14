-- Issue #72: undo_maintenance_task_completionと、次回Occurrenceを更新する
-- 並行トランザクション(set_task_occurrence_assignee, complete_maintenance_task)
-- との競合を修正する。
--
-- 旧実装は「delete ... where not exists (activity_logsを確認するサブクエリ)」
-- を一文で実行していた。next_occurrenceが他トランザクションにロックされている
-- 間はDELETEがブロックされるが、ロック解除後の再評価(EvalPlanQual)は
-- DELETE文開始時点のスナップショットでサブクエリを評価するため、ロック
-- 待ち中に相手が追記・コミットしたActivityLogを見落とし、未変更の
-- Occurrenceと誤認して削除してしまう。実際に2セッションで再現し、
-- コミット済みのassignee_changed ActivityLogごと次回Occurrenceが削除される
-- ことを確認した(YDR-015「次回Occurrenceに利用者操作のActivityLogが
-- 一つでもある場合、取消を拒否する」に違反する)。
--
-- 修正は、削除可否を判定する前に対象行を明示的にfor updateでロックし、
-- ロック取得後の新しい文としてActivityLogの有無を確認する。次回Occurrence
-- を更新する側(set_task_occurrence_assignee, complete_maintenance_task)は
-- いずれも同じ行を更新・ロックしてからActivityLogを追記するため、先に
-- ロックを取得すればその文以降の判定は常に最新のコミット結果を反映する。
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
    -- 次回Occurrenceを更新しうる並行トランザクション(担当変更・完了)が
    -- 保持するロックの解放を待つ。ここで取得を待つことで、以降の判定を
    -- 常に最新のコミット結果に基づかせる。
    perform 1
      from public.task_occurrences
     where id = next_occurrence_id
       for update;

    if exists (
      select 1
        from public.activity_logs log
       where log.task_occurrence_id = next_occurrence_id
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'Next occurrence has been modified';
    end if;

    -- ロック取得後、利用者操作のActivityLogが一件もないことを確認済みの
    -- 未変更Occurrenceだけを削除する(YDR-015)。
    delete from public.task_occurrences
     where id = next_occurrence_id;
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
  '呼び出し利用者が属する家庭の直近の完了を取消ActivityLogの追記・未変更の次回Occurrence削除・元Occurrenceのpending復帰として原子的に行う。次回Occurrenceは削除可否判定の前にロックし、並行更新との競合を防ぐ。';
