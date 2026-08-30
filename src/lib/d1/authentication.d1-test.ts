import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "../auth/password";
import {
  authenticateCredentials,
  bootstrapFirstUser,
  changePassword,
  getUserForSession,
  resetPassword,
} from "./authentication";
import { applyAllMigrations } from "./test-support/migrations";
import { D1ConflictError, D1UnauthorizedError } from "./errors";
import {
  acceptInvitationForExistingUser,
  getInvitationClaimState,
  issueHouseholdInvitation,
  openInvitationClaim,
  registerInvitedUser,
} from "./invitations";

const db = env.DB;

async function seedOwner(): Promise<void> {
  await db.batch([
    db.prepare(
      "INSERT INTO users (id, email, password_hash) VALUES ('owner', 'owner@example.test', 'owner-hash')",
    ),
    db.prepare("INSERT INTO households (id, name) VALUES ('household-a', 'Household A')"),
    db.prepare(
      "INSERT INTO household_members (household_id, user_id) VALUES ('household-a', 'owner')",
    ),
  ]);
}

beforeAll(async () => {
  await applyAllMigrations(db);
});

beforeEach(async () => {
  await db.batch([
    db.prepare("DELETE FROM invitation_claims"),
    db.prepare("DELETE FROM household_invitations"),
    db.prepare("DELETE FROM household_members"),
    db.prepare("DELETE FROM profiles"),
    db.prepare("DELETE FROM households"),
    db.prepare("DELETE FROM users"),
  ]);
});

describe("D1 Credentials authentication", () => {
  it("利用者が0人のときだけ最初の利用者をbootstrapする", async () => {
    const passwordHash = await hashPassword("bootstrap-password");

    const user = await bootstrapFirstUser(
      db,
      " First@Example.Test ",
      passwordHash,
      "bootstrap-user",
    );

    expect(user).toEqual({ email: "first@example.test", id: "bootstrap-user", sessionVersion: 0 });
    await expect(bootstrapFirstUser(
      db,
      "second@example.test",
      await hashPassword("second-password"),
      "second-user",
    )).rejects.toBeInstanceOf(D1ConflictError);
    await expect(db.prepare("SELECT count(*) AS count FROM users").first())
      .resolves.toMatchObject({ count: 1 });
  });

  it("正規化メールと正しいパスワードだけを認証する", async () => {
    const passwordHash = await hashPassword("login-password");
    await db.prepare(
      "INSERT INTO users (id, email, password_hash) VALUES ('user-1', 'person@example.test', ?1)",
    ).bind(passwordHash).run();

    await expect(authenticateCredentials(db, " Person@Example.Test ", "login-password"))
      .resolves.toEqual({ email: "person@example.test", id: "user-1", sessionVersion: 0 });
    await expect(authenticateCredentials(db, "person@example.test", "wrong-password"))
      .resolves.toBeNull();
    await db.prepare("UPDATE users SET password_hash = NULL WHERE id = 'user-1'").run();
    await expect(authenticateCredentials(db, "person@example.test", "login-password"))
      .resolves.toBeNull();
  });

  it("D1のsession_versionと一致するJWTだけを現在利用者として扱う", async () => {
    await db.prepare(
      "INSERT INTO users (id, email, password_hash, session_version) VALUES ('user-1', 'person@example.test', 'hash', 3)",
    ).run();

    await expect(getUserForSession(db, { sessionVersion: 3, userId: "user-1" }))
      .resolves.toEqual({ email: "person@example.test", id: "user-1", sessionVersion: 3 });
    await expect(getUserForSession(db, { sessionVersion: 2, userId: "user-1" }))
      .resolves.toBeNull();
  });

  it("管理resetはhashを置き換えてsession_versionを増やす", async () => {
    const oldHash = await hashPassword("old-password-value");
    const newHash = await hashPassword("new-password-value");
    await db.prepare(
      "INSERT INTO users (id, email, password_hash, session_version) VALUES ('user-1', 'person@example.test', ?1, 4)",
    ).bind(oldHash).run();

    await resetPassword(db, " Person@Example.Test ", newHash);

    const row = await db.prepare(
      "SELECT password_hash, session_version FROM users WHERE id = 'user-1'",
    ).first<{ password_hash: string; session_version: number }>();
    expect(row?.session_version).toBe(5);
    await expect(verifyPassword("new-password-value", row?.password_hash ?? "")).resolves.toBe(true);
  });

  it("現在パスワードが違う変更は何も変えず、正しい変更は全sessionを失効する", async () => {
    const oldHash = await hashPassword("old-password-value");
    await db.prepare(
      "INSERT INTO users (id, email, password_hash, session_version) VALUES ('user-1', 'person@example.test', ?1, 1)",
    ).bind(oldHash).run();

    await expect(changePassword(
      db,
      { sessionVersion: 1, userId: "user-1" },
      "wrong-password-value",
      "new-password-value",
    )).rejects.toBeInstanceOf(D1UnauthorizedError);
    await expect(db.prepare("SELECT session_version FROM users WHERE id = 'user-1'").first())
      .resolves.toMatchObject({ session_version: 1 });

    await changePassword(
      db,
      { sessionVersion: 1, userId: "user-1" },
      "old-password-value",
      "new-password-value",
    );
    await expect(db.prepare("SELECT session_version FROM users WHERE id = 'user-1'").first())
      .resolves.toMatchObject({ session_version: 2 });
    await expect(authenticateCredentials(db, "person@example.test", "new-password-value"))
      .resolves.toMatchObject({ id: "user-1", sessionVersion: 2 });
  });
});

