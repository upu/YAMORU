import type { IntegrationPrincipal } from "../../features/integration/principal";

export type McpBudgetCategory = "read" | "prepare" | "commit";
export type McpCommitLease = { connectionId: string; slot: number; leaseId: string; expiresAt: number };
type Budget = { ok: true; lease: McpCommitLease | null } | { ok: false; retryAfter: number };
const LIMITS = { read: 60, prepare: 20, commit: 20 };
const LEASE_MS = 120_000;
const ACTIVE_CONNECTION = `SELECT 1 FROM oauth_connections c JOIN users u ON u.id=c.user_id
  WHERE c.id=?1 AND c.user_id=?2 AND c.household_id=?3 AND c.client_id=?4
  AND c.revoked_at IS NULL AND c.expires_at>?5 AND c.user_session_version=u.session_version
  AND EXISTS(SELECT 1 FROM household_members m WHERE m.household_id=c.household_id AND m.user_id=c.user_id)`;

export async function acquireMcpBudget(db: D1Database, principal: IntegrationPrincipal, category: McpBudgetCategory, now: Date): Promise<Budget> {
  const instant = now.getTime();
  const window = Math.floor(instant / 60_000) * 60_000;
  await db.prepare(`DELETE FROM integration_mcp_rate_windows WHERE rowid IN
    (SELECT rowid FROM integration_mcp_rate_windows WHERE window_start<? ORDER BY window_start LIMIT 100)`)
    .bind(window - 120_000).run();
  const counted = await db.prepare(`INSERT INTO integration_mcp_rate_windows(user_id,bucket,window_start,request_count)
    SELECT ?2,?6,?7,1 WHERE EXISTS(${ACTIVE_CONNECTION})
    ON CONFLICT(user_id,bucket,window_start) DO UPDATE SET request_count=request_count+1
    WHERE request_count<?8 RETURNING request_count`)
    .bind(principal.connectionId, principal.userId, principal.householdId, principal.clientId, now.toISOString(), category, window, LIMITS[category]).first();
  if (!counted) return { ok: false, retryAfter: Math.max(1, Math.ceil((window + 60_000 - instant) / 1000)) };
  if (category !== "commit") return { ok: true, lease: null };
  const leaseId = crypto.randomUUID();
  const expiresAt = instant + LEASE_MS;
  const lease = await db.prepare(`INSERT INTO integration_mcp_commit_leases(connection_id,slot,lease_id,expires_at)
    SELECT ?1,s.slot,?6,?7 FROM (SELECT 0 AS slot UNION ALL SELECT 1) s
    WHERE EXISTS(${ACTIVE_CONNECTION}) AND NOT EXISTS
      (SELECT 1 FROM integration_mcp_commit_leases l WHERE l.connection_id=?1 AND l.slot=s.slot AND l.expires_at>?8)
    ORDER BY s.slot LIMIT 1
    ON CONFLICT(connection_id,slot) DO UPDATE SET lease_id=excluded.lease_id,expires_at=excluded.expires_at
    WHERE integration_mcp_commit_leases.expires_at<=?8 RETURNING slot`)
    .bind(principal.connectionId, principal.userId, principal.householdId, principal.clientId, now.toISOString(), leaseId, expiresAt, instant).first<{ slot: number }>();
  return lease ? { ok: true, lease: { connectionId: principal.connectionId, slot: lease.slot, leaseId, expiresAt } } : { ok: false, retryAfter: LEASE_MS / 1000 };
}

export async function releaseMcpLease(db: D1Database, lease: McpCommitLease): Promise<void> {
  await db.prepare("DELETE FROM integration_mcp_commit_leases WHERE connection_id=? AND slot=? AND lease_id=?")
    .bind(lease.connectionId, lease.slot, lease.leaseId).run();
}

// batch内のDB時刻でfenceする。古いWorkerが再開しても置換後の枠で書けない。
export function mcpCommitGuard(db: D1Database, lease: McpCommitLease): D1PreparedStatement {
  return db.prepare(`INSERT INTO integration_mcp_commit_leases(connection_id,slot,lease_id,expires_at)
    VALUES(?1,CASE WHEN EXISTS(SELECT 1 FROM integration_mcp_commit_leases
      WHERE connection_id=?1 AND slot=?2 AND lease_id=?3 AND expires_at>unixepoch('subsec')*1000)
      THEN ?2 ELSE -1 END,?3,?4) ON CONFLICT(connection_id,slot) DO NOTHING`)
    .bind(lease.connectionId, lease.slot, lease.leaseId, lease.expiresAt);
}
