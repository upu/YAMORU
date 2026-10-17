import { requireCurrentHouseholdId, requireD1Session, requireHouseholdMembership, type D1Session } from "./authorization";
import { DEFAULT_SETTINGS, NotificationError, parseControl, parseSettings, type CandidateControl, type NotificationSettings } from "../../features/integration/notifications/contract";

export const NOTIFICATION_CONNECTION_ACTIVE = `c.revoked_at IS NULL AND c.expires_at > ?4
  AND EXISTS(SELECT 1 FROM household_members m WHERE m.household_id=c.household_id AND m.user_id=c.user_id)
  AND EXISTS(SELECT 1 FROM users u WHERE u.id=c.user_id AND u.session_version=c.user_session_version)
  AND instr(' '||c.scopes||' ',' household.read ')>0 AND instr(' '||c.scopes||' ',' events.subscribe ')>0`;

export async function notificationOwner(db: D1Database, session: D1Session) {
  const user = requireD1Session(session);
  return { userId: user.userId, householdId: await requireCurrentHouseholdId(db, session) };
}
export async function getNotificationSettings(db: D1Database, session: D1Session, fixedHouseholdId?: string) {
  const userId = requireD1Session(session).userId;
  const householdId = fixedHouseholdId ?? await requireCurrentHouseholdId(db, session);
  await requireHouseholdMembership(db, session, householdId);
  const row = await db.prepare("SELECT settings,revision,updated_at FROM notification_settings WHERE household_id=? AND user_id=?")
    .bind(householdId, userId).first<{ settings: string; revision: number; updated_at: string }>();
  return { settings: row ? parseSettings(JSON.parse(row.settings)) : { ...DEFAULT_SETTINGS }, revision: row?.revision ?? 0, updatedAt: row?.updated_at ?? null };
}
export async function usableNotificationConnection(db: D1Database, owner: { householdId: string; userId: string }, connectionId: string, now: Date): Promise<boolean> {
  const row = await db.prepare(`SELECT 1 FROM oauth_connections c WHERE c.id=?1 AND c.household_id=?2 AND c.user_id=?3 AND ${NOTIFICATION_CONNECTION_ACTIVE}`)
    .bind(connectionId, owner.householdId, owner.userId, now.toISOString()).first();
  return row !== null;
}
export async function saveNotificationSettings(db: D1Database, session: D1Session, input: unknown, revision: number, now: Date) {
  const settings = parseSettings(input);
  if (!Number.isSafeInteger(revision) || revision < 0) throw new NotificationError("invalid_input");
  const owner = await notificationOwner(db, session);
  const connection = settings.connectionId;
  if (settings.enabled && (!connection || !await usableNotificationConnection(db, owner, connection, now))) throw new NotificationError("connection_unavailable");
  const result = await notificationSettingsStatement(db, owner, settings, revision, now).run();
  if (result.meta.changes === 0) throw new NotificationError("stale_settings");
  return getNotificationSettings(db, session);
}
export function notificationSettingsStatement(db: D1Database, owner: { householdId: string; userId: string }, settings: NotificationSettings, revision: number, now: Date, businessKey: string | null = null) {
  return db.prepare(`INSERT INTO notification_settings(household_id,user_id,connection_id,settings,revision,updated_at,idempotency_key)
    SELECT ?2,?3,?1,?5,1,?4,?8 WHERE
      EXISTS(SELECT 1 FROM household_members WHERE household_id=?2 AND user_id=?3)
      AND COALESCE((SELECT revision FROM notification_settings WHERE household_id=?2 AND user_id=?3),0)=?6
      AND (?1 IS NULL OR EXISTS(SELECT 1 FROM oauth_connections c WHERE c.id=?1 AND c.household_id=?2 AND c.user_id=?3 AND (?7=0 OR (${NOTIFICATION_CONNECTION_ACTIVE}))))
    ON CONFLICT(household_id,user_id) DO UPDATE SET connection_id=excluded.connection_id,settings=excluded.settings,
      revision=notification_settings.revision+1,updated_at=excluded.updated_at,idempotency_key=excluded.idempotency_key`)
    .bind(settings.connectionId, owner.householdId, owner.userId, now.toISOString(), JSON.stringify(settings), revision, Number(settings.enabled), businessKey);
}
export async function setCandidateControl(db: D1Database, session: D1Session, candidateId: string, input: CandidateControl, now: Date) {
  const control = parseControl(input, now);
  const { householdId, userId } = await notificationOwner(db, session);
  const result = await candidateControlStatement(db, { householdId, userId }, candidateId, control, now).run();
  if (result.meta.changes === 0) throw new NotificationError("not_found");
}
export function candidateControlStatement(db: D1Database, owner: { householdId: string; userId: string }, candidateId: string, control: CandidateControl, now: Date, expectedRevision: number | null = null, businessKey: string | null = null) {
  return db.prepare(`INSERT INTO notification_controls(household_id,user_id,candidate_id,muted,snoozed_until,updated_at,idempotency_key)
    SELECT ?1,?2,?3,?4,?5,?6,?8 WHERE EXISTS(SELECT 1 FROM attention_candidates WHERE id=?3 AND household_id=?1)
      AND EXISTS(SELECT 1 FROM household_members WHERE household_id=?1 AND user_id=?2)
      AND (?7 IS NULL OR COALESCE((SELECT revision FROM notification_controls WHERE household_id=?1 AND user_id=?2 AND candidate_id=?3),0)=?7)
    ON CONFLICT(household_id,user_id,candidate_id) DO UPDATE SET muted=excluded.muted,snoozed_until=excluded.snoozed_until,updated_at=excluded.updated_at,
      revision=notification_controls.revision+1,idempotency_key=excluded.idempotency_key`)
    .bind(owner.householdId, owner.userId, candidateId, Number(control.muted), control.snoozedUntil, now.toISOString(), expectedRevision, businessKey);
}
export async function getCandidateControl(db: D1Database, owner: { householdId: string; userId: string }, candidateId: string): Promise<CandidateControl & { revision: number }> {
  const row = await db.prepare("SELECT muted,snoozed_until,revision FROM notification_controls WHERE household_id=? AND user_id=? AND candidate_id=?")
    .bind(owner.householdId, owner.userId, candidateId).first<{ muted: number; snoozed_until: string | null; revision: number }>();
  return { muted: row?.muted === 1, snoozedUntil: row?.snoozed_until ?? null, revision: row?.revision ?? 0 };
}
