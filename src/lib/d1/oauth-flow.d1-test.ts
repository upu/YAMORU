import { env } from "cloudflare:workers";
import * as oauth from "oauth4webapi";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateBearerRequest, verifyAccessToken } from "../../features/integration/oauth/bearer";
import { createOAuthModel } from "../../features/integration/oauth/model";
import { handleTokenRequest } from "../../features/integration/oauth/token-endpoint";
import { householdAMember, resetHouseholdFixtures } from "./test-support/households";
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
  TEST_REDIRECT_URI,
} from "./test-support/oauth";

// 外部クライアント連携(#436)のOAuth 2.1 authorization code + PKCEの流れを、
// 検証済みクライアントライブラリ(oauth4webapi)から実D1上で確かめる。
const db = env.DB;
const config = testOAuthConfig;
const memberA = { householdId: "household-a", userId: householdAMember.userId };

beforeAll(async () => {
  await applyAllMigrations(db);
});

beforeEach(async () => {
  await resetHouseholdFixtures(db);
  await registerTestClient(db);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function connectionRow(): Promise<{ revoked_reason: string | null; scopes: string } | null> {
  return db.prepare("SELECT revoked_reason, scopes FROM oauth_connections LIMIT 1")
    .first<{ revoked_reason: string | null; scopes: string }>();
}

async function tokenError(response: Response): Promise<string> {
  const body = await response.json<{ error: string }>();
  return body.error;
}

describe("authorization code + PKCE", () => {
  it("同意した家庭・利用者・scopeへ束縛したtokenを発行し、issを付けて応答する", async () => {
    const { redirectUrl } = await consent(db, memberA);
    expect(redirectUrl.searchParams.get("iss")).toBe(config.issuer);
    expect(redirectUrl.origin + redirectUrl.pathname).toBe(TEST_REDIRECT_URI);

    const tokens = await connect(db, memberA);
    expect(tokens.token_type).toBe("bearer");
    // expires_inは発行時刻からの残り秒数なので、処理時間の分だけ小さくなり得る。
    expect(tokens.expires_in).toBeGreaterThan(3590);
    expect(tokens.expires_in).toBeLessThanOrEqual(3600);
    expect(tokens.scope).toBe("household.read household.write");
    expect(tokens.refresh_token).toMatch(/^ymr_rt_/u);

    const verified = await verifyAccessToken({ config, db }, tokens.access_token, ["household.write"]);
    expect(verified).toEqual({
      ok: true,
      principal: {
        clientId: TEST_CLIENT_ID,
        connectionId: expect.any(String) as string,
        householdId: "household-a",
        scopes: ["household.read", "household.write"],
        userId: householdAMember.userId,
      },
    });
  });

  it("生のcode・tokenをD1へ保存しない", async () => {
    const consentResult = await consent(db, memberA);
    const code = consentResult.redirectUrl.searchParams.get("code") ?? "";
    const tokens = await oauth.processAuthorizationCodeResponse(
      await discoverTestServer(), testClient, await exchangeCode(db, consentResult),
    );
    const stored = await db.prepare(
      `SELECT (SELECT group_concat(code_hash) FROM oauth_authorization_codes) AS codes,
              (SELECT group_concat(token_hash) FROM oauth_tokens) AS tokens`,
    ).first<{ codes: string; tokens: string }>();
    const everything = JSON.stringify(stored);
    for (const secret of [code, tokens.access_token, tokens.refresh_token ?? ""]) {
      expect(secret.length).toBeGreaterThan(20);
      expect(everything).not.toContain(secret);
    }
  });

  it("codeは一回限りで、再提示されたらその交換で作った接続を失効させる", async () => {
    const consentResult = await consent(db, memberA);
    const first = await oauth.processAuthorizationCodeResponse(
      await discoverTestServer(), testClient, await exchangeCode(db, consentResult),
    );
    const replay = await exchangeCode(db, consentResult);
    expect(replay.status).toBe(400);
    expect(await tokenError(replay)).toBe("invalid_grant");
    expect((await connectionRow())?.revoked_reason).toBe("token_reuse_detected");
    expect(await verifyAccessToken({ config, db }, first.access_token, [])).toEqual({ error: "invalid_token", ok: false });
  });

  it("同じcodeの交換が競合し、消費に負けた側が先に記録したら、勝った側の接続も作らない", async () => {
    const { redirectUrl } = await consent(db, memberA);
    const code = redirectUrl.searchParams.get("code") ?? "";
    const model = createOAuthModel({ config, db });
    // 2つの要求がどちらも消費前の状態を読んだ後に、順に消費を試みる。
    const winner = await model.getAuthorizationCode(code);
    const loser = await model.getAuthorizationCode(code);
    if (winner === false || loser === false) throw new Error("codeを読めません");
    expect(await model.revokeAuthorizationCode(winner)).toBe(true);
    expect(await model.revokeAuthorizationCode(loser)).toBe(false);
    const now = Date.now();
    await expect(model.saveToken({
      accessToken: "ymr_at_race",
      accessTokenExpiresAt: new Date(now + 3600_000),
      authorizationCode: code,
      client: winner.client,
      refreshToken: "ymr_rt_race",
      refreshTokenExpiresAt: new Date(now + 7200_000),
      scope: winner.scope,
      user: winner.user,
    }, { ...winner.client, clientName: "Example Assistant" }, winner.user)).rejects.toThrow("connection is no longer valid");
    expect(await connectionRow()).toBeNull();
  });

  it("期限を過ぎた使用済みcodeが再提示されても、接続を失効させない", async () => {
    const consentResult = await consent(db, memberA);
    const tokens = await oauth.processAuthorizationCodeResponse(
      await discoverTestServer(), testClient, await exchangeCode(db, consentResult),
    );
    await db.prepare(
      "UPDATE oauth_authorization_codes SET created_at = '1999-12-31T00:00:00.000Z', expires_at = '2000-01-01T00:00:00.000Z'",
    ).run();
    const replay = await exchangeCode(db, consentResult);
    expect(await tokenError(replay)).toBe("invalid_grant");
    expect((await connectionRow())?.revoked_reason).toBeNull();
    expect((await verifyAccessToken({ config, db }, tokens.access_token, [])).ok).toBe(true);
  });

  it("同意から交換までにクライアント情報が更新されても、同意時の名前で接続を作る", async () => {
    const consentResult = await consent(db, memberA);
    await db.prepare("UPDATE oauth_clients SET client_name = 'Renamed Assistant'").run();
    await oauth.processAuthorizationCodeResponse(
      await discoverTestServer(), testClient, await exchangeCode(db, consentResult),
    );
    const row = await db.prepare("SELECT client_name FROM oauth_connections").first<{ client_name: string }>();
    expect(row?.client_name).toBe("Example Assistant");
  });

  it("同意画面で照合した名前を記録し、その後にクライアント情報が変わっても引きずられない", async () => {
    // 照合の後、codeの発行より前にCIMDの写しが別の名前へ更新された場合。
    await db.prepare("UPDATE oauth_clients SET client_name = 'Renamed Assistant'").run();
    const consentResult = await consent(db, { ...memberA, clientName: "Example Assistant" });
    await oauth.processAuthorizationCodeResponse(
      await discoverTestServer(), testClient, await exchangeCode(db, consentResult),
    );
    const row = await db.prepare("SELECT client_name FROM oauth_connections").first<{ client_name: string }>();
    expect(row?.client_name).toBe("Example Assistant");
  });

  it("code_verifierが一致しなければtokenを発行しない", async () => {
    const consentResult = await consent(db, memberA);
    const response = await exchangeCode(db, consentResult, { verifier: oauth.generateRandomCodeVerifier() });
    expect(response.status).toBe(400);
    expect(await tokenError(response)).toBe("invalid_grant");
    expect(await connectionRow()).toBeNull();
  });

  it("redirect_uriが認可要求と一致しなければtokenを発行しない", async () => {
    const consentResult = await consent(db, memberA);
    const response = await exchangeCode(db, consentResult, { redirectUri: "https://client.example.test/other" });
    expect(response.status).toBe(400);
    expect(await connectionRow()).toBeNull();
  });

  it("resourceがこのMCPサーバーでなければinvalid_targetで拒否する", async () => {
    const consentResult = await consent(db, memberA);
    const response = await exchangeCode(db, consentResult, { resource: "https://other.example.test/mcp" });
    expect(response.status).toBe(400);
    expect(await tokenError(response)).toBe("invalid_target");
  });

  it("期限切れのcodeは使えない", async () => {
    const consentResult = await consent(db, memberA);
    await db.prepare("UPDATE oauth_authorization_codes SET expires_at = '2000-01-01T00:00:00.000Z', created_at = '1999-12-31T00:00:00.000Z'").run();
    const response = await exchangeCode(db, consentResult);
    expect(await tokenError(response)).toBe("invalid_grant");
  });

  it("許可されていないclient_idにはtokenを発行しない", async () => {
    const consentResult = await consent(db, memberA);
    const otherConfig = { ...config, allowedClientIds: ["https://another.example.test/client.json"] };
    const response = await exchangeCode(db, consentResult, { config: otherConfig });
    expect(response.status).toBe(400);
    expect(await tokenError(response)).toBe("invalid_client");
  });

  it("client secretを送るクライアントは公開クライアントとして扱わず拒否する", async () => {
    const response = await handleTokenRequest(new Request(`${config.issuer}/oauth/token`, {
      body: new URLSearchParams({ client_id: TEST_CLIENT_ID, client_secret: "x", code: "c", grant_type: "authorization_code" }),
      method: "POST",
    }), { config, db });
    expect(await tokenError(response)).toBe("invalid_client");
  });

  it("受付が無効な環境ではtoken endpoint自体が見つからない", async () => {
    const response = await handleTokenRequest(new Request(`${config.issuer}/oauth/token`, { method: "POST" }), { config: null, db });
    expect(response.status).toBe(404);
  });

  it("上限(8KB)を超える本文は読み切らずに拒否する", async () => {
    const response = await handleTokenRequest(new Request(`${config.issuer}/oauth/token`, {
      body: `grant_type=authorization_code&code=${"x".repeat(9 * 1024)}`,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    }), { config, db });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request", error_description: "Request body is too large" });
  });

  it("同じ名前のパラメーターが重複した要求を拒否する", async () => {
    const response = await handleTokenRequest(new Request(`${config.issuer}/oauth/token`, {
      body: "grant_type=authorization_code&grant_type=refresh_token",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    }), { config, db });
    expect(response.status).toBe(400);
    expect(await tokenError(response)).toBe("invalid_request");
  });
});

describe("refresh tokenのローテーション", () => {
  it("新しいtokenを発行し、使ったrefresh tokenは使えなくする", async () => {
    const first = await connect(db, memberA);
    const rotated = await oauth.processRefreshTokenResponse(
      await discoverTestServer(), testClient, await refresh(db, first.refresh_token ?? ""),
    );
    expect(rotated.refresh_token).not.toBe(first.refresh_token);
    expect((await verifyAccessToken({ config, db }, rotated.access_token, [])).ok).toBe(true);
  });

  it("ローテーション済みのrefresh tokenが再提示されたら接続ごと失効させる", async () => {
    const first = await connect(db, memberA);
    const rotated = await oauth.processRefreshTokenResponse(
      await discoverTestServer(), testClient, await refresh(db, first.refresh_token ?? ""),
    );
    const replay = await refresh(db, first.refresh_token ?? "");
    expect(await tokenError(replay)).toBe("invalid_grant");
    expect((await connectionRow())?.revoked_reason).toBe("token_reuse_detected");
    expect((await verifyAccessToken({ config, db }, rotated.access_token, [])).ok).toBe(false);
    expect(await tokenError(await refresh(db, rotated.refresh_token ?? ""))).toBe("invalid_grant");
  });

  it("refreshでscopeを縮めたら、接続の許可範囲も縮めて表示する", async () => {
    const first = await connect(db, memberA);
    const response = await oauth.refreshTokenGrantRequest(
      await discoverTestServer(), testClient, oauth.None(), first.refresh_token ?? "",
      {
        [oauth.customFetch]: (url: string, init: RequestInit) => handleTokenRequest(new Request(url, init), { config, db }),
        additionalParameters: { resource: config.resource, scope: "household.read" },
      },
    );
    const narrowed = await oauth.processRefreshTokenResponse(await discoverTestServer(), testClient, response);
    expect(narrowed.scope).toBe("household.read");
    expect((await connectionRow())?.scopes).toBe("household.read");
    expect((await verifyAccessToken({ config, db }, narrowed.access_token, ["household.write"])).ok).toBe(false);
    // 縮める前に発行した、より広いaccess tokenも期限を待たずに使えなくなる。
    expect(await verifyAccessToken({ config, db }, first.access_token, [])).toEqual({ error: "invalid_token", ok: false });
  });

  it("refreshで読み取りを外すことはできず、常に含める", async () => {
    const first = await connect(db, memberA);
    const response = await oauth.refreshTokenGrantRequest(
      await discoverTestServer(), testClient, oauth.None(), first.refresh_token ?? "",
      {
        [oauth.customFetch]: (url: string, init: RequestInit) => handleTokenRequest(new Request(url, init), { config, db }),
        additionalParameters: { resource: config.resource, scope: "household.write" },
      },
    );
    const rotated = await oauth.processRefreshTokenResponse(await discoverTestServer(), testClient, response);
    expect(rotated.scope).toBe("household.read household.write");
    expect((await connectionRow())?.scopes).toBe("household.read household.write");
  });

  it("同じrefresh tokenの交換が競合し、ローテーションに負けた側は接続ごと失効させる", async () => {
    const first = await connect(db, memberA);
    const model = createOAuthModel({ config, db });
    // 2つの要求がどちらもローテーション前の状態を読んだ後に、順にローテーションを試みる。
    const winner = await model.getRefreshToken(first.refresh_token ?? "");
    const loser = await model.getRefreshToken(first.refresh_token ?? "");
    if (winner === false || loser === false) throw new Error("refresh tokenを読めません");
    expect(await model.revokeToken(winner)).toBe(true);
    expect(await model.revokeToken(loser)).toBe(false);
    expect((await connectionRow())?.revoked_reason).toBe("token_reuse_detected");
  });

  it("期限を過ぎた使用済みrefresh tokenが再提示されても、接続を失効させない", async () => {
    const first = await connect(db, memberA);
    const rotated = await oauth.processRefreshTokenResponse(
      await discoverTestServer(), testClient, await refresh(db, first.refresh_token ?? ""),
    );
    const later = () => new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
    const model = createOAuthModel({ config, db, now: later });
    expect(await model.getRefreshToken(first.refresh_token ?? "")).toBe(false);
    expect((await connectionRow())?.revoked_reason).toBeNull();
    expect((await verifyAccessToken({ config, db }, rotated.access_token, [])).ok).toBe(true);
  });

  it("refreshでscopeを広げることはできない", async () => {
    const first = await connect(db, { ...memberA, approvedScopes: ["household.read"] });
    const response = await oauth.refreshTokenGrantRequest(
      await discoverTestServer(), testClient, oauth.None(), first.refresh_token ?? "",
      {
        [oauth.customFetch]: (url: string, init: RequestInit) => handleTokenRequest(new Request(url, init), { config, db }),
        additionalParameters: { resource: config.resource, scope: "household.read household.write" },
      },
    );
    expect(await tokenError(response)).toBe("invalid_scope");
    // 断られた要求でrefresh tokenはローテーションされず、正しい要求で再試行できる。
    expect((await connectionRow())?.revoked_reason).toBeNull();
    const retried = await refresh(db, first.refresh_token ?? "");
    expect(retried.status).toBe(200);
    expect((await connectionRow())?.revoked_reason).toBeNull();
  });
});

describe("scope・audience・期限の検証", () => {
  it("利用者が外したscopeは付与せず、必要なscopeが無ければ403とscope challengeを返す", async () => {
    const tokens = await connect(db, { ...memberA, approvedScopes: ["household.read"] });
    expect(tokens.scope).toBe("household.read");
    expect((await connectionRow())?.scopes).toBe("household.read");
    const result = await authenticateBearerRequest({ config, db }, new Request(config.resource, {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    }), ["household.write"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(403);
    expect(result.response.headers.get("www-authenticate")).toContain('error="insufficient_scope"');
    expect(result.response.headers.get("www-authenticate")).toContain('scope="household.write"');
  });

  it("tokenが無い要求には401とProtected Resource Metadataの場所を返す", async () => {
    const result = await authenticateBearerRequest({ config, db }, new Request(config.resource), ["household.read"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
    expect(result.response.headers.get("www-authenticate")).toBe(
      'Bearer resource_metadata="https://yamoru.example.test/.well-known/oauth-protected-resource/mcp", scope="household.read"',
    );
  });

  it("別のissuer/resource(例: previewとproduction)で発行したtokenを受け付けない", async () => {
    const tokens = await connect(db, memberA);
    const production = {
      ...config,
      issuer: "https://yamoru-production.example.test",
      resource: "https://yamoru-production.example.test/mcp",
    };
    expect(await verifyAccessToken({ config: production, db }, tokens.access_token, [])).toEqual({ error: "invalid_token", ok: false });
  });

  it("期限を過ぎたaccess tokenを受け付けない", async () => {
    const tokens = await connect(db, memberA);
    const later = () => new Date(Date.now() + 3601 * 1000);
    expect(await verifyAccessToken({ config, db, now: later }, tokens.access_token, [])).toEqual({ error: "invalid_token", ok: false });
  });

  it("refresh tokenやcodeをaccess tokenとして使えない", async () => {
    const tokens = await connect(db, memberA);
    expect((await verifyAccessToken({ config, db }, tokens.refresh_token ?? "", [])).ok).toBe(false);
  });
});

describe("ログ", () => {
  it("token・code・PKCEの値をログへ出さない", async () => {
    const lines: string[] = [];
    const capture = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
    vi.spyOn(console, "info").mockImplementation(capture);
    vi.spyOn(console, "warn").mockImplementation(capture);
    vi.spyOn(console, "error").mockImplementation(capture);
    const consentResult = await consent(db, memberA);
    const tokens = await oauth.processAuthorizationCodeResponse(
      await discoverTestServer(), testClient, await exchangeCode(db, consentResult),
    );
    await exchangeCode(db, consentResult);
    await refresh(db, tokens.refresh_token ?? "");
    const code = consentResult.redirectUrl.searchParams.get("code") ?? "";
    const output = lines.join("\n");
    // 要求元が自由に書ける値(grant_type、許可されていないclient_id)もログへ残さない。
    await handleTokenRequest(new Request(`${config.issuer}/oauth/token`, {
      body: new URLSearchParams({ client_id: "https://evil.example.test/attacker-payload", grant_type: "attacker-grant-payload" }),
      method: "POST",
    }), { config, db });
    expect(output.length).toBeGreaterThan(0);
    expect(lines.join("\n")).not.toContain("attacker-grant-payload");
    expect(lines.join("\n")).not.toContain("attacker-payload");
    expect(output).toContain("yamoru.oauth.token_issued");
    // 利用者が選んだscopeもログへ残さない(YDR-052 §10)。
    expect(output).not.toContain("household.write");
    for (const secret of [code, consentResult.verifier, tokens.access_token, tokens.refresh_token ?? ""]) {
      expect(output).not.toContain(secret);
    }
  });
});
