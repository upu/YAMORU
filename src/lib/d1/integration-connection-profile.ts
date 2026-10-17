import type { IntegrationPrincipal } from "../../features/integration/principal";
export async function readIntegrationConnectionProfile(db: D1Database, principal: IntegrationPrincipal) {
  return db.prepare(`SELECT p.nickname AS user_name,h.name AS household_name,c.expires_at FROM oauth_connections c
    JOIN household_members m ON m.household_id=c.household_id AND m.user_id=c.user_id JOIN households h ON h.id=c.household_id
    LEFT JOIN profiles p ON p.user_id=c.user_id WHERE c.id=? AND c.household_id=? AND c.user_id=? AND c.client_id=?`)
    .bind(principal.connectionId, principal.householdId, principal.userId, principal.clientId).first<{ user_name: string | null; household_name: string; expires_at: string }>();
}
