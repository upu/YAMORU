import { D1ForbiddenError, D1UnauthorizedError } from "./errors";

export type D1Session = { email: string | null; userId: string } | null;

export function requireD1Session(session: D1Session): NonNullable<D1Session> {
  if (session === null) throw new D1UnauthorizedError("認証が必要です。");
  return session;
}

export async function ensureD1User(db: D1Database, session: NonNullable<D1Session>): Promise<void> {
  const email = session.email?.trim().toLowerCase();
  if (email === undefined || email.length === 0) throw new D1UnauthorizedError("メールアドレスが必要です。");
  await db.prepare("INSERT INTO users (id, email) VALUES (?1, ?2) ON CONFLICT(id) DO UPDATE SET email = excluded.email")
    .bind(session.userId, email).run();
}

export async function requireHouseholdMembership(db: D1Database, session: D1Session, householdId: string): Promise<void> {
  const user = requireD1Session(session);
  const member = await db.prepare("SELECT 1 FROM household_members WHERE household_id = ?1 AND user_id = ?2")
    .bind(householdId, user.userId).first();
  if (member === null) throw new D1ForbiddenError("この家庭のデータへアクセスできません。");
}

export async function getCurrentHouseholdId(db: D1Database, session: D1Session): Promise<string | null> {
  const user = requireD1Session(session);
  const row = await db.prepare("SELECT household_id FROM household_members WHERE user_id = ?1 LIMIT 1")
    .bind(user.userId).first<{ household_id: string }>();
  return row?.household_id ?? null;
}

export async function requireCurrentHouseholdId(
  db: D1Database,
  session: D1Session,
): Promise<string> {
  const householdId = await getCurrentHouseholdId(db, session);
  if (householdId === null) {
    throw new D1ForbiddenError("家庭への所属が必要です。");
  }
  await requireHouseholdMembership(db, session, householdId);
  return householdId;
}

export type AuthorizedManagedItem = { household_id: string; id: string; name: string };

export async function listAuthorizedManagedItems(db: D1Database, session: D1Session, householdId: string): Promise<AuthorizedManagedItem[]> {
  await requireHouseholdMembership(db, session, householdId);
  const { results } = await db.prepare("SELECT id, household_id, name FROM managed_items WHERE household_id = ?1 ORDER BY id")
    .bind(householdId).all<AuthorizedManagedItem>();
  return results;
}

export async function updateAuthorizedManagedItemName(db: D1Database, session: D1Session, householdId: string, id: string, name: string): Promise<number> {
  await requireHouseholdMembership(db, session, householdId);
  const result = await db.prepare("UPDATE managed_items SET name = ?1 WHERE id = ?2 AND household_id = ?3")
    .bind(name, id, householdId).run();
  return result.meta.changes;
}
