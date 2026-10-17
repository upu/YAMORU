import type { IntegrationPrincipal } from "../principal";
import { createReadCursor, cursorScope } from "../read-cursor";
import { ReadError } from "../read-contract";
import { isConnectionActive } from "../../../lib/d1/oauth-connections";
import { getNotificationSettings, usableNotificationConnection } from "../../../lib/d1/notification-settings";
import { listDeliveries } from "../../../lib/d1/notification-deliveries";
import { nextNotificationTime } from "./schedule";
import { deliveryToWire, settingsToWire } from "./wire";

type Dependencies = { db: D1Database; authorize: () => Promise<IntegrationPrincipal>; cursorSecret: string; now?: () => Date };
async function authorized(deps: Dependencies, now: Date) {
  const principal = await deps.authorize();
  if (!principal.scopes.includes("household.read") || !principal.scopes.includes("notifications.manage")) throw new ReadError("insufficient_scope");
  const row = await deps.db.prepare(`SELECT 1 FROM oauth_connections c WHERE c.id=? AND c.household_id=? AND c.user_id=? AND c.client_id=?
    AND instr(' '||c.scopes||' ',' notifications.manage ')>0 AND instr(' '||c.scopes||' ',' household.read ')>0`)
    .bind(principal.connectionId, principal.householdId, principal.userId, principal.clientId).first();
  if (!row || !await isConnectionActive(deps.db, principal.connectionId, now.toISOString())) throw new ReadError("not_found");
  return principal;
}
export function createNotificationReader(deps: Dependencies) {
  const cursor = createReadCursor(deps.cursorSecret);
  return {
    async notificationSettingsGet() {
      const now = deps.now?.() ?? new Date();
      const principal = await authorized(deps, now);
      const result = await getNotificationSettings(deps.db, { userId: principal.userId }, principal.householdId);
      const active = result.settings.connectionId !== null && await usableNotificationConnection(deps.db, principal, result.settings.connectionId, now);
      await authorized(deps, now);
      return { schema_version: 1, request_id: crypto.randomUUID(), as_of: now.toISOString(),
        settings: settingsToWire(result.settings), revision: result.revision, updated_at: result.updatedAt,
        next_allowed_at: result.settings.enabled && !result.settings.muted && active ? nextNotificationTime(result.settings, now, now) : null };
    },
    async deliveryList(input: { cursor?: string; limit?: number } = {}) {
      const now = deps.now?.() ?? new Date();
      const principal = await authorized(deps, now);
      const limit = input.limit ?? 20;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new ReadError("invalid_input");
      const scope = cursorScope(principal, { method: "delivery_list", limit });
      const after = await cursor.decode(input.cursor, scope, now);
      const result = await listDeliveries(deps.db, { userId: principal.userId }, { before: after ? Number(after) : undefined, limit }, now);
      await authorized(deps, now);
      return { schema_version: 1, request_id: crypto.randomUUID(), as_of: now.toISOString(), items: result.items.map(deliveryToWire),
        next_cursor: result.nextBefore ? await cursor.encode(scope, String(result.nextBefore), now) : null };
    },
  };
}