describe("D1 invitation claims and atomic acceptance", () => {
  it("raw tokenを保存せず、30分以下のclaim secretへ交換する", async () => {
    await seedOwner();
    const issued = await issueHouseholdInvitation(
      db,
      { userId: "owner" },
      "new@example.test",
      new Date("2026-08-21T00:00:00.000Z"),
    );

    const claim = await openInvitationClaim(
      db,
      issued.token,
      new Date("2026-08-21T00:01:00.000Z"),
    );

    expect(claim).not.toBeNull();
    expect(new Date(claim?.expiresAt ?? 0).getTime()).toBeLessThanOrEqual(
      new Date("2026-08-21T00:31:00.000Z").getTime(),
    );
    const stored = await db.prepare(
      "SELECT claim_secret_hash FROM invitation_claims LIMIT 1",
    ).first<{ claim_secret_hash: string }>();
    expect(stored?.claim_secret_hash).not.toBe(claim?.claimSecret);
    expect(JSON.stringify(stored)).not.toContain(issued.token);
  });

  it("有効な招待だけが新規user・profile・membership・招待消費を原子的に作る", async () => {
    await seedOwner();
    const issued = await issueHouseholdInvitation(db, { userId: "owner" }, "new@example.test");
    const claim = await openInvitationClaim(db, issued.token);
    if (claim === null) throw new Error("Expected a valid claim");
    await expect(getInvitationClaimState(db, claim.claimSecret)).resolves.toEqual({
      email: "new@example.test",
      kind: "new",
    });
    const passwordHash = await hashPassword("invited-password");

    const user = await registerInvitedUser(db, {
      claimSecret: claim.claimSecret,
      email: " New@Example.Test ",
      nickname: "New member",
      passwordHash,
      userId: "new-user",
    });

    expect(user).toEqual({ email: "new@example.test", id: "new-user", sessionVersion: 0 });
    await expect(db.prepare(
      "SELECT household_id FROM household_members WHERE user_id = 'new-user'",
    ).first()).resolves.toMatchObject({ household_id: "household-a" });
    await expect(db.prepare(
      "SELECT status, accepted_by_user_id FROM household_invitations WHERE id = ?1",
    ).bind(issued.invitationId).first()).resolves.toMatchObject({
      accepted_by_user_id: "new-user",
      status: "accepted",
    });
  });

  it("登録途中の制約違反はuserを含むすべてをrollbackする", async () => {
    await seedOwner();
    const issued = await issueHouseholdInvitation(db, { userId: "owner" }, "new@example.test");
    const claim = await openInvitationClaim(db, issued.token);
    if (claim === null) throw new Error("Expected a valid claim");

    await expect(registerInvitedUser(db, {
      claimSecret: claim.claimSecret,
      email: "new@example.test",
      nickname: "",
      passwordHash: await hashPassword("invited-password"),
      userId: "new-user",
    })).rejects.toThrow();

    await expect(db.prepare("SELECT id FROM users WHERE id = 'new-user'").first())
      .resolves.toBeNull();
    await expect(db.prepare(
      "SELECT status FROM household_invitations WHERE id = ?1",
    ).bind(issued.invitationId).first()).resolves.toMatchObject({ status: "pending" });
  });

  it("claim表示後に同じemailの利用者が作られても招待を部分受諾しない", async () => {
    await seedOwner();
    const issued = await issueHouseholdInvitation(db, { userId: "owner" }, "new@example.test");
    const claim = await openInvitationClaim(db, issued.token);
    if (claim === null) throw new Error("Expected a valid claim");
    await db.prepare(
      "INSERT INTO users (id, email, password_hash) VALUES ('racing-user', 'new@example.test', 'hash')",
    ).run();

    await expect(registerInvitedUser(db, {
      claimSecret: claim.claimSecret,
      email: "new@example.test",
      nickname: "New member",
      passwordHash: await hashPassword("invited-password"),
      userId: "new-user",
    })).rejects.toBeInstanceOf(D1ConflictError);

    await expect(db.prepare("SELECT user_id FROM profiles WHERE user_id = 'new-user'").first())
      .resolves.toBeNull();
    await expect(db.prepare("SELECT household_id FROM household_members WHERE user_id = 'racing-user'").first())
      .resolves.toBeNull();
    await expect(db.prepare(
      "SELECT status FROM household_invitations WHERE id = ?1",
    ).bind(issued.invitationId).first()).resolves.toMatchObject({ status: "pending" });
  });

  it("既存利用者は新規登録せずmembershipと招待消費を原子的に行う", async () => {
    await seedOwner();
    await db.prepare(
      "INSERT INTO users (id, email, password_hash) VALUES ('existing', 'existing@example.test', 'hash')",
    ).run();
    const issued = await issueHouseholdInvitation(db, { userId: "owner" }, "existing@example.test");
    const claim = await openInvitationClaim(db, issued.token);
    if (claim === null) throw new Error("Expected a valid claim");
    await expect(getInvitationClaimState(db, claim.claimSecret)).resolves.toEqual({
      email: "existing@example.test",
      kind: "existing",
    });

    await expect(acceptInvitationForExistingUser(
      db,
      { userId: "existing" },
      claim.claimSecret,
    )).resolves.toBe(true);

    await expect(db.prepare("SELECT count(*) AS count FROM users").first())
      .resolves.toMatchObject({ count: 2 });
    await expect(db.prepare(
      "SELECT household_id FROM household_members WHERE user_id = 'existing'",
    ).first()).resolves.toMatchObject({ household_id: "household-a" });
  });

  it("同じ家庭は冪等成功し、別家庭・期限切れ・取消済み・再発行済みは変更しない", async () => {
    await seedOwner();
    await db.prepare(
      "INSERT INTO users (id, email, password_hash) VALUES ('same', 'same@example.test', 'hash'), ('other', 'other@example.test', 'hash')",
    ).run();
    await db.prepare(
      "INSERT INTO household_members (household_id, user_id) VALUES ('household-a', 'same')",
    ).run();
    await db.prepare("INSERT INTO households (id, name) VALUES ('household-b', 'Household B')").run();
    await db.prepare(
      "INSERT INTO household_members (household_id, user_id) VALUES ('household-b', 'other')",
    ).run();

    const sameInvite = await issueHouseholdInvitation(db, { userId: "owner" }, "same@example.test");
    const sameClaim = await openInvitationClaim(db, sameInvite.token);
    if (sameClaim === null) throw new Error("Expected a valid claim");
    await expect(acceptInvitationForExistingUser(db, { userId: "same" }, sameClaim.claimSecret))
      .resolves.toBe(true);

    const otherInvite = await issueHouseholdInvitation(db, { userId: "owner" }, "other@example.test");
    const otherClaim = await openInvitationClaim(db, otherInvite.token);
    if (otherClaim === null) throw new Error("Expected a valid claim");
    await expect(acceptInvitationForExistingUser(db, { userId: "other" }, otherClaim.claimSecret))
      .resolves.toBe(false);
    await expect(db.prepare(
      "SELECT status FROM household_invitations WHERE id = ?1",
    ).bind(otherInvite.invitationId).first()).resolves.toMatchObject({ status: "pending" });

    const replaced = await issueHouseholdInvitation(db, { userId: "owner" }, "replace@example.test");
    const replacedClaim = await openInvitationClaim(db, replaced.token);
    if (replacedClaim === null) throw new Error("Expected a valid claim");
    await issueHouseholdInvitation(db, { userId: "owner" }, "replace@example.test");
    await expect(getInvitationClaimState(db, replacedClaim.claimSecret)).resolves.toBeNull();
  });

  it("同じ招待の二重受諾は最初だけ成功する", async () => {
    await seedOwner();
    await db.prepare(
      "INSERT INTO users (id, email, password_hash) VALUES ('existing', 'existing@example.test', 'hash')",
    ).run();
    const issued = await issueHouseholdInvitation(db, { userId: "owner" }, "existing@example.test");
    const firstClaim = await openInvitationClaim(db, issued.token);
    const secondClaim = await openInvitationClaim(db, issued.token);
    if (firstClaim === null || secondClaim === null) throw new Error("Expected valid claims");

    await expect(acceptInvitationForExistingUser(
      db,
      { userId: "existing" },
      firstClaim.claimSecret,
    )).resolves.toBe(true);
    await expect(acceptInvitationForExistingUser(
      db,
      { userId: "existing" },
      secondClaim.claimSecret,
    )).resolves.toBe(false);
  });
});
