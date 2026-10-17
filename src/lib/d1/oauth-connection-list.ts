// 接続管理画面(#436)に出す、本人の外部接続の一覧。解除済み・期限切れも
// 履歴として返す。接続は本人のものだけを返し、同じ家庭の家族の接続も含めない。

import { requireD1Session, type D1Session } from "./authorization";
import type { ConnectionRevokedReason } from "./oauth-connections";

export type ConnectionStatus = "active" | "expired" | "revoked";

export type ConnectionSummary = {
  clientId: string;
  clientName: string;
  createdAt: string;
  expiresAt: string;
  householdName: string | null;
  id: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  revokedReason: ConnectionRevokedReason | null;
  scopes: string;
  status: ConnectionStatus;
};

type ConnectionRow = {
  client_id: string;
  client_name: string;
  created_at: string;
  expires_at: string;
  credentials_current: number;
  household_name: string | null;
  id: string;
  is_member: number;
  last_used_at: string | null;
  revoked_at: string | null;
  revoked_reason: ConnectionRevokedReason | null;
  scopes: string;
};

// 解除済みの履歴は新しい順に上限まで返す。まだ解除していない接続(期限切れを
// 含む)は、確認・解除できなくならないよう件数によらずすべて返す。
const REVOKED_HISTORY_LIMIT = 50;

// まだ解除の記録が無くても、token検証と同じ前提(家庭への所属とパスワードの
// 世代)が崩れた接続は使えないため、解除済みとして理由とともに示す。記録は
// 次にtokenが使われたときに残る(bearer.ts / model.ts)。
function effectiveRevokedReason(row: ConnectionRow): ConnectionRevokedReason | null {
  if (row.revoked_reason !== null) return row.revoked_reason;
  if (row.is_member !== 1) return "membership_changed";
  if (row.credentials_current !== 1) return "credentials_changed";
  return null;
}

function statusOf(row: ConnectionRow, now: string): ConnectionStatus {
  if (effectiveRevokedReason(row) !== null) return "revoked";
  return row.expires_at > now ? "active" : "expired";
}

export async function listConnectionsForUser(
  db: D1Database,
  session: D1Session,
  now: string,
): Promise<ConnectionSummary[]> {
  const user = requireD1Session(session);
  // 家庭名は、本人が今もその家庭に所属している場合だけ表示する。離脱した
  // 家庭の名前を、接続の一覧を経由して読めるようにしない。
  const { results } = await db.prepare(
    `SELECT c.id, c.client_id, c.client_name, c.scopes, c.created_at, c.expires_at,
            c.last_used_at, c.revoked_at, c.revoked_reason,
            EXISTS (
              SELECT 1 FROM household_members m
               WHERE m.household_id = c.household_id AND m.user_id = c.user_id
            ) AS is_member,
            (SELECT u.session_version = c.user_session_version FROM users u WHERE u.id = c.user_id)
              AS credentials_current,
            (SELECT h.name FROM households h
               JOIN household_members m ON m.household_id = h.id
              WHERE h.id = c.household_id AND m.user_id = c.user_id) AS household_name
       FROM oauth_connections c
      WHERE c.user_id = ?1
        AND (
          c.revoked_at IS NULL
          OR c.id IN (
            SELECT id FROM oauth_connections
             WHERE user_id = ?1 AND revoked_at IS NOT NULL
             ORDER BY created_at DESC, id DESC
             LIMIT ?2
          )
        )
      ORDER BY c.created_at DESC, c.id DESC`,
  ).bind(user.userId, REVOKED_HISTORY_LIMIT).all<ConnectionRow>();
  return results.map((row) => ({
    clientId: row.client_id,
    clientName: row.client_name,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    householdName: row.household_name,
    id: row.id,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    revokedReason: effectiveRevokedReason(row),
    scopes: row.scopes,
    status: statusOf(row, now),
  }));
}
