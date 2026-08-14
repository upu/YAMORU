-- Issue #70 (YDR-019): 招待受諾に試行回数制限とセキュリティログを追加する。
--
-- 対象は二つのRPC:
--   - open_invitation_claim: 未認証(anon)から直接呼べていた交換RPC。IPアドレス
--     単位で試行回数を制限する。
--   - accept_household_invitation_by_claim: 認証済み(authenticated)から直接
--     呼べていた受諾RPC。利用者単位で受諾失敗を制限する。
--
-- 採用理由(実装時に記録: YDR-019「レート制限はWeb/API層で行い、受諾そのものを
-- 行うDB関数(RPC)の責務には含めない」との整合):
--   YDR-019のこの一文は「受諾そのものを行うDB関数」を対象としており、どちらの
--   RPCも直接呼び出せる状態のままでは「Web/API層のレート制限」はDB関数を直接
--   叩くバイパス経路を防げない(anon/authenticatedキーはブラウザに公開される
--   ため秘密ではない)。よって両RPCの実行権限をservice_roleだけに絞り、
--   判定に必要な最小限の入力(呼び出し元IP、Authで検証済みの利用者ID)を
--   Next.jsのサーバー側(Route Handler / Server Action)から明示的に渡す
--   「サーバー専用境界」に倒す。これによりレート制限の判断そのものは
--   Web/API層(Next.js側)がいつ・どちらのRPCを呼ぶかを決める形で残り、
--   RPCの本体ロジック(メール一致・一人一家庭制約の二段階方針)は変更しない。
--   直接RPCを叩く経路自体を塞ぐため、「直接呼び出しでも迂回できない」
--   (Issue #70受け入れ基準)を満たす。
--
-- accept_household_invitation_by_claimは、この境界変更に伴いauth.uid()を
-- 呼び出し元(Next.js)がsupabase.auth.getUser()で検証済みのp_user_idへ置き換える
-- (service_role経由ではauth.uid()が常にnullになるため)。あわせて、レート制限の
-- 判定結果とセキュリティログの記録をraise exceptionより前に確定させる必要が
-- あるため、失敗種別をraise exceptionではなく戻り値のresult_codeで表現する形に
-- 改める。raise exceptionは同一トランザクション内の直前の変更(ログ挿入を含む)
-- を巻き戻すため、失敗試行のログが残らない(スパイク文書由来の既存コメントが
-- 指摘していた制約と同じ理由)。呼び出し元(Server Action)は従来どおり
-- result_codeを見て同一の共通エラー表示へ畳み込むため、利用者に見える挙動は
-- 変えない。

-- ---------------------------------------------------------------------------
-- security_events: レート制限の判定材料とセキュリティログを兼ねる
-- ---------------------------------------------------------------------------
create table public.security_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('invitation_exchange', 'invitation_accept')),
  actor text not null,
  result text not null check (result in ('attempt', 'success', 'failure', 'rate_limited')),
  token_fingerprint text,
  occurred_at timestamptz not null default now()
);

comment on table public.security_events is
  '招待の交換(open_invitation_claim)・受諾(accept_household_invitation_by_claim)試行のレート制限判定とセキュリティログを兼ねる。生のトークン・claim参照・招待先メール本文は保持しない(YDR-011, YDR-019, Issue #70)。';
comment on column public.security_events.event_type is
  'invitation_exchange = 交換RPC(IPアドレス単位)、invitation_accept = 受諾RPC(利用者単位)。';
comment on column public.security_events.actor is
  'invitation_exchangeはIPアドレス文字列、invitation_acceptは利用者ID(uuid)の文字列表現。YDR-019はレート制限に必要なIPアドレス・アカウント識別子の記録を許容する。';
comment on column public.security_events.result is
  'attempt = 制限内で処理を進めた(交換RPCは常に成功するためattemptのみ)、success/failure = 受諾RPCの結果、rate_limited = 制限超過により処理せず拒否。';
comment on column public.security_events.token_fingerprint is
  '対象のclaim secretのSHA-256ハッシュ(16進文字列)。生のトークンや一時状態の参照値は保持しない。';

