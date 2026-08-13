-- Issue #57: 既存RLSポリシーの意図をDBコメントとして後付けする(動作変更なし)。
--
-- `profiles_select_household_member`(#36)で`comment on policy`によりDB自体へ
-- 理由を残した際、既存13個のポリシーには付いておらず、`psql`の`\d+`や
-- Supabase StudioのPoliciesから直接読める情報とマイグレーションのSQLコメント
-- でしか意図が分からない状態だった。以後は
-- `scripts/supabase-policy-catalog.ts`がpg_policyとこのコメントから一覧を
-- 生成し、コメントの付け忘れをCIで検出する。

comment on policy households_select_member on public.households is
  '自分が所属する家庭だけ参照できる。家庭間のデータ分離の起点(Issue #14技術スパイク)。';

comment on policy household_members_select_member on public.household_members is
  '自分が所属する家庭のmembership行だけ参照できる(Issue #14技術スパイク)。';

comment on policy managed_items_select_member on public.managed_items is
  '家庭メンバー全員が同じ権限でManagedItemを参照できる(YDR-005, Issue #14技術スパイク)。';

comment on policy managed_items_update_member on public.managed_items is
  '家庭メンバー全員が同じ権限でManagedItemを更新できる。WITH CHECKで他家庭のhousehold_idへの付け替えを拒否する(Issue #14技術スパイク)。';

comment on policy managed_items_delete_member on public.managed_items is
  '家庭メンバー全員が同じ権限でManagedItemを削除できる(Issue #14技術スパイク)。';

comment on policy external_links_select_member on public.external_links is
  '家庭メンバー全員が同じ権限でManagedItemの外部リンクを参照できる(Issue #33)。';

comment on policy external_links_update_member on public.external_links is
  '家庭メンバー全員が同じ権限で外部リンクを更新できる。WITH CHECKで他家庭への付け替えを拒否する(Issue #33)。';

comment on policy external_links_delete_member on public.external_links is
  '家庭メンバー全員が同じ権限で外部リンクを削除できる(Issue #33)。';

comment on policy task_rules_select_member on public.task_rules is
  '家庭メンバー全員が同じ権限でメンテナンスTodoの定義(TaskRule)を参照できる(Issue #34)。';

comment on policy task_occurrences_select_member on public.task_occurrences is
  '家庭メンバー全員が同じ権限でTodoの現在状態(TaskOccurrence)を参照できる(Issue #34)。';

comment on policy activity_logs_select_member on public.activity_logs is
  '家庭メンバー全員が同じ権限でTodo操作履歴(ActivityLog)を参照できる(Issue #34)。';

comment on policy profiles_select_own on public.profiles is
  '自分のプロフィール行だけ参照できる。他利用者のニックネームはprofiles_select_household_memberが別途扱う(Issue #30)。';

comment on policy profiles_insert_own on public.profiles is
  '自分のuser_idでのみプロフィール行を作成できる。他利用者のuser_idを指定した挿入はWITH CHECKで拒否する(Issue #30)。';
