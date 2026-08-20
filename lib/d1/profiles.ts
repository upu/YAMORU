import {
  requireCurrentHouseholdId,
  requireD1Session,
  type D1Session,
} from "./authorization";

export const FALLBACK_SELF_ACTOR_NAME = "あなた";
export const FALLBACK_OTHER_MEMBER_NAME = "メンバー";

export type HouseholdMemberOption = { nickname: string; userId: string };

export async function loadActorName(
  db: D1Database,
  session: D1Session,
  userId: string,
  fallback: string,
): Promise<string> {
  requireD1Session(session);
  const householdId = await requireCurrentHouseholdId(db, session);
  const row = await db.prepare(
    `SELECT p.nickname
       FROM household_members m
       JOIN profiles p ON p.user_id = m.user_id
      WHERE m.household_id = ?1 AND m.user_id = ?2`,
  ).bind(householdId, userId).first<{ nickname: string }>();
  return row?.nickname ?? fallback;
}

export async function loadHouseholdMembers(
  db: D1Database,
  session: D1Session,
): Promise<HouseholdMemberOption[]> {
  const householdId = await requireCurrentHouseholdId(db, session);
  const { results } = await db.prepare(
    `SELECT m.user_id, p.nickname
       FROM household_members m
       LEFT JOIN profiles p ON p.user_id = m.user_id
      WHERE m.household_id = ?1
      ORDER BY m.created_at, m.user_id`,
  ).bind(householdId).all<{ nickname: string | null; user_id: string }>();
  return results.map((row) => ({
    nickname: row.nickname ?? FALLBACK_OTHER_MEMBER_NAME,
    userId: row.user_id,
  }));
}

export async function loadProfileNames(
  db: D1Database,
  session: D1Session,
  userIds: string[],
): Promise<Map<string, string>> {
  const householdId = await requireCurrentHouseholdId(db, session);
  if (userIds.length === 0) return new Map();
  const placeholders = userIds.map((_, index) => `?${String(index + 2)}`).join(", ");
  const { results } = await db.prepare(
    `SELECT m.user_id, p.nickname
       FROM household_members m
       JOIN profiles p ON p.user_id = m.user_id
      WHERE m.household_id = ?1 AND m.user_id IN (${placeholders})`,
  ).bind(householdId, ...userIds).all<{ nickname: string; user_id: string }>();
  return new Map(results.map((row) => [row.user_id, row.nickname]));
}
