import { redirect } from "next/navigation";

import { auth } from "../../auth";
import { getUserForSession, type AuthenticatedD1User } from "../d1/authentication";
import { getD1Database } from "../d1/client";

export async function getCurrentUser(): Promise<AuthenticatedD1User | null> {
  const session = await auth();
  if (session === null) return null;
  const userId = session.user.id;
  const sessionVersion = session.user.sessionVersion;
  if (typeof userId !== "string" || typeof sessionVersion !== "number") return null;
  const db = await getD1Database();
  return getUserForSession(db, { sessionVersion, userId });
}

export async function requireUser(): Promise<AuthenticatedD1User> {
  const user = await getCurrentUser();
  if (user === null) redirect("/login");
  return user;
}