-- レート制限の判定(直近ウィンドウのカウント)とログの一覧表示の双方で使う。
create index security_events_lookup_idx
  on public.security_events (event_type, actor, occurred_at);

alter table public.security_events enable row level security;
alter table public.security_events force row level security;

-- household_invitations / invitation_pending_claimsと同様、Data API経由の
-- 直接操作は許可しない。読み書きはいずれも下の限定関数だけが所有者権限で行う。
revoke all on table public.security_events from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 内部ヘルパー: いずれも外部(anon/authenticated/service_role)へは公開しない。
-- SECURITY DEFINER関数の内部から所有者(postgres)権限で呼ばれる前提の実装詳細。
-- ---------------------------------------------------------------------------

-- 直近ウィンドウ内の試行件数を返す。同一(event_type, actor)の並行呼び出しは
-- トランザクションスコープのadvisory lockで直列化し、カウントと直後の記録
-- (呼び出し元が続けて行う_security_event_log)の間の競合を防ぐ
-- (Issue #70受け入れ基準「並行試行を含むDB境界」)。
create or replace function public._security_event_recent_count(
  p_event_type text,
  p_actor text,
  p_window interval
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  recent_count integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_event_type || ':' || p_actor, 0)
  );

  select count(*)
    into recent_count
    from public.security_events event
   where event.event_type = p_event_type
     and event.actor = p_actor
     and event.occurred_at > pg_catalog.statement_timestamp() - p_window;

  return recent_count;
end;
$$;

alter function public._security_event_recent_count(text, text, interval) owner to postgres;
revoke all on function public._security_event_recent_count(text, text, interval)
  from public, anon, authenticated, service_role;

