// 外部クライアントとの接続(grant)とtoken(#436、YDR-052)。
//
// 接続は同意した利用者本人と、その時点の家庭へ固定する。家庭への所属は
// tokenを使うたびに確かめ、所属が変わっていれば接続を失効させる
// (docs/product/conversation-integration.md 3節)。解除後も接続の行は履歴として
// 残し、tokenは削除する。生のtokenは保存せず、hash化した値だけを受け取る。

import { requireD1Session, type D1Session } from "./authorization";

export const CONNECTION_REVOKED_REASONS = [
  "user_revoked",
  "client_revoked",
  "membership_changed",
  "credentials_changed",
  "token_reuse_detected",
] as const;

export type ConnectionRevokedReason = (typeof CONNECTION_REVOKED_REASONS)[number];

export type IssuedTokenHashes = {
  access: { expiresAt: string; hash: string };
  refresh: { expiresAt: string; hash: string };
};

export type NewConnection = {
  clientId: string;
  codeHash: string;
  connectionId: string;
  householdId: string;
  issuer: string;
  now: string;
  resource: string;
  scopes: string;
  userId: string;
};

// 最終利用日時は一覧での目安なので、tokenを使うたびには書かない。
const LAST_USED_WRITE_INTERVAL_MS = 5 * 60 * 1000;

function insertTokenStatement(
  db: D1Database,
  connectionId: string,
  kind: "access" | "refresh",
  token: { expiresAt: string; hash: string },
  scopes: string,
  now: string,
): D1PreparedStatement {
  // 接続が有効なときだけtokenを作る。同じbatchの前段で接続の作成や更新が
  // 条件に合わず0件だった場合、tokenも作られない。
  return db.prepare(
    `INSERT INTO oauth_tokens (token_hash, connection_id, kind, scopes, created_at, expires_at)
     SELECT ?1, ?2, ?3, ?4, ?5, ?6
      WHERE EXISTS (
        SELECT 1 FROM oauth_connections WHERE id = ?2 AND revoked_at IS NULL
      )`,
  ).bind(token.hash, connectionId, kind, scopes, now, token.expiresAt);
}

// authorization codeの交換で、接続と最初のtokenを一度に作る。codeが消費済み
// かつ未交換で、利用者がまだその家庭に所属し、同意した時点からパスワードが
// 変わっていない場合だけ成功する。codeに写した世代を接続へ引き継ぐ。
export async function createConnectionFromCode(
  db: D1Database,
  connection: NewConnection,
  tokens: IssuedTokenHashes,
): Promise<boolean> {
  const c = connection;
  const [created] = await db.batch([
    db.prepare(
      `INSERT INTO oauth_connections (
         id, household_id, user_id, client_id, client_name, scopes, resource,
         issuer, user_session_version, created_at, expires_at
       )
       SELECT ?1, ?2, ?3, ?4, code.client_name, ?5, ?6, ?7, code.user_session_version, ?8, ?9
         FROM oauth_authorization_codes code
         JOIN users u ON u.id = code.user_id AND u.session_version = code.user_session_version
        WHERE code.code_hash = ?10 AND code.consumed_at IS NOT NULL
          AND code.connection_id IS NULL AND code.replayed_at IS NULL
          AND code.household_id = ?2 AND code.user_id = ?3 AND code.client_id = ?4
          AND EXISTS (
          SELECT 1 FROM household_members WHERE household_id = ?2 AND user_id = ?3
        )`,
    ).bind(
      c.connectionId, c.householdId, c.userId, c.clientId, c.scopes,
      c.resource, c.issuer, c.now, tokens.refresh.expiresAt, c.codeHash,
    ),
    db.prepare(
      `UPDATE oauth_authorization_codes SET connection_id = ?2
        WHERE code_hash = ?1 AND connection_id IS NULL
          AND EXISTS (SELECT 1 FROM oauth_connections WHERE id = ?2)`,
    ).bind(c.codeHash, c.connectionId),
    insertTokenStatement(db, c.connectionId, "access", tokens.access, c.scopes, c.now),
    insertTokenStatement(db, c.connectionId, "refresh", tokens.refresh, c.scopes, c.now),
  ]);
  return created.meta.changes === 1;
}

// refresh tokenのローテーションで新しいtokenを発行し、接続の期限を延ばす。
// refreshでscopeを縮めた場合は、以後そのscopeしか得られないため、接続の
// scopeも同じ値へ更新する(接続管理画面が実際より広い権限を示さないように)。
// 以前に発行した、より広いscopeのaccess tokenも期限を待たずに無効にする。
export async function issueRotatedTokens(
  db: D1Database,
  connectionId: string,
  scopes: string,
  tokens: IssuedTokenHashes,
  now: string,
): Promise<boolean> {
  const results = await db.batch([
    db.prepare(
      `DELETE FROM oauth_tokens
        WHERE connection_id = ?1 AND (expires_at <= ?2 OR (kind = 'access' AND scopes <> ?3))`,
    ).bind(connectionId, now, scopes),
    db.prepare(
      `UPDATE oauth_connections SET expires_at = ?2, scopes = ?3
        WHERE id = ?1 AND revoked_at IS NULL`,
    ).bind(connectionId, tokens.refresh.expiresAt, scopes),
    insertTokenStatement(db, connectionId, "access", tokens.access, scopes, now),
    insertTokenStatement(db, connectionId, "refresh", tokens.refresh, scopes, now),
  ]);
  return results[3].meta.changes === 1;
}

