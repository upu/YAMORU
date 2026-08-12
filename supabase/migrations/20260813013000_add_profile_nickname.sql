-- Issue #30: 家庭作成前に、認証済み利用者がアカウント単位のニックネームを登録する。
--
-- 設計メモ: このニックネームは、docs/product/yamoru-project-plan.md §7の`Member`(表示名)と
-- 同一概念として扱う(YDR-018)。MVPではhousehold_members.user_idがunique制約(#28)により
-- 一人一家庭に限定されているため、「アカウント単位の値」と「家庭内の表示名」は常に一致する。
-- 複数家庭対応が入るとこの前提が崩れるため、その時点で表示名の持ち方を再設計すること。
--
-- households/household_membersと異なり、この表は1テーブル・1行の単純な書き込みで、
-- 複数行にまたがる原子性やロックを必要としないため、限定RPCではなくRLSだけで境界を作る。
-- user_idはクライアントから受け取らず、auth.uid()由来のDEFAULTとRLSのWITH CHECKの
-- 二重の防御でなりすましを防ぐ。

create table public.profiles (
  user_id    uuid primary key references auth.users (id) on delete cascade
                   default auth.uid(),
  nickname   text not null,
  created_at timestamptz not null default now()
);

comment on table public.profiles is
  '利用者に1対1で紐づくアカウントプロフィール。現在はnicknameのみ保持し、家庭内Member表示名(未実装)と同一概念として扱う(YDR-018)。household_idを持たず、家庭作成前から参照できる。';

alter table public.profiles
  add constraint profiles_nickname_length_check
  check (
    pg_catalog.char_length(
      pg_catalog.regexp_replace(
        nickname,
        '^[[:space:]]+|[[:space:]]+$',
        '',
        'g'
      )
    ) between 1 and 20
  );

-- 直接INSERTを許可する経路が唯一のため(households側のようなRPC正規化がない)、
-- 前後空白を必ず正規化して保存する。RLSによる認可とは別軸の正規化。
create or replace function public.trim_profile_nickname()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.nickname := pg_catalog.regexp_replace(
    new.nickname,
    '^[[:space:]]+|[[:space:]]+$',
    '',
    'g'
  );
  return new;
end;
$$;

create trigger profiles_trim_nickname_before_insert
  before insert on public.profiles
  for each row execute function public.trim_profile_nickname();

alter table public.profiles enable row level security;
alter table public.profiles force row level security;

revoke all on table public.profiles from public, anon, authenticated, service_role;
grant select, insert on table public.profiles to authenticated;

-- 自分の行だけ参照できる。user_idが主キーのため、この条件で0件か1件しか返らない。
create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = user_id);

-- 自分の行だけ作成できる。他利用者のuser_idを指定した挿入はWITH CHECKで拒否される。
-- UPDATE/DELETEポリシーは意図的に作らない(このIssueでは登録のみを扱い、変更は将来Issue)。
create policy profiles_insert_own
  on public.profiles
  for insert
  to authenticated
  with check (auth.uid() = user_id);
