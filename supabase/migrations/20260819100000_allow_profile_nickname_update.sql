-- Issue #76: 登録済みのアカウント単位ニックネーム(profiles.nickname)を本人が編集できるようにする。
--
-- Issue #30時点ではUPDATE/DELETEポリシーを意図的に作らず登録のみを扱っていた
-- (20260813013000_add_profile_nickname.sqlのコメント参照)。このマイグレーションで
-- 本人による更新だけを許可する。household_id等を持たないアカウント単位の値のため、
-- 家庭境界ではなく「自分の行かどうか」だけがUSING/WITH CHECKの条件になる。
--
-- 入力検証(長さ・空白のみ拒否)は登録時と同じCHECK制約(profiles_nickname_length_check)を
-- そのまま再利用する。前後空白の正規化トリガーもINSERTだけでなくUPDATEでも走るよう、
-- 既存トリガーを差し替える。

drop trigger profiles_trim_nickname_before_insert on public.profiles;

create trigger profiles_trim_nickname_before_write
  before insert or update on public.profiles
  for each row execute function public.trim_profile_nickname();

grant update on table public.profiles to authenticated;

-- 自分の行だけ更新できる。USING句が対象行を自分の行に絞るため、他利用者の
-- user_idを条件にしたUPDATEはエラーにならず0件のまま終わる。WITH CHECK句は
-- 更新後の行も自分のuser_idのままであることを要求する(user_idの付け替え防止。
-- user_idは主キーで通常は書き換えないが、他ポリシーと防御の考え方を揃える)。
create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

comment on policy profiles_update_own on public.profiles is
  '自分のプロフィール行(ニックネーム)だけ更新できる。他利用者の行はUSING句で対象外になる(Issue #76)。';
