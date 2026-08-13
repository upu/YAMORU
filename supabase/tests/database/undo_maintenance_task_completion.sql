-- Issue #37: 直近の完了取消の安全な条件、冪等性、競合、変更済み次回、家庭間分離、原子性を検証する。
-- fixtureはsupabase/seed.sqlの架空データだけを使う。

create extension if not exists pgtap with schema extensions;

begin;

select plan(37);

select has_function(
  'public',
  'undo_maintenance_task_completion',
  array['uuid', 'uuid'],
  '完了を取り消し次回Occurrenceを削除するRPCが存在する'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.undo_maintenance_task_completion(uuid,uuid)',
    'execute'
  ),
  'authenticatedだけが取消RPCを実行できる'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.undo_maintenance_task_completion(uuid,uuid)',
    'execute'
  ),
  'anonは取消RPCを実行できない'
);

select ok(
  not has_function_privilege(
    'service_role',
    'public.undo_maintenance_task_completion(uuid,uuid)',
    'execute'
  ),
  'Service Roleにも取消RPCを公開しない'
);

-- ---------------------------------------------------------------------------
-- 家庭Aのメンバーとして、検証対象のTaskRule/Occurrenceを準備する
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000a1001", "role": "authenticated"}';

select isnt_empty(
  $$ select public.create_maintenance_task(
       '00000000-0000-0000-0000-0000000aa001',
       '通常取消確認用', 28, 56,
       '2020-01-01 00:00:00+00', '2020-01-08 00:00:00+00'
     ) $$,
  '検証用TaskRule(通常取消確認用)を作成できる'
);
select isnt_empty(
  $$ select public.create_maintenance_task(
       '00000000-0000-0000-0000-0000000aa001',
       '変更済み次回確認用', 7, 14,
       '2020-02-01 00:00:00+00', '2020-02-08 00:00:00+00'
     ) $$,
  '検証用TaskRule(変更済み次回確認用)を作成できる'
);
select isnt_empty(
  $$ select public.create_maintenance_task(
       '00000000-0000-0000-0000-0000000aa001',
       '原子性確認用', 3, 5,
       '2020-04-01 00:00:00+00', '2020-04-08 00:00:00+00'
     ) $$,
  '検証用TaskRule(原子性確認用)を作成できる'
);
select isnt_empty(
  $$ select public.create_maintenance_task(
       '00000000-0000-0000-0000-0000000aa001',
       '未完了確認用', 1, 2,
       '2020-05-01 00:00:00+00', '2020-05-08 00:00:00+00'
     ) $$,
  '検証用TaskRule(未完了確認用)を作成できる'
);

select isnt_empty(
  $$ select public.complete_maintenance_task(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '通常取消確認用'
       ),
       '00000000-0000-0000-0000-0000000e1001'
     ) $$,
  '通常取消確認用の最初のOccurrenceを完了できる'
);
-- 2回連続で完了させるため、それぞれ異なるoccurred_atを指定して次回予定の
-- 衝突(YDR-014の一意制約)を避ける。
select isnt_empty(
  $$ select public.complete_maintenance_task(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '変更済み次回確認用'
       ),
       '00000000-0000-0000-0000-0000000e1002',
       '2020-02-01 00:00:00+00'
     ) $$,
  '変更済み次回確認用の最初のOccurrenceを完了できる'
);
select isnt_empty(
  $$ select public.complete_maintenance_task(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '変更済み次回確認用'
            and occurrence.status = 'pending'
       ),
       '00000000-0000-0000-0000-0000000e1003',
       '2020-02-08 00:00:00+00'
     ) $$,
  '変更済み次回確認用の次回Occurrenceも完了できる(取消対象の次回を変更済みにする)'
);
select isnt_empty(
  $$ select public.complete_maintenance_task(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '原子性確認用'
       ),
       '00000000-0000-0000-0000-0000000e1004'
     ) $$,
  '原子性確認用の最初のOccurrenceを完了できる'
);

-- ---------------------------------------------------------------------------
-- 通常の取消
-- ---------------------------------------------------------------------------
select isnt_empty(
  $$ select public.undo_maintenance_task_completion(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '通常取消確認用'
            and occurrence.status = 'completed'
       ),
       '00000000-0000-0000-0000-0000000f1001'
     ) $$,
  '完了済みOccurrenceの取消を実行できる'
);

select is(
  (
    select occurrence.status
      from public.task_occurrences occurrence
      join public.task_rules rule on rule.id = occurrence.task_rule_id
     where rule.title = '通常取消確認用'
  ),
  'pending'::text,
  '取消後、元Occurrenceがpendingへ戻る'
);

select is(
  (
    select count(*)
      from public.activity_logs log
      join public.task_occurrences occurrence on occurrence.id = log.task_occurrence_id
      join public.task_rules rule on rule.id = occurrence.task_rule_id
     where rule.title = '通常取消確認用'
       and log.action = 'completion_undone'
  ),
  1::bigint,
  '取消ActivityLogを1件だけ追記する'
);

