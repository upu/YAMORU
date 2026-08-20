import { getCurrentUser } from "../auth/current-user";
import { ensureD1User, type D1Session } from "./authorization";
import { getD1Database } from "./client";
import { D1UnauthorizedError } from "./errors";

type AuthenticatedUser = { email?: string | null; id: string };

export async function getD1Context(
  authenticatedUser?: AuthenticatedUser,
): Promise<{ db: D1Database; session: NonNullable<D1Session> }> {
  const user = authenticatedUser ?? await getCurrentUser();
  if (user === null) throw new D1UnauthorizedError("認証が必要です。");
  const db = await getD1Database();
  const session = { email: user.email ?? null, userId: user.id };
  await ensureD1User(db, session);
  return { db, session };
}
