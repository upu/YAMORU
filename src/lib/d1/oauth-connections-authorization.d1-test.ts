import { env } from "cloudflare:workers";
import * as oauth from "oauth4webapi";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { verifyAccessToken } from "../../features/integration/oauth/bearer";
import { handleRevocationRequest } from "../../features/integration/oauth/revocation-endpoint";
import { resetPassword } from "./authentication";
import { listConnectionsForUser } from "./oauth-connection-list";
import { isConnectionActive, revokeConnectionForUser } from "./oauth-connections";
import { householdAMember, householdBMember, nonMember, resetHouseholdFixtures } from "./test-support/households";
import { applyAllMigrations } from "./test-support/migrations";
import {
  connect,
  consent,
  discoverTestServer,
  exchangeCode,
  refresh,
  registerTestClient,
  testClient,
  testOAuthConfig,
  TEST_CLIENT_ID,
} from "./test-support/oauth";

// 外部接続(#436)の家庭境界・本人境界・解除後の停止を実D1で確かめる。
const db = env.DB;
const config = testOAuthConfig;
const memberA = { householdId: "household-a", userId: householdAMember.userId };
const familyMemberA = { userId: "user-a2" };

beforeAll(async () => {
  await applyAllMigrations(db);
});

beforeEach(async () => {
  await resetHouseholdFixtures(db);
  await db.batch([
    db.prepare("INSERT INTO users (id, email) VALUES ('user-a2', 'a2@example.com')"),
    db.prepare("INSERT INTO household_members (household_id, user_id) VALUES ('household-a', 'user-a2')"),
  ]);
  await registerTestClient(db);
});

function now(): string {
  return new Date().toISOString();
}

async function connectionState(): Promise<{ id: string; revoked_reason: string | null }> {
  const row = await db.prepare("SELECT id, revoked_reason FROM oauth_connections LIMIT 1")
    .first<{ id: string; revoked_reason: string | null }>();
  if (row === null) throw new Error("接続がありません");
  return row;
}

async function tokenCount(): Promise<number> {
  const row = await db.prepare("SELECT count(*) AS count FROM oauth_tokens").first<{ count: number }>();
  return row?.count ?? 0;
}

async function revokeRequest(body: Record<string, string>): Promise<Response> {
  return handleRevocationRequest(new Request(`${config.issuer}/oauth/revoke`, {
    body: new URLSearchParams(body),
    method: "POST",
  }), { config, db });
}