select ok(
  (
    select log.occurred_at > now() - interval '1 minute'
      from public.activity_logs log
      join public.task_occurrences occurrence on occurrence.id = log.task_occurrence_id
      join public.task_rules rule on rule.id = occurrence.task_rule_id
     where rule.title = '通常取消確認用'
       and log.action = 'completion_undone'
  ),
  '取消のoccurred_atはバックデートせず現在時刻になる'
);

select is(
  (
    select count(*)
      from public.task_occurrences occurrence
      join public.task_rules rule on rule.id = occurrence.task_rule_id
     where rule.title = '通常取消確認用'
  ),
  1::bigint,
  '未変更の次回Occurrenceが削除され、元の1件だけになる'
);

select is(
  (
    select log.next_task_occurrence_id
      from public.activity_logs log
      join public.task_occurrences occurrence on occurrence.id = log.task_occurrence_id
      join public.task_rules rule on rule.id = occurrence.task_rule_id
     where rule.title = '通常取消確認用'
       and log.action = 'completed'
  ),
  null::uuid,
  '削除された次回Occurrenceへの参照はNULLになる(外部キーのon delete set null)'
);

select is(
  (
    select count(*)
      from public.activity_logs log
      join public.task_occurrences occurrence on occurrence.id = log.task_occurrence_id
      join public.task_rules rule on rule.id = occurrence.task_rule_id
     where rule.title = '通常取消確認用'
       and log.action = 'completed'
  ),
  1::bigint,
  '完了ActivityLogは削除・上書きされず残る'
);

-- ---------------------------------------------------------------------------
-- 同じ冪等性キーの再送は最初の結果を返し、重複させない
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select public.undo_maintenance_task_completion(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '通常取消確認用'
       ),
       '00000000-0000-0000-0000-0000000f1001'
     ) $$,
  $$ select occurrence.id
       from public.task_occurrences occurrence
       join public.task_rules rule on rule.id = occurrence.task_rule_id
      where rule.title = '通常取消確認用' $$,
  '同じ冪等性キーの再送は最初の結果を返す'
);

select is(
  (
    select count(*)
      from public.activity_logs log
      join public.task_occurrences occurrence on occurrence.id = log.task_occurrence_id
      join public.task_rules rule on rule.id = occurrence.task_rule_id
     where rule.title = '通常取消確認用'
       and log.action = 'completion_undone'
  ),
  1::bigint,
  '再送しても取消ActivityLogを重複作成しない'
);

-- ---------------------------------------------------------------------------
-- 取消済み(pending)のOccurrenceを異なるキーで再度取り消せない
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.undo_maintenance_task_completion(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '通常取消確認用'
       ),
       '00000000-0000-0000-0000-0000000f1002'
     ) $$,
  'P0001',
  'Occurrence is not completed',
  '取消済み(pending)のOccurrenceを別要求で再取消できない(同時取消でも一件だけ成功する)'
);

-- ---------------------------------------------------------------------------
-- 一度も完了していないOccurrenceは取り消せない
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.undo_maintenance_task_completion(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '未完了確認用'
       ),
       '00000000-0000-0000-0000-0000000f1003'
     ) $$,
  'P0001',
  'Occurrence is not completed',
  '完了していないOccurrenceは取り消せない'
);

-- ---------------------------------------------------------------------------
-- 同じ冪等性キーを別Occurrenceへ使い回せない
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.undo_maintenance_task_completion(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '未完了確認用'
       ),
       '00000000-0000-0000-0000-0000000f1001'
     ) $$,
  'P0001',
  'Idempotency key was already used for a different occurrence',
  '同じ冪等性キーを別Occurrenceへ使い回すと拒否する'
);

-- ---------------------------------------------------------------------------
-- 次回Occurrenceが変更済みの場合、取消を拒否する
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.undo_maintenance_task_completion(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '変更済み次回確認用'
            and occurrence.status = 'completed'
          order by occurrence.scheduled_for asc
          limit 1
       ),
       '00000000-0000-0000-0000-0000000f1004'
     ) $$,
  'P0001',
  'Next occurrence has been modified',
  '次回Occurrenceが既に完了(変更)されている場合は取消を拒否する'
);

select is(
  (
    select count(*)
      from public.task_occurrences occurrence
      join public.task_rules rule on rule.id = occurrence.task_rule_id
     where rule.title = '変更済み次回確認用'
  ),
  3::bigint,
  '拒否された取消はOccurrenceを削除・変更しない(元2件+次回完了1件の3件のまま)'
);

select is(
  (
    select occurrence.status
      from public.task_occurrences occurrence
      join public.task_rules rule on rule.id = occurrence.task_rule_id
     where rule.title = '変更済み次回確認用'
     order by occurrence.scheduled_for asc
     limit 1
  ),
  'completed'::text,
  '拒否された取消では元Occurrenceはcompletedのまま残る'
);