// 使用済みにできたときだけtrue。同じrefresh tokenの同時使用では1件だけが成功する。
export async function rotateRefreshToken(
  db: D1Database,
  tokenHash: string,
  now: string,
): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE oauth_tokens SET rotated_at = ?2
      WHERE token_hash = ?1 AND kind = 'refresh' AND rotated_at IS NULL AND expires_at > ?2`,
  ).bind(tokenHash, now).run();
  return result.meta.changes === 1;
}

export type TokenLookup = {
  clientId: string;
  credentialsCurrent: boolean;
  connectionId: string;
  expiresAt: string;
  householdId: string;
  isMember: boolean;
  issuer: string;
  lastUsedAt: string | null;
  resource: string;
  revokedAt: string | null;
  rotatedAt: string | null;
  scopes: string;
  userId: string;
};

type TokenLookupRow = {
  client_id: string;
  credentials_current: number;
  connection_id: string;
  expires_at: string;
  household_id: string;
  is_member: number;
  issuer: string;
  last_used_at: string | null;
  resource: string;
  revoked_at: string | null;
  rotated_at: string | null;
  scopes: string;
  user_id: string;
};

export async function findToken(
  db: D1Database,
  tokenHash: string,
  kind: "access" | "refresh",
): Promise<TokenLookup | null> {
  const row = await db.prepare(
    `SELECT t.expires_at, t.scopes, t.rotated_at,
            c.id AS connection_id, c.household_id, c.user_id, c.client_id,
            c.resource, c.issuer, c.revoked_at, c.last_used_at,
            EXISTS (
              SELECT 1 FROM household_members m
               WHERE m.household_id = c.household_id AND m.user_id = c.user_id
            ) AS is_member,
            u.session_version = c.user_session_version AS credentials_current
       FROM oauth_tokens t
       JOIN oauth_connections c ON c.id = t.connection_id
       JOIN users u ON u.id = c.user_id
      WHERE t.token_hash = ?1 AND t.kind = ?2`,
  ).bind(tokenHash, kind).first<TokenLookupRow>();
  if (row === null) return null;
  return {
    clientId: row.client_id,
    credentialsCurrent: row.credentials_current === 1,
    connectionId: row.connection_id,
    expiresAt: row.expires_at,
    householdId: row.household_id,
    isMember: row.is_member === 1,
    issuer: row.issuer,
    lastUsedAt: row.last_used_at,
    resource: row.resource,
    revokedAt: row.revoked_at,
    rotatedAt: row.rotated_at,
    scopes: row.scopes,
    userId: row.user_id,
  };
}

// 接続時の前提(家庭への所属、パスワードの世代)が崩れていれば、その理由を返す。
// 呼び出し側はこの理由で接続を失効させ、要求を拒否する。
export function lostConnectionPremise(token: TokenLookup): ConnectionRevokedReason | null {
  if (!token.isMember) return "membership_changed";
  if (!token.credentialsCurrent) return "credentials_changed";
  return null;
}

// 接続を失効させ、発行済みtokenを削除する。すでに失効していれば何もしない。
export async function revokeConnection(
  db: D1Database,
  connectionId: string,
  reason: ConnectionRevokedReason,
  now: string,
): Promise<boolean> {
  const [revoked] = await db.batch([
    db.prepare(
      `UPDATE oauth_connections SET revoked_at = ?2, revoked_reason = ?3
        WHERE id = ?1 AND revoked_at IS NULL`,
    ).bind(connectionId, now, reason),
    db.prepare("DELETE FROM oauth_tokens WHERE connection_id = ?1").bind(connectionId),
  ]);
  return revoked.meta.changes === 1;
}

// 利用者が自分の接続を解除する。家族を含む他人の接続IDを渡しても0件になる。
export async function revokeConnectionForUser(
  db: D1Database,
  session: D1Session,
  connectionId: string,
  now: string,
): Promise<boolean> {
  const user = requireD1Session(session);
  const [revoked] = await db.batch([
    db.prepare(
      `UPDATE oauth_connections SET revoked_at = ?3, revoked_reason = 'user_revoked'
        WHERE id = ?1 AND user_id = ?2 AND revoked_at IS NULL`,
    ).bind(connectionId, user.userId, now),
    db.prepare(
      `DELETE FROM oauth_tokens
        WHERE connection_id IN (SELECT id FROM oauth_connections WHERE id = ?1 AND user_id = ?2)`,
    ).bind(connectionId, user.userId),
  ]);
  return revoked.meta.changes === 1;
}

export async function touchConnection(
  db: D1Database,
  connectionId: string,
  now: Date,
): Promise<void> {
  const threshold = new Date(now.getTime() - LAST_USED_WRITE_INTERVAL_MS).toISOString();
  await db.prepare(
    `UPDATE oauth_connections SET last_used_at = ?2
      WHERE id = ?1 AND (last_used_at IS NULL OR last_used_at < ?3)`,
  ).bind(connectionId, now.toISOString(), threshold).run();
}

// 通知配信(#442)などtokenを介さない経路が、送信直前に接続の有効性を確かめる。
// 解除・期限切れ・所属の変更・パスワードの変更のいずれかがあればfalse。
export async function isConnectionActive(
  db: D1Database,
  connectionId: string,
  now: string,
): Promise<boolean> {
  const row = await db.prepare(
    `SELECT 1 AS active
       FROM oauth_connections c
       JOIN household_members m ON m.household_id = c.household_id AND m.user_id = c.user_id
       JOIN users u ON u.id = c.user_id AND u.session_version = c.user_session_version
      WHERE c.id = ?1 AND c.revoked_at IS NULL AND c.expires_at > ?2`,
  ).bind(connectionId, now).first<{ active: number }>();
  return row !== null;
}
