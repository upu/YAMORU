-- Issue #19: 未完了Todoの延期(due_atだけの変更、scheduled_for維持)、他家庭からの
-- 隔離、pending限定、未来日限定、冪等な無変化再送、完了取消との相互作用を検証する
-- (YDR-012, YDR-020)。fixtureはsupabase/seed.sqlの架空データだけを使う。

create extension if not exists pgtap with schema extensions;

begin;

select plan(26);

select has_function(
  'public',
  'postpone_task_occurrence',
  array['uuid', 'timestamptz'],
  '延期するRPCが存在する'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.postpone_task_occurrence(uuid,timestamptz)',
    'execute'
  ),
  'authenticatedだけが延期RPCを実行できる'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.postpone_task_occurrence(uuid,timestamptz)',
    'execute'
  ),
  'anonは延期RPCを実行できない'
);

select ok(
  not has_function_privilege(
    'service_role',
    'public.postpone_task_occurrence(uuid,timestamptz)',
    'execute'
  ),
  'Service Roleにも延期RPCを公開しない'
);

select has_column(
  'public', 'activity_logs', 'previous_due_at',
  'ActivityLogに延期前のdue_at列がある'
);
select has_column(
  'public', 'activity_logs', 'new_due_at',
  'ActivityLogに延期後のdue_at列がある'
);

-- ---------------------------------------------------------------------------
-- 家庭Aのメンバーとして、検証対象のTaskRule/Occurrenceを準備する
-- (家庭Aはa1001, a1002の2名。家庭Bはb1001の1名。)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000a1001", "role": "authenticated"}';

select isnt_empty(
  $$ select public.create_maintenance_task(
       '延期確認用', 28, 56,
       now() - interval '10 days', now() + interval '5 days',
       '00000000-0000-0000-0000-0000000aa001'
     ) $$,
  '検証用TaskRule(延期確認用)を作成できる'
);
select isnt_empty(
  $$ select public.create_maintenance_task(
       '完了取消相互作用確認用', 0, 0,
       '2020-05-01 00:00:00+00', '2020-05-01 00:00:00+00',
       '00000000-0000-0000-0000-0000000aa001'
     ) $$,
  '検証用TaskRule(完了取消相互作用確認用)を作成できる'
);
select isnt_empty(
  $$ select public.create_maintenance_task(
       '推奨期間前確認用', 28, 56,
       now() + interval '20 days', now() + interval '40 days',
       '00000000-0000-0000-0000-0000000aa001'
     ) $$,
  '検証用TaskRule(推奨期間前確認用、scheduled_forが未来)を作成できる'
);

-- ---------------------------------------------------------------------------
-- 未来日への延期: due_atだけが変わり、scheduled_for/statusは変わらない
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ select public.postpone_task_occurrence(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '延期確認用'
       ),
       now() + interval '30 days'
     ) $$,
  '未来日を指定して延期できる'
);

select ok(
  (
    select occurrence.due_at > now() + interval '29 days'
      and occurrence.due_at < now() + interval '31 days'
      from public.task_occurrences occurrence
      join public.task_rules rule on rule.id = occurrence.task_rule_id
     where rule.title = '延期確認用'
  ),
  'due_atが指定した未来日に更新される'
);

select ok(
  (
    select occurrence.scheduled_for < now()
      and occurrence.status = 'pending'
      from public.task_occurrences occurrence
      join public.task_rules rule on rule.id = occurrence.task_rule_id
     where rule.title = '延期確認用'
  ),
  '延期してもscheduled_forとstatus(pending)は変わらない'
);

select results_eq(
  $$ select log.action, log.actor_user_id, log.new_due_at is not null
       from public.activity_logs log
       join public.task_occurrences occurrence on occurrence.id = log.task_occurrence_id
       join public.task_rules rule on rule.id = occurrence.task_rule_id
      where rule.title = '延期確認用'
        and log.action = 'postponed' $$,
  $$ values (
       'postponed'::text,
       '00000000-0000-0000-0000-0000000a1001'::uuid,
       true
     ) $$,
  '延期ActivityLogに操作主体と変更後due_atを記録する(実施者は記録しない)'
);

select is(
  (
    select log.performed_by_user_id
      from public.activity_logs log
      join public.task_occurrences occurrence on occurrence.id = log.task_occurrence_id
      join public.task_rules rule on rule.id = occurrence.task_rule_id
     where rule.title = '延期確認用'
       and log.action = 'postponed'
  ),
  null::uuid,
  '延期ActivityLogのperformed_by_user_idは常にnull(実施者概念なし)'
);