-- 次回Occurrence自身の完了(直近の完了)は、まだ何も操作されていないさらに次回を
-- 持つため取り消せる。
select isnt_empty(
  $$ select public.undo_maintenance_task_completion(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '変更済み次回確認用'
            and occurrence.status = 'completed'
          order by occurrence.scheduled_for desc
          limit 1
       ),
       '00000000-0000-0000-0000-0000000f1005'
     ) $$,
  '直近の完了(次回Occurrence自身)は未変更のさらに次回を持つため取り消せる'
);

select is(
  (
    select count(*)
      from public.task_occurrences occurrence
      join public.task_rules rule on rule.id = occurrence.task_rule_id
     where rule.title = '変更済み次回確認用'
  ),
  2::bigint,
  '直近の完了取消で、さらに次回Occurrenceが削除され2件になる'
);

-- ---------------------------------------------------------------------------
-- 冪等性キーは必須
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.undo_maintenance_task_completion(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '原子性確認用'
            and occurrence.status = 'completed'
       ),
       null
     ) $$,
  'P0001',
  'Idempotency key is required',
  '冪等性キーを省略すると失敗する'
);

-- ---------------------------------------------------------------------------
-- 家庭Bのメンバーは家庭Aの完了を取り消せない
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000b1001", "role": "authenticated"}';

select throws_ok(
  $$ select public.undo_maintenance_task_completion(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '原子性確認用'
            and occurrence.status = 'completed'
       ),
       '00000000-0000-0000-0000-0000000f1006'
     ) $$,
  'P0001',
  'Occurrence not found',
  '家庭Bの利用者は家庭Aの完了を取り消せない'
);

-- ---------------------------------------------------------------------------
-- 存在しないOccurrenceへの要求は安全に失敗する
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000a1001", "role": "authenticated"}';

select throws_ok(
  $$ select public.undo_maintenance_task_completion(
       '00000000-0000-0000-0000-00000000ffff',
       '00000000-0000-0000-0000-0000000f1007'
     ) $$,
  'P0001',
  'Occurrence not found',
  '存在しないOccurrenceへの要求は安全に失敗する'
);

-- ---------------------------------------------------------------------------
-- 未認証利用者は取消RPCを実行できない
-- ---------------------------------------------------------------------------
reset role;
set local role anon;

select throws_ok(
  $$ select public.undo_maintenance_task_completion(
       '00000000-0000-0000-0000-00000000ffff',
       '00000000-0000-0000-0000-0000000f1008'
     ) $$,
  '42501',
  null,
  '未認証利用者は取消RPCを実行できない'
);

-- ---------------------------------------------------------------------------
-- 原子性: 取消ActivityLog追記に失敗すると取消処理全体が失敗する
-- ---------------------------------------------------------------------------
reset role;

create function public.reject_undo_atomicity_test_log()
returns trigger
language plpgsql
as $$
begin
  if new.action = 'completion_undone'
     and new.idempotency_key = '00000000-0000-0000-0000-0000000f1099' then
    raise exception 'undo atomicity test failure';
  end if;
  return new;
end;
$$;

create trigger reject_undo_atomicity_test_log
before insert on public.activity_logs
for each row execute function public.reject_undo_atomicity_test_log();

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000a1001", "role": "authenticated"}';

select throws_ok(
  $$ select public.undo_maintenance_task_completion(
       (
         select occurrence.id
           from public.task_occurrences occurrence
           join public.task_rules rule on rule.id = occurrence.task_rule_id
          where rule.title = '原子性確認用'
            and occurrence.status = 'completed'
       ),
       '00000000-0000-0000-0000-0000000f1099'
     ) $$,
  'undo atomicity test failure',
  '取消ActivityLog追記失敗時は取消処理全体が失敗する'
);

reset role;

select is(
  (
    select occurrence.status
      from public.task_occurrences occurrence
      join public.task_rules rule on rule.id = occurrence.task_rule_id
     where rule.title = '原子性確認用'
       and occurrence.scheduled_for = '2020-04-01 00:00:00+00'::timestamptz
  ),
  'completed'::text,
  '原子性テスト失敗時、元Occurrenceはcompletedのまま残る'
);

select is(
  (
    select count(*)
      from public.activity_logs log
      join public.task_occurrences occurrence on occurrence.id = log.task_occurrence_id
      join public.task_rules rule on rule.id = occurrence.task_rule_id
     where rule.title = '原子性確認用'
       and log.action = 'completion_undone'
  ),
  0::bigint,
  '原子性テスト失敗時、取消ActivityLogを残さない'
);

select is(
  (
    select count(*)
      from public.task_occurrences occurrence
      join public.task_rules rule on rule.id = occurrence.task_rule_id
     where rule.title = '原子性確認用'
  ),
  2::bigint,
  '原子性テスト失敗時、次回Occurrenceも削除されず残る'
);

select * from finish();

rollback;
