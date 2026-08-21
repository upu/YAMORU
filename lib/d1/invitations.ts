import {
  requireCurrentHouseholdId,
  requireD1Session,
  type D1Session,
} from "./authorization";
import { D1ConflictError } from "./errors";

const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const INVITATION_CLAIM_LIFETIME_MS = 30 * 60 * 1000;

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

export type InvitationClaim = { claimSecret: string; expiresAt: string };
export type InvitationClaimState = { email: string; kind: "existing" | "new" };
type InvitedUserInput = {
  claimSecret: string;
  email: string;
  nickname: string;
  passwordHash: string;
  userId?: string;
};

export async function openInvitationClaim(
  db: D1Database,
  token: string,
  now = new Date(),
): Promise<InvitationClaim | null> {
  const tokenHash = await hashToken(token);
  const invitation = await db.prepare(
    `SELECT id, expires_at
       FROM household_invitations
      WHERE token_hash = ?1 AND status = 'pending' AND expires_at > ?2
      LIMIT 1`,
  ).bind(tokenHash, now.toISOString()).first<{ expires_at: string; id: string }>();
  if (invitation === null) return null;
  const claimSecret = createToken();
  const claimSecretHash = await hashToken(claimSecret);
  const expiresAt = new Date(Math.min(
    now.getTime() + INVITATION_CLAIM_LIFETIME_MS,
    new Date(invitation.expires_at).getTime(),
  )).toISOString();
  const result = await db.prepare(
    `INSERT INTO invitation_claims (
       id, invitation_id, claim_secret_hash, created_at, expires_at
     )
     SELECT ?1, id, ?2, ?3, ?4
       FROM household_invitations
      WHERE id = ?5 AND token_hash = ?6 AND status = 'pending' AND expires_at > ?3`,
  ).bind(
    crypto.randomUUID(), claimSecretHash, now.toISOString(), expiresAt,
    invitation.id, tokenHash,
  ).run();
  if (result.meta.changes !== 1) return null;
  return { claimSecret, expiresAt };
}

export async function getInvitationClaimState(
  db: D1Database,
  claimSecret: string,
  now = new Date(),
): Promise<InvitationClaimState | null> {
  const claimSecretHash = await hashToken(claimSecret);
  const row = await db.prepare(
    `SELECT i.invited_email AS email,
            CASE WHEN u.id IS NULL THEN 'new' ELSE 'existing' END AS kind
       FROM invitation_claims c
       JOIN household_invitations i ON i.id = c.invitation_id
       LEFT JOIN users u ON u.email = i.invited_email
      WHERE c.claim_secret_hash = ?1
        AND c.expires_at > ?2
        AND i.status = 'pending'
        AND i.expires_at > ?2
      LIMIT 1`,
  ).bind(claimSecretHash, now.toISOString()).first<InvitationClaimState>();
  return row;
}

function invitedUserStatements(
  db: D1Database,
  input: InvitedUserInput,
  values: { claimSecretHash: string; email: string; timestamp: string; userId: string },
): D1PreparedStatement[] {
  const { claimSecretHash, email, timestamp, userId } = values;
  return [
    db.prepare(
      `INSERT OR IGNORE INTO users (id, email, password_hash, created_at)
       SELECT ?1, i.invited_email, ?2, ?3
         FROM invitation_claims c
         JOIN household_invitations i ON i.id = c.invitation_id
        WHERE c.claim_secret_hash = ?4
          AND c.expires_at > ?3
          AND i.status = 'pending'
          AND i.expires_at > ?3
          AND i.invited_email = ?5`,
    ).bind(userId, input.passwordHash, timestamp, claimSecretHash, email),
    db.prepare(
      `INSERT INTO profiles (user_id, nickname, created_at, updated_at)
       SELECT id, ?2, ?3, ?3 FROM users WHERE id = ?1 AND email = ?4`,
    ).bind(userId, input.nickname, timestamp, email),
    db.prepare(
      `INSERT INTO household_members (household_id, user_id, created_at)
       SELECT i.household_id, ?1, ?2
         FROM invitation_claims c
         JOIN household_invitations i ON i.id = c.invitation_id
         JOIN users u ON u.id = ?1 AND u.email = i.invited_email
        WHERE c.claim_secret_hash = ?3
          AND c.expires_at > ?2
          AND i.status = 'pending'
          AND i.expires_at > ?2
          AND i.invited_email = ?4`,
    ).bind(userId, timestamp, claimSecretHash, email),
    db.prepare(
      `UPDATE household_invitations
          SET status = 'accepted', accepted_at = ?1, accepted_by_user_id = ?2
        WHERE id = (
          SELECT c.invitation_id FROM invitation_claims c
           WHERE c.claim_secret_hash = ?3 AND c.expires_at > ?1
        )
          AND status = 'pending' AND expires_at > ?1 AND invited_email = ?4
          AND EXISTS (
            SELECT 1 FROM household_members m
             WHERE m.household_id = household_invitations.household_id
               AND m.user_id = ?2
          )`,
    ).bind(timestamp, userId, claimSecretHash, email),
    db.prepare("DELETE FROM invitation_claims WHERE claim_secret_hash = ?1")
      .bind(claimSecretHash),
  ];
}

