import {
  requireCurrentHouseholdId,
  requireD1Session,
  type D1Session,
} from "./authorization";
import { D1ConflictError } from "./errors";

const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export type IssuedInvitation = {
  expiresAt: string;
  invitedEmail: string;
  invitationId: string;
  token: string;
};

export type InvitationListRow = {
  created_at: string;
  expires_at: string;
  id: string;
  invited_email: string;
  status: string;
};

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function createToken(): string {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
}

export async function issueHouseholdInvitation(
  db: D1Database,
  session: D1Session,
  email: string,
  now = new Date(),
): Promise<IssuedInvitation> {
  const user = requireD1Session(session);
  const householdId = await requireCurrentHouseholdId(db, session);
  const normalizedEmail = email.trim().toLowerCase();
  const invitationId = crypto.randomUUID();
  const token = createToken();
  const tokenHash = await hashToken(token);
  const expiresAt = new Date(now.getTime() + INVITATION_LIFETIME_MS).toISOString();
  const replacedAt = now.toISOString();
  await db.batch([
    db.prepare(
      `UPDATE household_invitations
          SET status = 'replaced', replaced_at = ?1
        WHERE household_id = ?2 AND invited_email = ?3 AND status = 'pending'`,
    ).bind(replacedAt, householdId, normalizedEmail),
    db.prepare(
      `INSERT INTO household_invitations (
        id, household_id, invited_email, token_hash, created_by_user_id,
        created_at, expires_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    ).bind(
      invitationId,
      householdId,
      normalizedEmail,
      tokenHash,
      user.userId,
      replacedAt,
      expiresAt,
    ),
  ]);
  return { expiresAt, invitedEmail: normalizedEmail, invitationId, token };
}

export async function cancelHouseholdInvitation(
  db: D1Database,
  session: D1Session,
  invitationId: string,
): Promise<void> {
  const householdId = await requireCurrentHouseholdId(db, session);
  const result = await db.prepare(
    `UPDATE household_invitations
        SET status = 'cancelled', cancelled_at = ?1
      WHERE id = ?2 AND household_id = ?3 AND status = 'pending'`,
  ).bind(new Date().toISOString(), invitationId, householdId).run();
  if (result.meta.changes !== 1) throw new D1ConflictError("Invitation is not pending");
}

export async function listHouseholdInvitations(
  db: D1Database,
  session: D1Session,
  now = new Date(),
): Promise<InvitationListRow[]> {
  const householdId = await requireCurrentHouseholdId(db, session);
  const { results } = await db.prepare(
    `SELECT id, invited_email, created_at, expires_at,
            CASE
              WHEN status = 'pending' AND expires_at <= ?1 THEN 'expired'
              ELSE status
            END AS status
       FROM household_invitations
      WHERE household_id = ?2
      ORDER BY created_at DESC, id DESC`,
  ).bind(now.toISOString(), householdId).all<InvitationListRow>();
  return results;
}