-- ---------------------------------------------------------------------------
-- 過去日・現在時刻以前は延期できない
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.postpone_task_occurrence(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '延期確認用'
       ),
       now() - interval '1 day'
     ) $$,
  'P0001',
  'new_due_at must be in the future',
  '過去日への延期はエラーになる'
);

select throws_ok(
  $$ select public.postpone_task_occurrence(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '延期確認用'
       ),
       now()
     ) $$,
  'P0001',
  'new_due_at must be in the future',
  '現在時刻以前への延期はエラーになる'
);

-- ---------------------------------------------------------------------------
-- scheduled_forより前へは延期できない
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.postpone_task_occurrence(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '推奨期間前確認用'
       ),
       now() + interval '10 days'
     ) $$,
  'P0001',
  'new_due_at must not be before scheduled_for',
  '未来日であっても本来の予定日より前へは延期できない'
);

-- ---------------------------------------------------------------------------
-- 変更なしの再送は無害な成功として扱い、ActivityLogを追記しない
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ select public.postpone_task_occurrence(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '延期確認用'
       ),
       (
         select occurrence.due_at
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '延期確認用'
       )
     ) $$,
  '現在と同じdue_atへの延期要求は無害に成功する'
);

select is(
  (
    select count(*)
      from public.activity_logs log
      join public.task_occurrences occurrence on occurrence.id = log.task_occurrence_id
      join public.task_rules rule on rule.id = occurrence.task_rule_id
     where rule.title = '延期確認用'
       and log.action = 'postponed'
  ),
  1::bigint,
  '無変化の再送はActivityLogを重複追記しない'
);

-- ---------------------------------------------------------------------------
-- 無変化の再送は、現在時刻がdue_atを追い越して過去になっていても成功する
-- (無変化判定を未来日検証より先に行うことで、境界値での再送が
-- 「must be in the future」で失敗しないようにする)
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ select public.postpone_task_occurrence(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '完了取消相互作用確認用'
            and occurrence.status = 'pending'
       ),
       (
         select occurrence.due_at
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '完了取消相互作用確認用'
            and occurrence.status = 'pending'
       )
     ) $$,
  '既に過去日のdue_atへの無変化再送は、未来日検証より先に成功する'
);

-- ---------------------------------------------------------------------------
-- pendingでないOccurrenceは延期できない
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ select public.complete_maintenance_task(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '完了取消相互作用確認用'
       ),
       '00000000-0000-0000-0000-0000000e2001'
     ) $$,
  '完了取消相互作用確認用のOccurrenceを完了できる'
);

select throws_ok(
  $$ select public.postpone_task_occurrence(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '完了取消相互作用確認用'
            and occurrence.status = 'completed'
       ),
       now() + interval '30 days'
     ) $$,
  'P0001',
  'Occurrence is not pending',
  '完了済みOccurrenceは延期できない'
);

-- ---------------------------------------------------------------------------
-- 延期後の次回Occurrenceは、利用者操作ActivityLogがあるため完了取消を拒否する
-- (YDR-015とYDR-020の整合、set_task_occurrence_assigneeと同じ検証)
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ select public.postpone_task_occurrence(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '完了取消相互作用確認用'
            and occurrence.status = 'pending'
       ),
       now() + interval '30 days'
     ) $$,
  '次回Occurrenceを延期できる'
);

select throws_ok(
  $$ select public.undo_maintenance_task_completion(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '完了取消相互作用確認用'
            and occurrence.status = 'completed'
       ),
       '00000000-0000-0000-0000-0000000e2002'
     ) $$,
  'P0001',
  'Next occurrence has been modified',
  '次回Occurrenceに延期のActivityLogがあると完了取消を拒否する'
);

-- ---------------------------------------------------------------------------
-- 他家庭の利用者は延期できない
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000b1001", "role": "authenticated"}';

select throws_ok(
  $$ select public.postpone_task_occurrence(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '延期確認用'
       ),
       now() + interval '30 days'
     ) $$,
  'P0001',
  'Occurrence not found',
  '家庭Bの利用者は家庭AのOccurrenceを延期できない'
);

-- ---------------------------------------------------------------------------
-- 未認証利用者は延期RPCを実行できない
-- ---------------------------------------------------------------------------
reset role;
set local role anon;

select throws_ok(
  $$ select public.postpone_task_occurrence(
       '00000000-0000-0000-0000-00000000ffff',
       now() + interval '30 days'
     ) $$,
  '42501',
  null,
  '未認証利用者は延期RPCを実行できない'
);

select * from finish();

rollback;
