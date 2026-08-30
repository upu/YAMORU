import { hashPassword, verifyPassword } from "../auth/password.ts";
import { D1ConflictError, D1UnauthorizedError } from "./errors.ts";

export type AuthenticatedD1User = {
  email: string;
  id: string;
  sessionVersion: number;
};

export type AuthSessionIdentity = {
  sessionVersion: number;
  userId: string;
};

type UserRow = {
  email: string;
  id: string;
  password_hash: string | null;
  session_version: number;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toAuthenticatedUser(row: UserRow): AuthenticatedD1User {
  return { email: row.email, id: row.id, sessionVersion: row.session_version };
}

export async function authenticateCredentials(
  db: D1Database,
  email: string,
  password: string,
): Promise<AuthenticatedD1User | null> {
  const row = await db.prepare(
    "SELECT id, email, password_hash, session_version FROM users WHERE email = ?1 LIMIT 1",
  ).bind(normalizeEmail(email)).first<UserRow>();
  if (row?.password_hash === null || row === null) return null;
  if (!await verifyPassword(password, row.password_hash)) return null;
  return toAuthenticatedUser(row);
}

export async function getUserForSession(
  db: D1Database,
  identity: AuthSessionIdentity,
): Promise<AuthenticatedD1User | null> {
  const row = await db.prepare(
    `SELECT id, email, password_hash, session_version
       FROM users
      WHERE id = ?1 AND session_version = ?2 AND password_hash IS NOT NULL
      LIMIT 1`,
  ).bind(identity.userId, identity.sessionVersion).first<UserRow>();
  return row === null ? null : toAuthenticatedUser(row);
}

export async function bootstrapFirstUser(
  db: D1Database,
  email: string,
  passwordHash: string,
  userId = crypto.randomUUID(),
): Promise<AuthenticatedD1User> {
  const normalizedEmail = normalizeEmail(email);
  const result = await db.prepare(
    `INSERT INTO users (id, email, password_hash)
     SELECT ?1, ?2, ?3
      WHERE NOT EXISTS (SELECT 1 FROM users)`,
  ).bind(userId, normalizedEmail, passwordHash).run();
  if (result.meta.changes !== 1) throw new D1ConflictError("A user already exists");
  return { email: normalizedEmail, id: userId, sessionVersion: 0 };
}

export async function resetPassword(
  db: D1Database,
  email: string,
  passwordHash: string,
): Promise<void> {
  const result = await db.prepare(
    `UPDATE users
        SET password_hash = ?1, session_version = session_version + 1
      WHERE email = ?2`,
  ).bind(passwordHash, normalizeEmail(email)).run();
  if (result.meta.changes !== 1) throw new D1ConflictError("User not found");
}

export async function changePassword(
  db: D1Database,
  identity: AuthSessionIdentity,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const row = await db.prepare(
    `SELECT id, email, password_hash, session_version
       FROM users
      WHERE id = ?1 AND session_version = ?2
      LIMIT 1`,
  ).bind(identity.userId, identity.sessionVersion).first<UserRow>();
  if (row?.password_hash === null || row === null) {
    throw new D1UnauthorizedError("Current password is invalid");
  }
  if (!await verifyPassword(currentPassword, row.password_hash)) {
    throw new D1UnauthorizedError("Current password is invalid");
  }
  const newPasswordHash = await hashPassword(newPassword);
  const result = await db.prepare(
    `UPDATE users
        SET password_hash = ?1, session_version = session_version + 1
      WHERE id = ?2 AND session_version = ?3 AND password_hash = ?4`,
  ).bind(newPasswordHash, identity.userId, identity.sessionVersion, row.password_hash).run();
  if (result.meta.changes !== 1) throw new D1ConflictError("Password changed concurrently");
}