describe("家庭と所属", () => {
  it("他家庭のIDで同意してもcodeを発行しない", async () => {
    const { redirectUrl } = await consent(db, { householdId: "household-b", userId: householdAMember.userId });
    expect(redirectUrl.searchParams.get("error")).toBe("access_denied");
    expect(redirectUrl.searchParams.has("code")).toBe(false);
    const codes = await db.prepare("SELECT count(*) AS count FROM oauth_authorization_codes").first<{ count: number }>();
    expect(codes?.count).toBe(0);
  });

  it("未所属の利用者にはcodeを発行しない", async () => {
    const { redirectUrl } = await consent(db, { householdId: "household-a", userId: nonMember.userId });
    expect(redirectUrl.searchParams.get("error")).toBe("access_denied");
  });

  it("接続時の家庭から離れたら接続を失効させ、別の家庭へ転用しない", async () => {
    const tokens = await connect(db, memberA);
    await db.batch([
      db.prepare("DELETE FROM household_members WHERE user_id = ?1").bind(householdAMember.userId),
      db.prepare("INSERT INTO household_members (household_id, user_id) VALUES ('household-b', ?1)").bind(householdAMember.userId),
    ]);
    expect(await verifyAccessToken({ config, db }, tokens.access_token, [])).toEqual({ error: "invalid_token", ok: false });
    expect((await connectionState()).revoked_reason).toBe("membership_changed");
    // 元の家庭へ戻っても、失効した接続は復活しない。
    await db.batch([
      db.prepare("DELETE FROM household_members WHERE user_id = ?1").bind(householdAMember.userId),
      db.prepare("INSERT INTO household_members (household_id, user_id) VALUES ('household-a', ?1)").bind(householdAMember.userId),
    ]);
    expect((await verifyAccessToken({ config, db }, tokens.access_token, [])).ok).toBe(false);
  });

  it("所属を失った後のrefreshは拒否し、接続を失効させる", async () => {
    const tokens = await connect(db, memberA);
    await db.prepare("DELETE FROM household_members WHERE user_id = ?1").bind(householdAMember.userId).run();
    const response = await refresh(db, tokens.refresh_token ?? "");
    expect(response.status).toBe(400);
    expect((await connectionState()).revoked_reason).toBe("membership_changed");
  });

  it("パスワードが変わったら、Webのログイン状態と同じく接続を失効させる", async () => {
    const tokens = await connect(db, memberA);
    const { id } = await connectionState();
    await resetPassword(db, householdAMember.email, "pbkdf2_sha256$100000$c2FsdA$aGFzaA");
    expect(await isConnectionActive(db, id, now())).toBe(false);
    expect(await verifyAccessToken({ config, db }, tokens.access_token, [])).toEqual({ error: "invalid_token", ok: false });
    expect((await connectionState()).revoked_reason).toBe("credentials_changed");
    expect((await refresh(db, tokens.refresh_token ?? "")).status).toBe(400);
  });

  it("同意画面で確かめた後にパスワードが変わったら、codeを発行しない", async () => {
    // 古いセッション(世代0)のまま、パスワードの再設定(世代1)の後に許可が届く。
    await resetPassword(db, householdAMember.email, "pbkdf2_sha256$100000$c2FsdA$aGFzaA");
    const { redirectUrl } = await consent(db, { ...memberA, userSessionVersion: 0 });
    expect(redirectUrl.searchParams.get("error")).toBe("access_denied");
    const codes = await db.prepare("SELECT count(*) AS count FROM oauth_authorization_codes").first<{ count: number }>();
    expect(codes?.count).toBe(0);
  });

  it("同意の後、交換までにパスワードが変わったら、そのcodeから接続を作らない", async () => {
    const consentResult = await consent(db, memberA);
    await resetPassword(db, householdAMember.email, "pbkdf2_sha256$100000$c2FsdA$aGFzaA");
    const response = await exchangeCode(db, consentResult);
    expect(response.status).toBe(400);
    const rows = await db.prepare("SELECT count(*) AS count FROM oauth_connections").first<{ count: number }>();
    expect(rows?.count).toBe(0);
  });

  it("tokenのPrincipalは接続時の家庭だけを指す", async () => {
    const tokensB = await connect(db, { householdId: "household-b", userId: householdBMember.userId });
    const verified = await verifyAccessToken({ config, db }, tokensB.access_token, ["household.read"]);
    expect(verified.ok && verified.principal.householdId).toBe("household-b");
    expect(verified.ok && verified.principal.userId).toBe(householdBMember.userId);
  });
});

describe("利用者による解除", () => {
  it("解除後はaccess・refreshとも使えず、通知配信の前提となる接続も無効になる", async () => {
    const tokens = await connect(db, memberA);
    const { id } = await connectionState();
    expect(await isConnectionActive(db, id, now())).toBe(true);

    expect(await revokeConnectionForUser(db, householdAMember, id, now())).toBe(true);

    expect(await verifyAccessToken({ config, db }, tokens.access_token, [])).toEqual({ error: "invalid_token", ok: false });
    expect((await refresh(db, tokens.refresh_token ?? "")).status).toBe(400);
    expect(await isConnectionActive(db, id, now())).toBe(false);
    expect(await tokenCount()).toBe(0);
    // 解除前の接続は履歴として残る。
    expect((await connectionState()).revoked_reason).toBe("user_revoked");
  });

  it("同じ家庭の家族や他家庭の利用者は、本人の接続を解除できない", async () => {
    const tokens = await connect(db, memberA);
    const { id } = await connectionState();
    expect(await revokeConnectionForUser(db, familyMemberA, id, now())).toBe(false);
    expect(await revokeConnectionForUser(db, householdBMember, id, now())).toBe(false);
    expect((await verifyAccessToken({ config, db }, tokens.access_token, [])).ok).toBe(true);
    expect(await tokenCount()).toBe(2);
  });

  it("再接続は新しい接続として作られ、解除済みの接続を復活させない", async () => {
    const first = await connect(db, memberA);
    const { id } = await connectionState();
    await revokeConnectionForUser(db, householdAMember, id, now());
    const second = await connect(db, memberA);
    expect((await verifyAccessToken({ config, db }, second.access_token, [])).ok).toBe(true);
    expect((await verifyAccessToken({ config, db }, first.access_token, [])).ok).toBe(false);
    const rows = await db.prepare("SELECT count(*) AS count FROM oauth_connections").first<{ count: number }>();
    expect(rows?.count).toBe(2);
  });

  it("期限切れの接続は通知配信の対象にならない", async () => {
    await connect(db, memberA);
    const { id } = await connectionState();
    const later = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString();
    expect(await isConnectionActive(db, id, later)).toBe(false);
  });
});

