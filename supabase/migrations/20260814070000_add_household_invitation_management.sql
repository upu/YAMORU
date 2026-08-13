-- Issue #68 (YDR-019): 家族招待を安全に発行・取消・再発行できるようにする。
--
-- スパイク(Issue #20)の招待テーブルへ、招待先メール・発行者・取消・再発行の
-- 追跡列を追加し、家庭メンバーが自家庭の招待だけを発行・取消・再発行・一覧できる
-- 限定RPCを追加する。生トークンは引き続きテーブルへ保存せず、発行時の戻り値としてのみ返す。
--
-- 受諾者メールアドレスとの一致確認・未ログイン時の受諾フロー・試行回数制限は
-- 本Issueの対象外(Issue #69, #70でYDR-019の残りの契約を扱う)。

-- ---------------------------------------------------------------------------
-- 列の追加(いずれもNULL許容で追加し、既存データを補完してからNOT NULLにする)
-- ---------------------------------------------------------------------------
alter table public.household_invitations
  add column invited_email text,
  add column created_by uuid references auth.users (id) on delete restrict,
  add column cancelled_at timestamptz,
  add column replaced_by uuid;

alter table public.household_invitations
  add constraint household_invitations_replaced_by_fkey
  foreign key (replaced_by) references public.household_invitations (id)
  deferrable initially deferred;

comment on column public.household_invitations.invited_email is
  '招待先メールアドレス(前後空白を除いた値)。受諾者メールとの一致確認はIssue #69で扱う。';
comment on column public.household_invitations.created_by is
  '招待を発行した家庭メンバーのAuth利用者ID。';
comment on column public.household_invitations.cancelled_at is
  '家庭メンバーが招待を明示的に取消した日時。';
comment on column public.household_invitations.replaced_by is
  'この招待を無効化して置き換えた、再発行後の新しい招待のID。';

-- ---------------------------------------------------------------------------
-- 既存データの補完(Issue #20スパイクで作られた招待先メール未設定の行を移行する)
-- ---------------------------------------------------------------------------
-- 招待先メールを持たない未使用の招待は、新しい契約(メール必須)の対象外なので
-- この移行時点で取消済みとして扱う。受諾済みの行は履歴としてそのまま残す。
update public.household_invitations
   set cancelled_at = pg_catalog.statement_timestamp()
 where accepted_at is null
   and cancelled_at is null;

update public.household_invitations
   set invited_email = 'legacy-unknown@invalid.example'
 where invited_email is null;

update public.household_invitations invitation
   set created_by = coalesce(
     invitation.accepted_by,
     (
       select member.user_id
         from public.household_members member
        where member.household_id = invitation.household_id
        order by member.created_at, member.id
        limit 1
     )
   )
 where invitation.created_by is null;

-- ---------------------------------------------------------------------------
-- NOT NULL化と検証制約
-- ---------------------------------------------------------------------------
alter table public.household_invitations
  alter column invited_email set not null,
  alter column created_by set not null;

alter table public.household_invitations
  add constraint household_invitations_invited_email_check check (
    invited_email = pg_catalog.btrim(invited_email)
    and pg_catalog.char_length(invited_email) between 3 and 320
    and position('@' in invited_email) > 1
    and position('@' in invited_email) < pg_catalog.char_length(invited_email)
  ),
  add constraint household_invitations_cancelled_not_accepted_check check (
    cancelled_at is null or accepted_at is null
  );

-- 同じ家庭・同じ招待先メールに対して、同時に有効な招待は常に高々1件とする(YDR-019)。
-- 「有効」は未受諾・未取消・未置換の行を指し、expires_atは判定に含めない
-- (期限切れの扱いは再発行RPCが同じ行を置き換えることで解決するため)。
create unique index household_invitations_active_by_email_idx
  on public.household_invitations (household_id, lower(invited_email))
  where accepted_at is null and cancelled_at is null and replaced_by is null;

-- ---------------------------------------------------------------------------
-- accept_household_invitation: 取消・再発行された旧トークンも拒否する
-- ---------------------------------------------------------------------------
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
     and invitation.cancelled_at is null
     and invitation.replaced_by is null
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
  '認証済み利用者が期限内・未使用・未取消・未置換の招待を一度だけ受諾する。家庭IDと利用者IDはサーバー側で決定する。';

-- ---------------------------------------------------------------------------
-- issue_household_invitation: 発行・再発行を兼ねる限定RPC
-- ---------------------------------------------------------------------------
-- 同じ招待先メールへの再度の発行(再発行)は、この関数を同じ引数で呼ぶだけでよい。
-- 対象家庭に有効な招待が既にあれば、それを置き換えてから新しい招待を作る。
create or replace function public.issue_household_invitation(invited_email text)
returns table (
  invitation_id uuid,
  invitation_email text,
  token text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  issuing_user_id uuid := auth.uid();
  target_household_id uuid;
  normalized_email text := pg_catalog.btrim(invited_email);
  new_invitation_id uuid := pg_catalog.gen_random_uuid();
  raw_token text := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
  new_expires_at timestamptz := pg_catalog.statement_timestamp() + interval '7 days';
begin
  if issuing_user_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'Authentication required';
  end if;

  if normalized_email is null
     or pg_catalog.char_length(normalized_email) not between 3 and 320
     or position('@' in normalized_email) <= 1
     or position('@' in normalized_email) >= pg_catalog.char_length(normalized_email) then
    raise exception using
      errcode = 'P0001',
      message = 'Invited email must be a valid email address';
  end if;

  select member.household_id
    into target_household_id
    from public.household_members member
   where member.user_id = issuing_user_id
   order by member.created_at, member.id
   limit 1;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'Household membership required';
  end if;

  begin
    -- 既存の有効な招待(未受諾・未取消・未置換)があれば、新しい招待IDへ置き換える。
    -- replaced_byの外部キーはdeferredなので、この時点で新しい行がまだ無くても良い。
    update public.household_invitations invitation
       set replaced_by = new_invitation_id
     where invitation.household_id = target_household_id
       and lower(invitation.invited_email) = lower(normalized_email)
       and invitation.accepted_at is null
       and invitation.cancelled_at is null
       and invitation.replaced_by is null;

    insert into public.household_invitations (
      id, household_id, invited_email, token_hash, expires_at, created_by
    )
    values (
      new_invitation_id,
      target_household_id,
      normalized_email,
      extensions.digest(pg_catalog.convert_to(raw_token, 'UTF8'), 'sha256'),
      new_expires_at,
      issuing_user_id
    );
  exception
    when unique_violation then
      raise exception using
        errcode = 'P0001',
        message = 'An active invitation for this email was just issued; please retry';
  end;

  return query
  select new_invitation_id, normalized_email, raw_token, new_expires_at;
end;
$$;

alter function public.issue_household_invitation(text) owner to postgres;
revoke all on function public.issue_household_invitation(text) from public, anon, service_role;
grant execute on function public.issue_household_invitation(text) to authenticated;

comment on function public.issue_household_invitation(text) is
  '自家庭の招待を発行する。既に同じ招待先メールへの有効な招待があれば置き換える(再発行)。household_idと発行者はauth.uid()とmembershipから決定する。';

-- ---------------------------------------------------------------------------
-- cancel_household_invitation: 自家庭の招待だけを取消できる限定RPC
-- ---------------------------------------------------------------------------
create or replace function public.cancel_household_invitation(invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cancelling_user_id uuid := auth.uid();
  target_invitation public.household_invitations%rowtype;
begin
  if cancelling_user_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'Authentication required';
  end if;

  -- 他家庭の招待IDが渡された場合も、存在しないIDと同じエラーにして
  -- 招待の存在を外部に漏らさない。
  select invitation.*
    into target_invitation
    from public.household_invitations invitation
    join public.household_members member
      on member.household_id = invitation.household_id
     and member.user_id = cancelling_user_id
   where invitation.id = invitation_id
   for update of invitation;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'Invitation not found';
  end if;

  if target_invitation.cancelled_at is not null then
    return;
  end if;

  if target_invitation.accepted_at is not null then
    raise exception using
      errcode = 'P0001',
      message = 'Cannot cancel an already accepted invitation';
  end if;

  if target_invitation.replaced_by is not null then
    raise exception using
      errcode = 'P0001',
      message = 'Cannot cancel an invitation that was already reissued';
  end if;

  update public.household_invitations invitation
     set cancelled_at = pg_catalog.statement_timestamp()
   where invitation.id = target_invitation.id;
end;
$$;

alter function public.cancel_household_invitation(uuid) owner to postgres;
revoke all on function public.cancel_household_invitation(uuid) from public, anon, service_role;
grant execute on function public.cancel_household_invitation(uuid) to authenticated;

comment on function public.cancel_household_invitation(uuid) is
  '自家庭の未受諾・未置換の招待を取消し、旧リンクを即時に無効化する。他家庭の招待は存在しないIDと同じエラーにする。';

-- ---------------------------------------------------------------------------
-- list_household_invitations: 自家庭の招待一覧と状態を返す限定RPC
-- ---------------------------------------------------------------------------
create or replace function public.list_household_invitations()
returns table (
  id uuid,
  invited_email text,
  status text,
  created_at timestamptz,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  requesting_user_id uuid := auth.uid();
  target_household_id uuid;
begin
  if requesting_user_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'Authentication required';
  end if;

  select member.household_id
    into target_household_id
    from public.household_members member
   where member.user_id = requesting_user_id
   order by member.created_at, member.id
   limit 1;

  if not found then
    return;
  end if;

  return query
  select
    invitation.id,
    invitation.invited_email,
    case
      when invitation.accepted_at is not null then 'accepted'
      when invitation.cancelled_at is not null then 'cancelled'
      when invitation.replaced_by is not null then 'replaced'
      when invitation.expires_at <= pg_catalog.statement_timestamp() then 'expired'
      else 'pending'
    end,
    invitation.created_at,
    invitation.expires_at
  from public.household_invitations invitation
  where invitation.household_id = target_household_id
  order by invitation.created_at desc;
end;
$$;

alter function public.list_household_invitations() owner to postgres;
revoke all on function public.list_household_invitations() from public, anon, service_role;
grant execute on function public.list_household_invitations() to authenticated;

comment on function public.list_household_invitations() is
  '呼び出し利用者の所属家庭の招待一覧を、有効・使用済み・期限切れ・取消済み・再発行済みの状態付きで返す。';