-- セキュリティログを1件記録する。呼び出し側(このマイグレーションの2関数)は
-- いずれもraise exceptionより前にこれを呼び、失敗試行のログがロールバックで
-- 消えないようにする。ついでに古い行を間引く(専用のcronは持たない、
-- invitation_pending_claimsと同じ方針)。
create or replace function public._security_event_log(
  p_event_type text,
  p_actor text,
  p_result text,
  p_token_fingerprint text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.security_events (event_type, actor, result, token_fingerprint)
  values (p_event_type, p_actor, p_result, p_token_fingerprint);

  delete from public.security_events old_event
   where old_event.occurred_at < pg_catalog.statement_timestamp() - interval '30 days';
end;
$$;

alter function public._security_event_log(text, text, text, text) owner to postgres;
revoke all on function public._security_event_log(text, text, text, text)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- open_invitation_claim: サーバー専用境界へ移し、IPアドレス単位で試行を制限する
-- ---------------------------------------------------------------------------
-- 旧シグネチャ(1引数)はservice_role以外にも実行権限を与えていたバイパス経路
-- そのものなので、置き換えではなく明示的に削除する(2引数版とは別関数扱いに
-- なるため、create or replaceだけでは古い方が残ってしまう)。
drop function public.open_invitation_claim(text);

-- p_client_ipは呼び出し元のNext.js Route Handlerが決定する(x-forwarded-forの
-- 先頭値、Vercelなどプラットフォームが上書きするヘッダを信頼する。信頼できる
-- 発信元ヘッダを持たない自己ホスティング構成では、運用者が同等の保証を
-- 用意する必要がある)。IPを特定できない場合は固定の代表値を渡す運用とし、
-- その場合は同一バケットとしてまとめて制限される(制限の回避ではなく、
-- より厳しめの共有制限になる方向)。
--
-- この関数はトークンの有効性によらず常に成功する契約(YDR-019、下のコメント
-- 参照)を維持するため、制限超過時も例外を投げず、常に同じ形の結果を返す。
-- 制限超過時はpending_claims行を作らない(招待やclaim状態を一切変更しない、
-- Issue #70受け入れ基準)。作らなくても、返すclaim secretはどこにも紐付かず
-- 単体では受諾に使えないため、無効なトークンの結果と外部から区別できない。
create or replace function public.open_invitation_claim(invitation_token text, p_client_ip text)
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
  recent_attempts integer;
  exchange_limit_count constant integer := 20;
  exchange_window constant interval := interval '10 minutes';
begin
  recent_attempts := public._security_event_recent_count(
    'invitation_exchange', p_client_ip, exchange_window
  );

  if recent_attempts >= exchange_limit_count then
    perform public._security_event_log('invitation_exchange', p_client_ip, 'rate_limited', null);
    return query select new_claim_secret, public_expires_at;
    return;
  end if;

  perform public._security_event_log('invitation_exchange', p_client_ip, 'attempt', null);

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

alter function public.open_invitation_claim(text, text) owner to postgres;
-- service_role以外は実行できない(サーバー専用境界)。Next.jsのRoute Handlerが
-- IPアドレス単位のレート制限を判断できる唯一の呼び出し元になる。
revoke all on function public.open_invitation_claim(text, text) from public, anon, authenticated;
grant execute on function public.open_invitation_claim(text, text) to service_role;

comment on function public.open_invitation_claim(text, text) is
  '招待リンクの生トークンを、短命な一時状態への不透明な参照(claim secret)へ交換する。service_role経由でのみ呼べる(Issue #70)。トークンの有効性によらず常に同じ形の結果を返す(YDR-019、判定はaccept_household_invitation_by_claimへ遅延)。p_client_ipでIPアドレス単位の試行回数を制限する。';

-- ---------------------------------------------------------------------------
-- accept_household_invitation_by_claim: サーバー専用境界へ移し、
-- 認証済み利用者単位で受諾失敗を制限する
-- ---------------------------------------------------------------------------
-- 旧シグネチャ(claim_secretのみの1引数)を明示的に削除する(理由は
-- open_invitation_claimと同じ)。
drop function public.accept_household_invitation_by_claim(text);

-- p_user_idは呼び出し元のServer Actionがsupabase.auth.getUser()で検証済みの
-- 利用者IDを渡す(service_role経由ではauth.uid()が常にnullになるため)。
--
-- 失敗種別はraise exceptionではなく戻り値のresult_code('success' /
-- 'cross_household' / 'invalid')で表現する。理由: レート制限の判定に使う
-- セキュリティログは、失敗試行についても記録する必要があるが、raise exception
-- は同一トランザクション内の直前の変更(ログ挿入を含む)を巻き戻すため、
-- 例外で失敗を伝えると失敗ログが残らない。呼び出し元(Server Action)は
-- 従来のerror.code分岐と同じ粒度でresult_codeを見て共通エラー表示へ畳み込む
-- ため、利用者に見える挙動(YDR-019の共通エラー原則)は変えない。
create or replace function public.accept_household_invitation_by_claim(
  p_user_id uuid,
  claim_secret text
)
returns table (result_code text, household_id uuid, membership_created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  accepting_email text;
  existing_household_id uuid;
  matched_claim public.invitation_pending_claims%rowtype;
  matched_invitation public.household_invitations%rowtype;
  claim_found boolean := false;
  email_matches boolean := false;
  inserted_membership_count integer;
  claim_fingerprint text := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(claim_secret, 'UTF8'), 'sha256'), 'hex'
  );
  recent_failures integer;
  accept_limit_count constant integer := 5;
  accept_window constant interval := interval '15 minutes';
begin
  -- service_role経由の呼び出し契約(呼び出し元がAuthで検証済みのIDを渡す)が
  -- 破られた場合の防御的なチェック。攻撃者が試行できる経路ではないため、
  -- レート制限やログの対象にはしない(プログラミング上の契約違反として扱う)。
  if p_user_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'Authentication required';
  end if;

  -- 認証済み利用者単位の受諾失敗を制限する(YDR-019, Issue #70)。無効なトークン
  -- の試行だけを対象にすると制限の発火自体がオラクルになるため、有効な
  -- トークンによる失敗(別家庭所属など)も同じ制限対象に含める(下の各分岐で
  -- 一律にfailureを記録する)。制限中はmembership・invitation・claimの状態を
  -- 一切確認・変更せず、下の共通エラーと区別できない結果を返す。
  recent_failures := public._security_event_recent_count(
    'invitation_accept', p_user_id::text, accept_window
  );

  if recent_failures >= accept_limit_count then
    perform public._security_event_log(
      'invitation_accept', p_user_id::text, 'rate_limited', claim_fingerprint
    );
    return query select 'invalid'::text, null::uuid, null::boolean;
    return;
  end if;

  -- 既存membershipの有無を先に確定する(以後の分岐は常にこの値を参照する)。
  select member.household_id
    into existing_household_id
    from public.household_members member
   where member.user_id = p_user_id
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
     where u.id = p_user_id
       and u.email_confirmed_at is not null;

    email_matches := accepting_email is not null
      and pg_catalog.lower(pg_catalog.btrim(accepting_email))
        = pg_catalog.lower(pg_catalog.btrim(matched_invitation.invited_email));
  end if;

  if claim_found and email_matches and existing_household_id is not null then
    if existing_household_id <> matched_invitation.household_id then
      perform public._security_event_log(
        'invitation_accept', p_user_id::text, 'failure', claim_fingerprint
      );
      return query select 'cross_household'::text, null::uuid, null::boolean;
      return;
    end if;

    -- 冪等な成功: 既に招待先家庭のメンバーなので、membershipは追加せず
    -- 招待とclaimだけを使用済みにする(YDR-019, スパイクの既存動作を踏襲)。
    update public.invitation_pending_claims claim
       set consumed_at = pg_catalog.statement_timestamp()
     where claim.id = matched_claim.id;

    update public.household_invitations invitation
       set accepted_at = pg_catalog.statement_timestamp(),
           accepted_by = p_user_id
     where invitation.id = matched_invitation.id;

    perform public._security_event_log(
      'invitation_accept', p_user_id::text, 'success', claim_fingerprint
    );
    return query select 'success'::text, matched_invitation.household_id, false;
    return;
  end if;

  if not (claim_found and email_matches) then
    perform public._security_event_log(
      'invitation_accept', p_user_id::text, 'failure', claim_fingerprint
    );

    if existing_household_id is not null then
      return query select 'cross_household'::text, null::uuid, null::boolean;
    else
      return query select 'invalid'::text, null::uuid, null::boolean;
    end if;
    return;
  end if;

  -- ここに到達するのはclaim_found and email_matches and existing_household_id is null。
  begin
    insert into public.household_members (household_id, user_id)
    values (matched_invitation.household_id, p_user_id);
  exception
    when unique_violation then
      -- 直前の並行リクエストが別の招待を先に受諾した場合の競合。
      -- membership・invitation・claimのいずれも変更せず、同一のエラーで拒否する。
      perform public._security_event_log(
        'invitation_accept', p_user_id::text, 'failure', claim_fingerprint
      );
      return query select 'cross_household'::text, null::uuid, null::boolean;
      return;
  end;

  get diagnostics inserted_membership_count = row_count;

  update public.invitation_pending_claims claim
     set consumed_at = pg_catalog.statement_timestamp()
   where claim.id = matched_claim.id;

  update public.household_invitations invitation
     set accepted_at = pg_catalog.statement_timestamp(),
         accepted_by = p_user_id
   where invitation.id = matched_invitation.id;

  perform public._security_event_log(
    'invitation_accept', p_user_id::text, 'success', claim_fingerprint
  );
  return query select 'success'::text, matched_invitation.household_id, inserted_membership_count = 1;
end;
$$;

alter function public.accept_household_invitation_by_claim(uuid, text) owner to postgres;
-- authenticated以外は実行できない…のではなく、service_role以外は実行できない
-- (サーバー専用境界)。Next.jsのServer Actionがgetユーザーを検証したうえで
-- 呼ぶ唯一の呼び出し元になる。
revoke all on function public.accept_household_invitation_by_claim(uuid, text)
  from public, anon, authenticated;
grant execute on function public.accept_household_invitation_by_claim(uuid, text) to service_role;

comment on function public.accept_household_invitation_by_claim(uuid, text) is
  'service_role経由でのみ呼べる(Issue #70)。呼び出し元がAuthで検証済みのp_user_idで、claim secretによる招待受諾を行う。メール一致と一人一家庭制約下の二段階エラー方針(YDR-019)を、raise exceptionではなくresult_codeの戻り値で表現する(失敗ログの記録がロールバックで消えないようにするため)。';
