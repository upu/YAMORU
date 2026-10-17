import { resetHouseholdFixtures, householdAMember, createHouseholdAMaintenanceTask } from "./households";
import { registerTestClient, TEST_CLIENT_ID } from "./oauth";
import type { IntegrationPrincipal } from "../../../features/integration/principal";
import { createAttentionReader } from "../../../features/integration/attention/service";
export const notificationNow = new Date("2026-10-17T00:00:00Z");
export const notificationPrincipal: IntegrationPrincipal = { userId: householdAMember.userId, householdId: "household-a", clientId: TEST_CLIENT_ID, connectionId: "connection-a", scopes: ["household.read", "notifications.manage", "events.subscribe"] };
export async function resetNotificationFixtures(db: D1Database) {
  await resetHouseholdFixtures(db);
  await registerTestClient(db);
  await db.prepare(`INSERT INTO oauth_connections(id,household_id,user_id,client_id,client_name,scopes,resource,issuer,user_session_version,created_at,expires_at)
    VALUES('connection-a','household-a','user-a',?,'Assistant','household.read notifications.manage events.subscribe','https://yamoru.example.test/mcp','https://yamoru.example.test',0,'2026-10-01T00:00:00.000Z','2027-01-01T00:00:00.000Z')`).bind(TEST_CLIENT_ID).run();
}
export async function notificationCandidate(db: D1Database) {
  const task = await createHouseholdAMaintenanceTask(db);
  const reader = createAttentionReader({ db, authorize: () => Promise.resolve(notificationPrincipal), now: () => notificationNow, cursorSecret: "notification-test-secret-with-32-bytes" });
  const response = await reader.attentionGet({});
  const candidate = response.candidates.find((entry) => entry.kind === "todo_occurrence" && entry.entity_id === task.occurrenceId);
  if (!candidate) throw new Error("Expected the created task's notification candidate");
  return { ...task, candidate };
}