describe("接続管理画面の一覧", () => {
  it("本人の接続だけを、家庭名・範囲・状態とともに返す", async () => {
    await connect(db, { ...memberA, approvedScopes: ["household.read"] });
    const listed = await listConnectionsForUser(db, householdAMember, now());
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      clientId: TEST_CLIENT_ID,
      clientName: "Example Assistant",
      householdName: "Household A",
      scopes: "household.read",
      status: "active",
    });
    expect(await listConnectionsForUser(db, familyMemberA, now())).toEqual([]);
    expect(await listConnectionsForUser(db, householdBMember, now())).toEqual([]);
  });

  it("解除済みの履歴が多くても、まだ解除していない接続はすべて返す", async () => {
    await connect(db, memberA);
    const { id: activeId } = await connectionState();
    // 有効な接続より新しい解除済みの履歴を60件作る。
    const statements = Array.from({ length: 60 }, (_, index) => db.prepare(
      `INSERT INTO oauth_connections (id, household_id, user_id, client_id, client_name, scopes, resource, issuer,
         user_session_version, created_at, expires_at, revoked_at, revoked_reason)
       VALUES (?1, 'household-a', ?2, ?3, 'Old', 'household.read', ?4, ?5, 0, ?6, '2099-01-01T00:00:00.000Z', ?6, 'user_revoked')`,
    ).bind(`revoked-${String(index)}`, householdAMember.userId, TEST_CLIENT_ID, config.resource, config.issuer,
      new Date(Date.now() + (index + 1) * 1000).toISOString()));
    await db.batch(statements);
    const listed = await listConnectionsForUser(db, householdAMember, now());
    expect(listed.filter((connection) => connection.status === "revoked")).toHaveLength(50);
    expect(listed.some((connection) => connection.id === activeId)).toBe(true);
  });

  it("解除済み・期限切れを区別し、離れた家庭の名前は返さない", async () => {
    await connect(db, memberA);
    const { id } = await connectionState();
    const later = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString();
    expect((await listConnectionsForUser(db, householdAMember, later))[0].status).toBe("expired");
    await revokeConnectionForUser(db, householdAMember, id, now());
    await db.prepare("DELETE FROM household_members WHERE user_id = ?1").bind(householdAMember.userId).run();
    const [revoked] = await listConnectionsForUser(db, householdAMember, now());
    expect(revoked).toMatchObject({ householdName: null, revokedReason: "user_revoked", status: "revoked" });
  });
});

describe("revocation endpoint", () => {
  it("接続元がrefresh tokenを失効させると、接続全体が解除される", async () => {
    const tokens = await connect(db, memberA);
    const response = await revokeRequest({ client_id: TEST_CLIENT_ID, token: tokens.refresh_token ?? "" });
    expect(response.status).toBe(200);
    expect((await connectionState()).revoked_reason).toBe("client_revoked");
    expect((await verifyAccessToken({ config, db }, tokens.access_token, [])).ok).toBe(false);
  });

  it("別のclient_idからは失効できず、不明なtokenでも存在を明かさない", async () => {
    const tokens = await connect(db, memberA);
    const other = await revokeRequest({ client_id: "https://other.example.test/client.json", token: tokens.access_token });
    expect(other.status).toBe(200);
    expect((await verifyAccessToken({ config, db }, tokens.access_token, [])).ok).toBe(true);
    expect((await revokeRequest({ client_id: TEST_CLIENT_ID, token: "ymr_rt_unknown" })).status).toBe(200);
  });

  it("refreshで得たtokenも同じ接続として失効する", async () => {
    const first = await connect(db, memberA);
    const rotated = await oauth.processRefreshTokenResponse(
      await discoverTestServer(), testClient, await refresh(db, first.refresh_token ?? ""),
    );
    await revokeRequest({ client_id: TEST_CLIENT_ID, token: rotated.access_token });
    expect((await verifyAccessToken({ config, db }, rotated.access_token, [])).ok).toBe(false);
    expect((await refresh(db, rotated.refresh_token ?? "")).status).toBe(400);
  });
});

describe("最終利用日時", () => {
  it("tokenを使うと記録するが、短時間に何度も書き込まない", async () => {
    const tokens = await connect(db, memberA);
    await verifyAccessToken({ config, db, now: () => new Date("2026-01-01T00:00:00.000Z") }, tokens.access_token, []);
    const read = () => db.prepare("SELECT last_used_at FROM oauth_connections").first<{ last_used_at: string }>();
    expect((await read())?.last_used_at).toBe("2026-01-01T00:00:00.000Z");
    await verifyAccessToken({ config, db, now: () => new Date("2026-01-01T00:01:00.000Z") }, tokens.access_token, []);
    expect((await read())?.last_used_at).toBe("2026-01-01T00:00:00.000Z");
  });
});
