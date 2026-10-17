// OAuthのauthorization code(#436、YDR-052)。一回限り・短命で、同意した
// 利用者・家庭・scope・redirect_uri・resource・PKCE challengeを束縛する。
// 生のcodeは保存せず、呼び出し側がhash化した値だけを受け取る。

export type AuthorizationCodeRecord = {
  clientId: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  codeHash: string;
  createdAt: string;
  expiresAt: string;
  householdId: string;
  redirectUri: string;
  resource: string;
  scopes: string;
  userId: string;
  userSessionVersion: number;
};

export type StoredAuthorizationCode = AuthorizationCodeRecord & {
  connectionId: string | null;
  consumedAt: string | null;
};

type AuthorizationCodeRow = {
  client_id: string;
  code_challenge: string;
  code_challenge_method: "S256";
  code_hash: string;
  connection_id: string | null;
  consumed_at: string | null;
  created_at: string;
  expires_at: string;
  household_id: string;
  redirect_uri: string;
  resource: string;
  scopes: string;
  user_id: string;
  user_session_version: number;
};

// 同意した時点で利用者がその家庭に所属していることを、INSERTと同じ文で
// 確かめる。所属していなければ0件となり、codeを発行しない。同意画面で
// 確かめたパスワードの世代が現在のusersと一致することも同じ文で確かめ、
// その世代をcodeへ写す(同意の途中でパスワードが変わったら発行しない)。
export async function saveAuthorizationCode(
  db: D1Database,
  record: AuthorizationCodeRecord,
): Promise<boolean> {
  const [, inserted] = await db.batch([
    // 期限切れのcodeは再使用検知にも使えないため、発行のたびに掃除する。
    db.prepare("DELETE FROM oauth_authorization_codes WHERE expires_at < ?1")
      .bind(record.createdAt),
    db.prepare(
      `INSERT INTO oauth_authorization_codes (
         code_hash, household_id, user_id, client_id, scopes, redirect_uri,
         resource, code_challenge, code_challenge_method, user_session_version,
         created_at, expires_at
       )
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, u.session_version, ?10, ?11
         FROM users u
        WHERE u.id = ?3 AND u.session_version = ?12
          AND EXISTS (
          SELECT 1 FROM household_members
           WHERE household_id = ?2 AND user_id = ?3
        )`,
    ).bind(
      record.codeHash,
      record.householdId,
      record.userId,
      record.clientId,
      record.scopes,
      record.redirectUri,
      record.resource,
      record.codeChallenge,
      record.codeChallengeMethod,
      record.createdAt,
      record.expiresAt,
      record.userSessionVersion,
    ),
  ]);
  return inserted.meta.changes === 1;
}

export async function findAuthorizationCode(
  db: D1Database,
  codeHash: string,
): Promise<StoredAuthorizationCode | null> {
  const row = await db.prepare(
    `SELECT code_hash, household_id, user_id, client_id, scopes, redirect_uri,
            resource, code_challenge, code_challenge_method, created_at,
            expires_at, consumed_at, connection_id, user_session_version
       FROM oauth_authorization_codes
      WHERE code_hash = ?1`,
  ).bind(codeHash).first<AuthorizationCodeRow>();
  if (row === null) return null;
  return {
    clientId: row.client_id,
    codeChallenge: row.code_challenge,
    codeChallengeMethod: row.code_challenge_method,
    codeHash: row.code_hash,
    connectionId: row.connection_id,
    consumedAt: row.consumed_at,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    householdId: row.household_id,
    redirectUri: row.redirect_uri,
    resource: row.resource,
    scopes: row.scopes,
    userId: row.user_id,
    userSessionVersion: row.user_session_version,
  };
}

// 条件付き更新で一度だけ消費する。同時に2つの交換が来ても1件だけが成功する。
export async function consumeAuthorizationCode(
  db: D1Database,
  codeHash: string,
  now: string,
): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE oauth_authorization_codes
        SET consumed_at = ?2
      WHERE code_hash = ?1 AND consumed_at IS NULL AND expires_at > ?2`,
  ).bind(codeHash, now).run();
  return result.meta.changes === 1;
}

// 消費済みのcodeが再び提示された(または同時の交換で消費に負けた)ことを記録し、
// そのcodeから作られた接続があればIDを返す。期限を過ぎたcodeは対象にしない。記録とIDの読み取りを同じbatchで
// 行うため、交換の勝者が接続を作るのはこの記録より前(IDが返る)か、後
// (createConnectionFromCodeがreplayed_atを見て作らない)のどちらかになる。
export async function markAuthorizationCodeReplayed(
  db: D1Database,
  codeHash: string,
  now: string,
): Promise<string | null> {
  const [, selected] = await db.batch([
    db.prepare(
      `UPDATE oauth_authorization_codes SET replayed_at = ?2
        WHERE code_hash = ?1 AND replayed_at IS NULL AND expires_at > ?2`,
    ).bind(codeHash, now),
    db.prepare(
      "SELECT connection_id FROM oauth_authorization_codes WHERE code_hash = ?1 AND expires_at > ?2",
    ).bind(codeHash, now),
  ]);
  const row = (selected.results as { connection_id: string | null }[])[0] as
    | { connection_id: string | null }
    | undefined;
  return row?.connection_id ?? null;
}
