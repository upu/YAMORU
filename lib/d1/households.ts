import { getCurrentHouseholdId, requireD1Session, type D1Session } from "./authorization";
import { D1ConflictError } from "./errors";

export type HouseholdSummary = { id: string; name: string };
export type AccountState = { household: HouseholdSummary | null; nickname: string | null };

export async function loadAccountState(db: D1Database, session: D1Session): Promise<AccountState> {
  const user = requireD1Session(session);
  const [household, profile] = await Promise.all([
    db.prepare("SELECT h.id, h.name FROM households h JOIN household_members m ON m.household_id = h.id WHERE m.user_id = ?1 LIMIT 1").bind(user.userId).first<HouseholdSummary>(),
    db.prepare("SELECT nickname FROM profiles WHERE user_id = ?1").bind(user.userId).first<{ nickname: string }>(),
  ]);
  return { household, nickname: profile?.nickname ?? null };
}

export async function createProfile(db: D1Database, session: D1Session, nickname: string): Promise<void> {
  const user = requireD1Session(session);
  await db.prepare("INSERT INTO profiles (user_id, nickname) VALUES (?1, ?2) ON CONFLICT(user_id) DO NOTHING")
    .bind(user.userId, nickname).run();
}

export async function updateProfile(db: D1Database, session: D1Session, nickname: string): Promise<void> {
  const user = requireD1Session(session);
  const result = await db.prepare("UPDATE profiles SET nickname = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE user_id = ?2")
    .bind(nickname, user.userId).run();
  if (result.meta.changes === 0) throw new D1ConflictError("プロフィールが見つかりません。");
}

export async function createFirstHousehold(db: D1Database, session: D1Session, name: string): Promise<void> {
  const user = requireD1Session(session);
  if (await getCurrentHouseholdId(db, session) !== null) throw new D1ConflictError("既に家庭へ所属しています。");
  const householdId = crypto.randomUUID();
  await db.batch([
    db.prepare("INSERT INTO households (id, name) VALUES (?1, ?2)").bind(householdId, name),
    db.prepare("INSERT INTO household_members (household_id, user_id) VALUES (?1, ?2)").bind(householdId, user.userId),
  ]);
}
