import { getCurrentUser } from "../auth/current-user";
import { type D1Session } from "./authorization";
import { getD1Database } from "./client";
import { D1UnauthorizedError } from "./errors";

type AuthenticatedUser = { id: string };

export async function getD1Context(
  authenticatedUser?: AuthenticatedUser,
): Promise<{ db: D1Database; session: NonNullable<D1Session> }> {
  const user = authenticatedUser ?? await getCurrentUser();
  if (user === null) throw new D1UnauthorizedError("認証が必要です。");
  const db = await getD1Database();
  const session = { userId: user.id };
  return { db, session };
}
