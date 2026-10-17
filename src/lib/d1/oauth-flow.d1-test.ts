import { env } from "cloudflare:workers";
import * as oauth from "oauth4webapi";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateBearerRequest, verifyAccessToken } from "../../features/integration/oauth/bearer";
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
    expect(output).toContain("yamoru.oauth.token_issued");
    for (const secret of [code, consentResult.verifier, tokens.access_token, tokens.refresh_token ?? ""]) {
      expect(output).not.toContain(secret);
    }
  });
});
