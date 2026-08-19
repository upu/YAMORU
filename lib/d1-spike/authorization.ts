// Issue #116スパイク: D1にはSupabaseのRLSに相当するDB層の強制がないため、
// household単位のアクセス制御をこのモジュール(アプリ層)だけで担保する。
// 既存のRLSスパイク(supabase/tests/database/household_rls_isolation.sql)と
// 同じ検証マトリクスを、ここではアプリ層関数+Vitestで再現する。

export type SpikeSession = { userId: string } | null;

export class UnauthorizedSpikeError extends Error {}
export class ForbiddenSpikeError extends Error {}

export type ManagedItemRow = {
  id: string;
  household_id: string;
  name: string;
};

export async function isHouseholdMember(
  db: D1Database,
  householdId: string,
  userId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      "SELECT 1 FROM household_members WHERE household_id = ?1 AND user_id = ?2",
    )
    .bind(householdId, userId)
    .first();
  return row !== null;
}

// RLSなら1回定義すれば全クエリに効くが、ここでは呼び出し側が
// このチェックを呼び忘れると素通りする。判明した制約として記録する。
async function requireHouseholdMembership(
  db: D1Database,
  session: SpikeSession,
  householdId: string,
): Promise<void> {
  if (session === null) {
    throw new UnauthorizedSpikeError("未認証です。");
  }
  const isMember = await isHouseholdMember(db, householdId, session.userId);
  if (!isMember) {
    throw new ForbiddenSpikeError("この家庭のデータへアクセスできません。");
  }
}

export async function listManagedItems(
  db: D1Database,
  session: SpikeSession,
  householdId: string,
): Promise<ManagedItemRow[]> {
  await requireHouseholdMembership(db, session, householdId);
  const { results } = await db
    .prepare(
      "SELECT id, household_id, name FROM managed_items WHERE household_id = ?1 ORDER BY id",
    )
    .bind(householdId)
    .all<ManagedItemRow>();
  return results;
}

export async function createManagedItem(
  db: D1Database,
  session: SpikeSession,
  householdId: string,
  input: { id: string; name: string },
): Promise<void> {
  await requireHouseholdMembership(db, session, householdId);
  await db
    .prepare(
      "INSERT INTO managed_items (id, household_id, name) VALUES (?1, ?2, ?3)",
    )
    .bind(input.id, householdId, input.name)
    .run();
}

export async function updateManagedItemName(
  db: D1Database,
  session: SpikeSession,
  householdId: string,
  id: string,
  name: string,
): Promise<number> {
  await requireHouseholdMembership(db, session, householdId);
  // RLSスパイクと同じ注意点: household_idの一致もWHEREで明示しないと、
  // 「他家庭のidを知っていれば書き換えられる」抜け道になる。
  const result = await db
    .prepare(
      "UPDATE managed_items SET name = ?1 WHERE id = ?2 AND household_id = ?3",
    )
    .bind(name, id, householdId)
    .run();
  return result.meta.changes;
}

export async function deleteManagedItem(
  db: D1Database,
  session: SpikeSession,
  householdId: string,
  id: string,
): Promise<number> {
  await requireHouseholdMembership(db, session, householdId);
  const result = await db
    .prepare("DELETE FROM managed_items WHERE id = ?1 AND household_id = ?2")
    .bind(id, householdId)
    .run();
  return result.meta.changes;
}
