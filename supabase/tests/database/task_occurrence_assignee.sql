-- Issue #72: 担当者の設定・解除、他家庭からの隔離、pending限定、冪等な無変化再送、
-- 完了時の次回Occurrenceが担当者を引き継がないことを検証する(YDR-006, YDR-020)。
-- fixtureはsupabase/seed.sqlの架空データだけを使う。

create extension if not exists pgtap with schema extensions;

begin;

select plan(32);

select has_function(
  'public',
  'set_task_occurrence_assignee',
  array['uuid', 'uuid'],
  '担当者を設定・解除するRPCが存在する'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.set_task_occurrence_assignee(uuid,uuid)',
    'execute'
  ),
  'authenticatedだけが担当変更RPCを実行できる'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.set_task_occurrence_assignee(uuid,uuid)',
    'execute'
  ),
  'anonは担当変更RPCを実行できない'
);

select ok(
  not has_function_privilege(
    'service_role',
    'public.set_task_occurrence_assignee(uuid,uuid)',
    'execute'
  ),
  'Service Roleにも担当変更RPCを公開しない'
);

select has_column(
  'public', 'task_occurrences', 'assignee_user_id',
  'TaskOccurrenceに担当者列がある'
);
select has_column(
  'public', 'activity_logs', 'previous_assignee_user_id',
  'ActivityLogに変更前の担当者列がある'
);
select has_column(
  'public', 'activity_logs', 'new_assignee_user_id',
  'ActivityLogに変更後の担当者列がある'
);

-- ---------------------------------------------------------------------------
-- 家庭Aのメンバーとして、検証対象のTaskRule/Occurrenceを準備する
-- (家庭Aはa1001, a1002の2名。家庭Bはb1001の1名。)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000a1001", "role": "authenticated"}';

select isnt_empty(
  $$ select public.create_maintenance_task(
       '担当変更確認用', 28, 56,
       '2020-01-01 00:00:00+00', '2020-01-08 00:00:00+00',
       '00000000-0000-0000-0000-0000000aa001'
     ) $$,
  '検証用TaskRule(担当変更確認用)を作成できる'
);
select isnt_empty(
  $$ select public.create_maintenance_task(
       '完了時引継ぎ確認用', 0, 0,
       '2020-05-01 00:00:00+00', '2020-05-01 00:00:00+00',
       '00000000-0000-0000-0000-0000000aa001'
     ) $$,
  '検証用TaskRule(完了時引継ぎ確認用)を作成できる'
);

-- ---------------------------------------------------------------------------
-- 既定は未設定(誰でも可)
-- ---------------------------------------------------------------------------
select is(
  (
    select occurrence.assignee_user_id
      from public.task_occurrences occurrence
      join public.task_rules rule on rule.id = occurrence.task_rule_id
     where rule.title = '担当変更確認用'
  ),
  null::uuid,
  '新規Occurrenceの担当者は未設定(誰でも可)が既定'
);

-- ---------------------------------------------------------------------------
-- 同じ家庭のメンバーを担当者に設定できる
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ select public.set_task_occurrence_assignee(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '担当変更確認用'
       ),
       '00000000-0000-0000-0000-0000000a1002'
     ) $$,
  '同じ家庭のメンバーを担当者に設定できる'
);

select is(
  (
    select occurrence.assignee_user_id
      from public.task_occurrences occurrence
      join public.task_rules rule on rule.id = occurrence.task_rule_id
     where rule.title = '担当変更確認用'
  ),
  '00000000-0000-0000-0000-0000000a1002'::uuid,
  'TaskOccurrenceの担当者が更新される'
);

select results_eq(
  $$ select log.action, log.actor_user_id,
            log.previous_assignee_user_id, log.new_assignee_user_id
       from public.activity_logs log
       join public.task_occurrences occurrence on occurrence.id = log.task_occurrence_id
       join public.task_rules rule on rule.id = occurrence.task_rule_id
      where rule.title = '担当変更確認用'
        and log.action = 'assignee_changed' $$,
  $$ values (
       'assignee_changed'::text,
       '00000000-0000-0000-0000-0000000a1001'::uuid,
       null::uuid,
       '00000000-0000-0000-0000-0000000a1002'::uuid
     ) $$,
  '担当変更ActivityLogに操作主体と変更前後の値を記録する(変更前はnull=誰でも可)'
);

-- ---------------------------------------------------------------------------
-- 担当者を解除して「誰でも可」に戻せる
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ select public.set_task_occurrence_assignee(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '担当変更確認用'
       ),
       null
     ) $$,
  '担当者を解除できる'
);

select is(
  (
    select occurrence.assignee_user_id
      from public.task_occurrences occurrence
      join public.task_rules rule on rule.id = occurrence.task_rule_id
     where rule.title = '担当変更確認用'
  ),
  null::uuid,
  '解除後は未設定(誰でも可)に戻る'
);

select is(
  (
    select count(*)
      from public.activity_logs log
      join public.task_occurrences occurrence on occurrence.id = log.task_occurrence_id
      join public.task_rules rule on rule.id = occurrence.task_rule_id
     where rule.title = '担当変更確認用'
       and log.action = 'assignee_changed'
  ),
  2::bigint,
  '設定と解除でActivityLogが2件追記される'
);

-- ---------------------------------------------------------------------------
-- 変更前後が同じ値の再送は無害な成功として扱い、ActivityLogを追記しない
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ select public.set_task_occurrence_assignee(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '担当変更確認用'
       ),
       null
     ) $$,
  '既に未設定の状態への解除要求は無害に成功する'
);

