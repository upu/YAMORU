-- Issue #69 (YDR-019): 招待URLを登録・ログイン後に受諾できるようにする。
--
-- 未ログインで招待リンクを開いた利用者が、生トークンをURLに残したまま認証フローを
-- 経由しないよう、最初の到達時に生トークンをサーバー管理の一時状態(claim)へ交換する。
-- 以後の認証・ニックネーム登録・受諾確認は、この一時状態への不透明な参照(claim secret)
-- だけで進む。受諾そのものは、招待先メールとの一致確認と、一人一家庭制約下での
-- 二段階のエラー方針(YDR-019「一人一家庭制約下での受諾結果」)を実装する。
--
-- Issue #20 / #68 の accept_household_invitation(text) は、この契約(メール一致・
-- 二段階エラー)を持たないままauthenticatedへ実行権限を与えていたため、新しい
-- claimベースの受諾を経由しないバイパス経路になる。同じ目的のRPCを二つ残さず、
-- この移行で置き換える。

-- ---------------------------------------------------------------------------
-- invitation_pending_claims: 生トークンと引き換える一時状態
-- ---------------------------------------------------------------------------
create table public.invitation_pending_claims (
  id uuid primary key default gen_random_uuid(),
  -- 生トークンがどの招待にも一致しない場合はnullになる(下のopen_invitation_claim参照)。
  invitation_id uuid references public.household_invitations (id) on delete cascade,
  claim_secret_hash bytea not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.invitation_pending_claims is
  '招待リンクの生トークンと引き換える短命な一時状態。生の参照値は保存せずSHA-256ハッシュだけを保持する(YDR-019)。';
comment on column public.invitation_pending_claims.invitation_id is
  '交換時に一致した招待。一致する招待がない(無効なトークン)場合はnullのまま作成する。有効性の判定はaccept_household_invitation_by_claimまで遅延させる(YDR-019「一人一家庭制約下での受諾結果」の不変条件を参照)。';
comment on column public.invitation_pending_claims.claim_secret_hash is
  '推測困難な一時参照値をSHA-256でハッシュした値。生の値自体は保存しない。';
comment on column public.invitation_pending_claims.expires_at is
  '一時状態の有効期限。招待自体の残り有効期限を超えない(YDR-019)。無効なトークンの場合は固定の短い期限を用いる。';
comment on column public.invitation_pending_claims.consumed_at is
  '受諾が成立した日時。単回使用のため、成立後は同じ一時状態を再利用できない。受諾に失敗した試行では立てない(失敗はraiseで全体がロールバックするため。失敗時にも単回使用を強制するにはraiseをやめて結果コードで返す必要があり、決定的な失敗応答からのオラクル利得もないため見送る)。';

create index invitation_pending_claims_invitation_id_idx
  on public.invitation_pending_claims (invitation_id);

alter table public.invitation_pending_claims enable row level security;
alter table public.invitation_pending_claims force row level security;

-- household_invitationsと同様、Data API経由の直接操作は許可しない。
-- 交換・受諾はいずれも下の限定RPCだけが所有者権限で行う。
revoke all on table public.invitation_pending_claims from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- open_invitation_claim: 生トークンを一時状態へ交換する
-- ---------------------------------------------------------------------------
-- 未ログインの利用者が招待リンクを開いた時点で呼ぶため、anonにも実行権限を与える。
--
-- この関数は無効・期限切れ・取消済み・使用済み・存在しないトークンのいずれでも
-- 例外を投げず、常に同じ形のclaim secretを返す。理由はYDR-019「一人一家庭制約下
-- での受諾結果」の不変条件にある: 受諾者が既にいずれかの家庭に所属している場合、
-- 応答はトークンの状態によって内容や有無を変えてはならない。この関数は未認証
-- (anon)でも呼べるため、呼び出し時点では受諾者がどの家庭に所属しているか
-- (あるいは誰であるか)を知り得ず、ここでトークンの有効性に応じて応答を変える
-- とその不変条件を満たせない。よって有効性・メール一致・一人一家庭制約の判定は
-- すべて認証後のaccept_household_invitation_by_claimへ遅延させ、この関数の応答は
-- 常に区別不能にする(これはYDR-019が受諾時に求める「共通」表示より厳密な、
-- 交換時点での完全な無区別)。
--
-- 一致する招待がない場合もclaim行自体は作成する(invitation_idはnullのまま)。
-- 未認証でも呼べるため、無関係な文字列を大量に投げ込む試行そのものへの防御は
-- Web/API層のIPレート制限に委ねる(YDR-019、Issue #70)。ここでは古い行の
-- 間引きだけを行い、テーブル肥大を防ぐ。
create or replace function public.open_invitation_claim(invitation_token text)
returns table (claim_secret text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  matched_invitation public.household_invitations%rowtype;
  matched boolean;
  new_claim_secret text := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
  -- 呼び出し元へ返す・cookieのmax-ageに使う値。トークンの状態によらず常に一定
  -- (下のstored_expires_atと意図的に分離する。理由はコメント参照)。
  public_expires_at timestamptz := pg_catalog.statement_timestamp() + interval '30 minutes';
  -- DBの行に実際に保存し、accept_household_invitation_by_claimの有効性判定に
  -- 使う値。招待の残り期限でキャップする(YDR-019「一時状態の有効期限は、
  -- 招待自体の残り有効期限を超えない」)。この値をpublic_expires_atとして
  -- そのまま返す/cookieのmax-ageへ使うと、招待の残り期限が30分未満のときだけ
  -- 応答(・Set-CookieのMax-Age)が短くなり、無効なトークン(常に約30分)と
  -- 見分けられてしまう。交換時点の完全な無区別を保つため、公開する値と
  -- 内部の失効判定に使う値をここで分ける。
  stored_expires_at timestamptz;
begin
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
     and invitation.expires_at > pg_catalog.statement_timestamp();

  matched := found;

  stored_expires_at := case
    when matched then least(public_expires_at, matched_invitation.expires_at)
    else public_expires_at
  end;

  -- 期限切れ・使用済みの古い一時状態を、挿入のついでに間引く(専用のcronは持たない)。
  -- 戻り値の列名expires_atと衝突するため、テーブルにエイリアスを付けて限定する。
  delete from public.invitation_pending_claims old_claim
   where old_claim.expires_at < pg_catalog.statement_timestamp() - interval '1 day';

  insert into public.invitation_pending_claims (invitation_id, claim_secret_hash, expires_at)
  values (
    case when matched then matched_invitation.id else null end,
    extensions.digest(pg_catalog.convert_to(new_claim_secret, 'UTF8'), 'sha256'),
    stored_expires_at
  );

  return query select new_claim_secret, public_expires_at;
end;
$$;

alter function public.open_invitation_claim(text) owner to postgres;
revoke all on function public.open_invitation_claim(text) from public, service_role;
grant execute on function public.open_invitation_claim(text) to anon, authenticated;

comment on function public.open_invitation_claim(text) is
  '招待リンクの生トークンを、短命な一時状態への不透明な参照(claim secret)へ交換する。未ログインでも呼べ、トークンの有効性によらず常に同じ形の結果を返す(YDR-019、判定はaccept_household_invitation_by_claimへ遅延)。';

-- ---------------------------------------------------------------------------
-- accept_household_invitation_by_claim: claim secretによる受諾
-- ---------------------------------------------------------------------------
-- トークンの有効性・メール一致・一人一家庭制約の判定はすべてここで行う
-- (open_invitation_claimは無条件に成功するため)。YDR-019「一人一家庭制約下
-- での受諾結果」の二段階方針を実装する:
--   1) 受諾者が未所属の場合: トークン(招待)が有効かつメール一致のときだけ成功。
--      それ以外は常に同一の共通エラー(招待の状態を外部に漏らさない)。
--   2) 受諾者が既にいずれかの家庭に所属している場合: トークンが有効・メール一致・
--      招待先が所属家庭と一致するときだけ冪等に成功。それ以外は常に同一の
--      「既に別の家庭に所属している」エラー(トークン自体の状態によって
--      内容や有無を変えない)。
-- 両ケースとも、成功以外の分岐でinvitation・membership・claimの状態を変更しない。
create or replace function public.accept_household_invitation_by_claim(claim_secret text)
returns table (household_id uuid, membership_created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  accepting_user_id uuid := auth.uid();
  accepting_email text;
  existing_household_id uuid;
  matched_claim public.invitation_pending_claims%rowtype;
  matched_invitation public.household_invitations%rowtype;
  claim_found boolean := false;
  email_matches boolean := false;
  inserted_membership_count integer;
begin
  if accepting_user_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'Authentication required';
  end if;

  -- 既存membershipの有無を先に確定する(以後の分岐は常にこの値を参照する)。
  select member.household_id
    into existing_household_id
    from public.household_members member
   where member.user_id = accepting_user_id
   for update;

  -- claimとその招待の現在の有効性を、受諾時点で改めて検証する(交換後の失効・
  -- 別セッションによる先行受諾との競合はここで共通エラーへ畳み込む)。
  select claim.*
    into matched_claim
    from public.invitation_pending_claims claim
   where claim.claim_secret_hash = extensions.digest(
     pg_catalog.convert_to(claim_secret, 'UTF8'),
     'sha256'
   )
     and claim.consumed_at is null
     and claim.expires_at > pg_catalog.statement_timestamp()
   for update;

  if found then
    select invitation.*
      into matched_invitation
      from public.household_invitations invitation
     where invitation.id = matched_claim.invitation_id
       and invitation.accepted_at is null
       and invitation.cancelled_at is null
       and invitation.replaced_by is null
       and invitation.expires_at > pg_catalog.statement_timestamp()
     for update;

    claim_found := found;
  end if;

  if claim_found then
    -- YDR-019は「Authが確認済みの受諾時点の現在のメールアドレス」との一致を
    -- 求める。未確認のメールはaccepting_emailがnullのままとなり、
    -- 下のemail_matches判定で自然にfalseへ畳み込まれる(新しい分岐を増やさない)。
    select u.email
      into accepting_email
      from auth.users u
     where u.id = accepting_user_id
       and u.email_confirmed_at is not null;

    email_matches := accepting_email is not null
      and pg_catalog.lower(pg_catalog.btrim(accepting_email))
        = pg_catalog.lower(pg_catalog.btrim(matched_invitation.invited_email));
  end if;

  if claim_found and email_matches and existing_household_id is not null then
    if existing_household_id <> matched_invitation.household_id then
      raise exception using
        errcode = 'P0002',
        message = 'Already a member of a different household';
    end if;

    -- 冪等な成功: 既に招待先家庭のメンバーなので、membershipは追加せず
    -- 招待とclaimだけを使用済みにする(YDR-019, スパイクの既存動作を踏襲)。
    update public.invitation_pending_claims claim
       set consumed_at = pg_catalog.statement_timestamp()
     where claim.id = matched_claim.id;

    update public.household_invitations invitation
       set accepted_at = pg_catalog.statement_timestamp(),
           accepted_by = accepting_user_id
     where invitation.id = matched_invitation.id;

    return query select matched_invitation.household_id, false;
    return;
  end if;

  if not (claim_found and email_matches) then
    if existing_household_id is not null then
      raise exception using
        errcode = 'P0002',
        message = 'Already a member of a different household';
    end if;

    raise exception using
      errcode = 'P0001',
      message = 'Invitation token is invalid, expired, or already used';
  end if;

  -- ここに到達するのはclaim_found and email_matches and existing_household_id is null。
  begin
    insert into public.household_members (household_id, user_id)
    values (matched_invitation.household_id, accepting_user_id);
  exception
    when unique_violation then
      -- 直前の並行リクエストが別の招待を先に受諾した場合の競合。
      -- membership・invitation・claimのいずれも変更せず、同一のエラーで拒否する。
      raise exception using
        errcode = 'P0002',
        message = 'Already a member of a different household';
  end;

  get diagnostics inserted_membership_count = row_count;

  update public.invitation_pending_claims claim
     set consumed_at = pg_catalog.statement_timestamp()
   where claim.id = matched_claim.id;

  update public.household_invitations invitation
     set accepted_at = pg_catalog.statement_timestamp(),
         accepted_by = accepting_user_id
   where invitation.id = matched_invitation.id;

  return query select matched_invitation.household_id, inserted_membership_count = 1;
end;
$$;

alter function public.accept_household_invitation_by_claim(text) owner to postgres;
revoke all on function public.accept_household_invitation_by_claim(text) from public, anon, service_role;
grant execute on function public.accept_household_invitation_by_claim(text) to authenticated;

comment on function public.accept_household_invitation_by_claim(text) is
  '認証済み利用者がclaim secretで招待を受諾する。メール一致と一人一家庭制約下の二段階エラー方針(YDR-019)を実装する。household_idと受諾者はサーバー側で決定する。';

-- ---------------------------------------------------------------------------
-- accept_household_invitation(text): claimベースの受諾に置き換えて廃止する
-- ---------------------------------------------------------------------------
-- メール一致確認も一人一家庭制約下の二段階エラーも持たないため、そのまま残すと
-- accept_household_invitation_by_claimを経由しないバイパス経路になる(Issue #69)。
revoke all on function public.accept_household_invitation(text) from authenticated;
drop function public.accept_household_invitation(text);
