-- Issue #20 技術スパイク: 招待トークン受諾とRLSによる家庭間分離の両立
--
-- クライアントは生トークンだけをRPCへ渡す。招待先家庭は招待レコードから、
-- 受諾者はauth.uid()から決定し、任意のhousehold_id/user_idは受け取らない。

create table public.household_invitations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  token_hash bytea not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint household_invitations_acceptance_pair_check check (
    (accepted_at is null and accepted_by is null)
    or (accepted_at is not null and accepted_by is not null)
  )
);

comment on table public.household_invitations is
  '家庭招待。生トークンは保存せずSHA-256ハッシュだけを保持する。';

comment on column public.household_invitations.token_hash is
  '推測困難な生トークンをSHA-256でハッシュした値。生トークン自体は保存しない。';

create index household_invitations_household_id_idx
  on public.household_invitations (household_id);

alter table public.household_invitations enable row level security;
alter table public.household_invitations force row level security;

-- Data API経由の通常操作にはテーブル権限を与えない。招待の検証・使用済み化は、
-- 下の限定RPCだけが所有者権限で行うため、テーブル用RLSポリシーも作成しない。
revoke all on table public.household_invitations from public, anon, authenticated, service_role;
revoke insert, update, delete on table public.household_members from public, anon, authenticated, service_role;

create or replace function public.accept_household_invitation(invitation_token text)
returns table (household_id uuid, membership_created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  accepting_user_id uuid := auth.uid();
  matched_invitation public.household_invitations%rowtype;
  inserted_membership_count integer;
begin
  if accepting_user_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'Authentication required';
  end if;

  -- FOR UPDATEにより、同じトークンへの同時受諾を直列化する。後続処理が失敗すれば
  -- 関数呼び出し全体がロールバックされ、招待だけが使用済みになることはない。
  select invitation.*
    into matched_invitation
    from public.household_invitations invitation
   where invitation.token_hash = extensions.digest(
     pg_catalog.convert_to(invitation_token, 'UTF8'),
     'sha256'
   )
     and invitation.accepted_at is null
     and invitation.expires_at > pg_catalog.statement_timestamp()
   for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'Invitation token is invalid, expired, or already used';
  end if;

  insert into public.household_members (household_id, user_id)
  values (matched_invitation.household_id, accepting_user_id)
  on conflict on constraint household_members_household_id_user_id_key do nothing;

  get diagnostics inserted_membership_count = row_count;

  update public.household_invitations invitation
     set accepted_at = pg_catalog.statement_timestamp(),
         accepted_by = accepting_user_id
   where invitation.id = matched_invitation.id;

  return query
  select matched_invitation.household_id, inserted_membership_count = 1;
end;
$$;

alter function public.accept_household_invitation(text) owner to postgres;
revoke all on function public.accept_household_invitation(text) from public, anon, service_role;
grant execute on function public.accept_household_invitation(text) to authenticated;

comment on function public.accept_household_invitation(text) is
  '認証済み利用者が期限内かつ未使用の招待を一度だけ受諾する。家庭IDと利用者IDはサーバー側で決定する。';
