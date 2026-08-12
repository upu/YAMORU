-- Issue #14 技術スパイク: Supabase RLSによる家庭間データ分離の検証
--
-- 対象: households / household_members / managed_items の最小スキーマ。
-- 目的: household_idとRLSだけで、家庭Aの利用者が家庭Bのデータへ
--       読み書きできないことを自動テストで証明する。
--
-- スコープ外(このマイグレーションでは扱わない):
--   - Owner/Memberなどの細かな権限区別(YDR-005: 家庭メンバー全員が同権限)
--   - TaskRule / TaskOccurrence / ActivityLogの本実装
--   - 招待トークンの発行・受諾フロー

-- pgTAPはテスト専用の拡張であり、リモート環境にも適用され得るこのマイグレーション
-- チェーンには含めない。supabase test db実行時に
-- supabase/tests/database/household_rls_isolation.sql側で有効化する。

-- ---------------------------------------------------------------------------
-- households: データを共有する家庭の単位。
-- ---------------------------------------------------------------------------
create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

comment on table public.households is
  '家庭。household_idの発行元。Phase 2で招待フローと結び付く想定(このissueでは扱わない)。';

alter table public.households enable row level security;
alter table public.households force row level security;

-- ---------------------------------------------------------------------------
-- household_members: Auth利用者(auth.users)と家庭を結ぶmembership。
-- ---------------------------------------------------------------------------
create table public.household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (household_id, user_id)
);

comment on table public.household_members is
  '家庭とAuth利用者のmembership。MVPではOwner/Memberの区別を持たず、行の存在だけが権限を表す(YDR-005)。';

create index household_members_user_id_idx on public.household_members (user_id);

alter table public.household_members enable row level security;
alter table public.household_members force row level security;

-- ---------------------------------------------------------------------------
-- managed_items: 技術検証用の最小ManagedItem。household_idを持つことだけを確認する。
-- 本実装のフィールド構成(name/kind/external_link等、YDR-002)には従わない。
-- ---------------------------------------------------------------------------
create table public.managed_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

comment on table public.managed_items is
  '技術スパイク用の最小ManagedItem。RLS検証だけが目的で、本実装のスキーマではない。';

create index managed_items_household_id_idx on public.managed_items (household_id);

alter table public.managed_items enable row level security;
alter table public.managed_items force row level security;

-- ---------------------------------------------------------------------------
-- is_household_member: 認証済み利用者が指定household_idのメンバーかどうかを判定する。
--
-- security definer + 固定search_pathで、household_membersテーブル自身のRLSポリシー内から
-- 呼び出しても無限再帰にならないようにする(所有者postgresはRLSを回避するため)。
-- クライアントが送るhousehold_idそのものを信用せず、必ずauth.uid()とmembership行の
-- 突き合わせで判定する。
-- search_pathは空にし、本文はすべてpublic.で明示スキーマ修飾する
-- (SECURITY DEFINER関数の検索パス乗っ取り対策)。
-- ---------------------------------------------------------------------------
create or replace function public.is_household_member(target_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = target_household_id
      and hm.user_id = auth.uid()
  );
$$;

revoke all on function public.is_household_member(uuid) from public;
grant execute on function public.is_household_member(uuid) to authenticated;

comment on function public.is_household_member(uuid) is
  '認証済み利用者がtarget_household_idのメンバーかどうか。RLSポリシーからのみ使う想定。';

-- ---------------------------------------------------------------------------
-- テーブル権限: RLSはあくまで「行」の絞り込みであり、テーブルへのアクセス権(GRANT)
-- がなければRLSの判定にすら到達しない。anonには一切GRANTしないことで、
-- 未認証利用者はRLSの判定より手前(権限エラー)で拒否される。
-- ---------------------------------------------------------------------------
grant select on public.households to authenticated;
grant select on public.household_members to authenticated;
grant select, insert, update, delete on public.managed_items to authenticated;

-- ---------------------------------------------------------------------------
-- ポリシー: 家庭メンバー全員を同じ権限として扱う最小構成(YDR-005)。
-- 非メンバーは行の可視性(RLS)で、未認証(anon)はテーブル権限(GRANT)で拒否する。
-- ---------------------------------------------------------------------------

-- households: 自分が属する家庭だけ参照できる。作成・更新・削除は
-- このissueのスコープ外(招待/家庭作成フローはPhase 2)。
create policy households_select_member
  on public.households
  for select
  to authenticated
  using (public.is_household_member(id));

-- household_members: 自分が属する家庭のmembership行だけ参照できる。
create policy household_members_select_member
  on public.household_members
  for select
  to authenticated
  using (public.is_household_member(household_id));

-- managed_items: 家庭メンバー全員が同じ権限で読み書きできる。
-- INSERT/UPDATEはWITH CHECKも指定し、他家庭のhousehold_idを付けての
-- 書き込み・付け替えを拒否する。
create policy managed_items_select_member
  on public.managed_items
  for select
  to authenticated
  using (public.is_household_member(household_id));

create policy managed_items_insert_member
  on public.managed_items
  for insert
  to authenticated
  with check (public.is_household_member(household_id));

create policy managed_items_update_member
  on public.managed_items
  for update
  to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

create policy managed_items_delete_member
  on public.managed_items
  for delete
  to authenticated
  using (public.is_household_member(household_id));