select is(
  (
    select count(*)
      from public.activity_logs log
      join public.task_occurrences occurrence on occurrence.id = log.task_occurrence_id
      join public.task_rules rule on rule.id = occurrence.task_rule_id
     where rule.title = '担当変更確認用'
       and log.action = 'assignee_changed'
  ),
  2::bigint,
  '無変化の再送はActivityLogを重複追記しない'
);

-- ---------------------------------------------------------------------------
-- 実クライアント(app/managed-items/[id]/actions.ts)の解除呼び出しは
-- new_assignee_user_idキー自体を省略する(default null)。第2引数を省略した
-- 単一引数呼び出しでも同じ挙動になることを確認する。
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ select public.set_task_occurrence_assignee(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '担当変更確認用'
       ),
       '00000000-0000-0000-0000-0000000a1002'
     ) $$,
  '第2引数省略の解除を検証する前に、再度担当者を明示指定で設定できる'
);

select lives_ok(
  $$ select public.set_task_occurrence_assignee(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '担当変更確認用'
       )
     ) $$,
  '第2引数を省略した呼び出しはdefault nullで解除になる(実クライアントの経路)'
);

select is(
  (
    select occurrence.assignee_user_id
      from public.task_occurrences occurrence
      join public.task_rules rule on rule.id = occurrence.task_rule_id
     where rule.title = '担当変更確認用'
  ),
  null::uuid,
  '第2引数省略の呼び出しで担当者が未設定(誰でも可)に戻る'
);

-- ---------------------------------------------------------------------------
-- 他家庭の利用者を担当者に指定できない
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.set_task_occurrence_assignee(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '担当変更確認用'
       ),
       '00000000-0000-0000-0000-0000000b1001'
     ) $$,
  'P0001',
  'Assignee not found',
  '他家庭の利用者を担当者に指定できない'
);

-- ---------------------------------------------------------------------------
-- 存在しない利用者IDも同じエラーにする(所属を推測させない)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.set_task_occurrence_assignee(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '担当変更確認用'
       ),
       '00000000-0000-0000-0000-00000000ffff'
     ) $$,
  'P0001',
  'Assignee not found',
  '存在しない利用者IDも同一のエラーにする'
);

-- ---------------------------------------------------------------------------
-- scheduled_for, due_at, statusは変更しない
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select occurrence.scheduled_for, occurrence.due_at, occurrence.status
       from public.task_occurrences occurrence
       join public.task_rules rule on rule.id = occurrence.task_rule_id
      where rule.title = '担当変更確認用' $$,
  $$ values (
       '2020-01-01 00:00:00+00'::timestamptz,
       '2020-01-08 00:00:00+00'::timestamptz,
       'pending'::text
     ) $$,
  '担当変更はscheduled_for, due_at, statusを変更しない'
);

-- ---------------------------------------------------------------------------
-- 完了で自動生成される次回Occurrenceは担当者を引き継がない(YDR-020)
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ select public.set_task_occurrence_assignee(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '完了時引継ぎ確認用'
       ),
       '00000000-0000-0000-0000-0000000a1002'
     ) $$,
  '完了前に担当者を設定できる'
);

select lives_ok(
  $$ select public.complete_maintenance_task(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '完了時引継ぎ確認用'
       ),
       '00000000-0000-0000-0000-0000000e1001'
     ) $$,
  '担当者ありのOccurrenceを完了できる'
);

select is(
  (
    select occurrence.assignee_user_id
      from public.task_occurrences occurrence
      join public.task_rules rule on rule.id = occurrence.task_rule_id
     where rule.title = '完了時引継ぎ確認用'
       and occurrence.status = 'pending'
  ),
  null::uuid,
  '完了で自動生成された次回Occurrenceは担当者を未設定(誰でも可)で作る'
);

-- ---------------------------------------------------------------------------
-- pendingでないOccurrenceの担当は変更できない
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.set_task_occurrence_assignee(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '完了時引継ぎ確認用'
            and occurrence.status = 'completed'
       ),
       '00000000-0000-0000-0000-0000000a1001'
     ) $$,
  'P0001',
  'Occurrence is not pending',
  '完了済みOccurrenceの担当を変更できない'
);

-- ---------------------------------------------------------------------------
-- 担当変更後の次回Occurrenceは、利用者操作ActivityLogがあるため取消を拒否する
-- (YDR-015とYDR-020の整合)
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ select public.set_task_occurrence_assignee(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '完了時引継ぎ確認用'
            and occurrence.status = 'pending'
       ),
       '00000000-0000-0000-0000-0000000a1001'
     ) $$,
  '次回Occurrenceへ担当者を設定できる'
);

select throws_ok(
  $$ select public.undo_maintenance_task_completion(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '完了時引継ぎ確認用'
            and occurrence.status = 'completed'
       ),
       '00000000-0000-0000-0000-0000000e1002'
     ) $$,
  'P0001',
  'Next occurrence has been modified',
  '次回Occurrenceに担当変更のActivityLogがあると完了取消を拒否する'
);

-- ---------------------------------------------------------------------------
-- 家庭Bのメンバーは家庭AのOccurrenceの担当を変更できない
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000b1001", "role": "authenticated"}';

select throws_ok(
  $$ select public.set_task_occurrence_assignee(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '担当変更確認用'
       ),
       '00000000-0000-0000-0000-0000000b1001'
     ) $$,
  'P0001',
  'Occurrence not found',
  '家庭Bの利用者は家庭AのOccurrenceの担当を変更できない'
);

-- ---------------------------------------------------------------------------
-- 未認証利用者は担当変更RPCを実行できない
-- ---------------------------------------------------------------------------
reset role;
set local role anon;

select throws_ok(
  $$ select public.set_task_occurrence_assignee(
       '00000000-0000-0000-0000-00000000ffff',
       null
     ) $$,
  '42501',
  null,
  '未認証利用者は担当変更RPCを実行できない'
);

select * from finish();

rollback;
