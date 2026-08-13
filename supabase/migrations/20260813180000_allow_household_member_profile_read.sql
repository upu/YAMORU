-- Issue #36: ホームと詳細画面の「誰が」表示のため、同一家庭メンバーの
-- ニックネームを参照できるようにする。
--
-- 「最近の実施」「最後にいつ・誰が」は、操作した本人だけでなく家庭の
-- 他メンバーの実施も表示する(YDR-018のMember表示名と同一概念)。
-- 既存のprofiles_select_own(自分の行だけ)はそのまま維持し、
-- 「同じ家庭に属する利用者同士は互いのニックネームを参照できる」という
-- 追加のpermissiveポリシーを重ねる(Postgresの複数ポリシーはOR結合)。
--
-- 判定はhousehold_membersを介した間接参照のみで行い、is_household_member()
-- (security definer)を再利用してauth.uid()由来の突き合わせにする。
-- クライアントからのhousehold_id指定は受け取らない。

create policy profiles_select_household_member
  on public.profiles
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.household_members target_membership
      where target_membership.user_id = profiles.user_id
        and public.is_household_member(target_membership.household_id)
    )
  );

comment on policy profiles_select_household_member on public.profiles is
  '呼び出し利用者と同じ家庭に属する利用者のニックネームを参照できる(Issue #36)。';
