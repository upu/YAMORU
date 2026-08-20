// Issue #116スパイク: Auth.js Credentialsプロバイダーのauthorize()から呼ぶ、
// D1のusersテーブルへの最小限のアクセス関数。

export type SpikeUser = {
  id: string;
  email: string;
};

type UserRow = {
  id: string;
  email: string;
  password_hash: string;
};

export async function findSpikeUserByEmailAndPassword(
  db: D1Database,
  email: string,
  password: string,
): Promise<SpikeUser | null> {
  const { verifyPassword } = await import("./password");
  const row = await db
    .prepare("SELECT id, email, password_hash FROM users WHERE email = ?1")
    .bind(email)
    .first<UserRow>();
  if (row === null) {
    return null;
  }
  const isValid = await verifyPassword(password, row.password_hash);
  if (!isValid) {
    return null;
  }
  return { id: row.id, email: row.email };
}
