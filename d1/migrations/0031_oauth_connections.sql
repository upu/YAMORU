-- #436: 会話エージェントなどの外部クライアントへ、利用者本人が家庭データへの
-- アクセスをOAuth 2.1(authorization code + PKCE)で委任する。
-- 設計の正本はdocs/product/conversation-integration.mdの3節とYDR-049、
-- 実装方式はYDR-052。
--
-- 追加だけのexpand migrationであり、既存テーブルを変更しない。旧Workerは
-- これらのテーブルを参照しないため、適用後も旧Workerのまま動き続ける。
-- 外部接続の受付は環境変数YAMORU_OAUTH_ALLOWED_CLIENT_IDSを設定するまで
-- 無効であり、新Workerを配備しただけでは接続を受け付けない。
--
-- 生のcode・access token・refresh tokenは保存しない。SHA-256のhexだけを
-- 保存し、照合はhashの一致で行う。

-- Client ID Metadata Document(CIMD)から取得したクライアント情報の写し。
-- 家庭データではなく、YAMORU全体で共有する。idはclient_id(HTTPSのURL)。
CREATE TABLE oauth_clients (
  id TEXT PRIMARY KEY,
  client_name TEXT NOT NULL,
  client_uri TEXT,
  redirect_uris TEXT NOT NULL,
  metadata_fetched_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (id LIKE 'https://%' AND length(id) <= 2048),
  CHECK (length(client_name) BETWEEN 1 AND 100),
  CHECK (json_valid(redirect_uris) AND json_type(redirect_uris) = 'array')
);

-- 利用者が同意した一つの接続(grant)。接続時の家庭へ固定し、所属が変わった
-- 場合は失効させる。パスワードの変更・再設定(users.session_version)でも
-- Webのログイン状態と同じく失効させる。解除後も履歴として行を残し、
-- revoked_atで無効を表す。
CREATE TABLE oauth_connections (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES oauth_clients(id),
  -- 同意画面に表示したクライアント名。後でCIMDが変わっても、利用者が
  -- 同意した時点の表示を接続管理画面で確認できるよう写しておく。
  client_name TEXT NOT NULL,
  scopes TEXT NOT NULL,
  resource TEXT NOT NULL,
  issuer TEXT NOT NULL,
  -- 接続を作った時点のusers.session_version。
  user_session_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  -- 最後に発行したrefresh tokenの期限。これを過ぎた接続は再接続が必要。
  expires_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT,
  revoked_reason TEXT,
  CHECK (length(client_name) BETWEEN 1 AND 100),
  CHECK (length(scopes) BETWEEN 1 AND 200),
  CHECK (expires_at > created_at),
  CHECK (
    revoked_reason IS NULL
    OR revoked_reason IN (
      'user_revoked', 'client_revoked', 'membership_changed', 'credentials_changed', 'token_reuse_detected'
    )
  ),
  CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))
);

CREATE INDEX oauth_connections_user_created_idx
  ON oauth_connections(user_id, created_at DESC);

-- 一回限り・短命のauthorization code。同意した利用者・家庭・scope・
-- redirect_uri・resource・PKCEのchallengeを束縛する。消費後も期限までは
-- 残し、再使用を検知したらその交換で作られた接続を失効させる。
CREATE TABLE oauth_authorization_codes (
  code_hash TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES oauth_clients(id),
  scopes TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  resource TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  connection_id TEXT REFERENCES oauth_connections(id) ON DELETE CASCADE,
  CHECK (code_challenge_method = 'S256'),
  CHECK (length(code_challenge) BETWEEN 43 AND 128),
  CHECK (expires_at > created_at)
);

CREATE INDEX oauth_authorization_codes_expires_idx
  ON oauth_authorization_codes(expires_at);

-- access token(短命)とrefresh token(ローテーション)。接続の失効は
-- oauth_connections.revoked_atで判定し、解除時はこの行も削除する。
-- rotated_atはrefresh tokenを使用済みにした時刻で、再使用の検知に使う。
CREATE TABLE oauth_tokens (
  token_hash TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES oauth_connections(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  scopes TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  rotated_at TEXT,
  CHECK (kind IN ('access', 'refresh')),
  CHECK (kind = 'refresh' OR rotated_at IS NULL),
  CHECK (expires_at > created_at)
);

CREATE INDEX oauth_tokens_connection_idx
  ON oauth_tokens(connection_id, kind, expires_at);