export async function registerInvitedUser(
  db: D1Database,
  input: InvitedUserInput,
  now = new Date(),
): Promise<{ email: string; id: string; sessionVersion: number }> {
  const claimSecretHash = await hashToken(input.claimSecret);
  const email = input.email.trim().toLowerCase();
  const userId = input.userId ?? crypto.randomUUID();
  const timestamp = now.toISOString();
  const results = await db.batch(invitedUserStatements(db, input, {
    claimSecretHash,
    email,
    timestamp,
    userId,
  }));
  if (
    results[0].meta.changes !== 1 ||
    results[1].meta.changes !== 1 ||
    results[2].meta.changes !== 1 ||
    results[3].meta.changes !== 1
  ) {
    throw new D1ConflictError("Invitation is invalid");
  }
  return { email, id: userId, sessionVersion: 0 };
}

export async function acceptInvitationForExistingUser(
  db: D1Database,
  session: D1Session,
  claimSecret: string,
  now = new Date(),
): Promise<boolean> {
  const user = requireD1Session(session);
  const claimSecretHash = await hashToken(claimSecret);
  const timestamp = now.toISOString();
  const results = await db.batch([
    db.prepare(
      `INSERT INTO household_members (household_id, user_id, created_at)
       SELECT i.household_id, u.id, ?1
         FROM invitation_claims c
         JOIN household_invitations i ON i.id = c.invitation_id
         JOIN users u ON u.id = ?2 AND u.email = i.invited_email
        WHERE c.claim_secret_hash = ?3
          AND c.expires_at > ?1
          AND i.status = 'pending'
          AND i.expires_at > ?1
          AND NOT EXISTS (SELECT 1 FROM household_members WHERE user_id = u.id)`,
    ).bind(timestamp, user.userId, claimSecretHash),
    db.prepare(
      `UPDATE household_invitations
          SET status = 'accepted', accepted_at = ?1, accepted_by_user_id = ?2
        WHERE id = (
          SELECT c.invitation_id
            FROM invitation_claims c
           WHERE c.claim_secret_hash = ?3 AND c.expires_at > ?1
        )
          AND status = 'pending'
          AND expires_at > ?1
          AND invited_email = (SELECT email FROM users WHERE id = ?2)
          AND EXISTS (
            SELECT 1 FROM household_members m
             WHERE m.household_id = household_invitations.household_id
               AND m.user_id = ?2
          )`,
    ).bind(timestamp, user.userId, claimSecretHash),
    db.prepare(
      `DELETE FROM invitation_claims
        WHERE claim_secret_hash = ?1
          AND EXISTS (
            SELECT 1 FROM household_invitations i
             WHERE i.id = invitation_claims.invitation_id
               AND i.status = 'accepted'
               AND i.accepted_by_user_id = ?2
          )`,
    ).bind(claimSecretHash, user.userId),
  ]);
  return results[1].meta.changes === 1;
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
          SET status = 'replaced', replaced_at = ?1,
              replaced_by_invitation_id = ?2
        WHERE household_id = ?3 AND invited_email = ?4 AND status = 'pending'`,
    ).bind(replacedAt, invitationId, householdId, normalizedEmail),
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
