import { describe, expect, it } from "vitest";

import {
  buildAuthorizationResponseUrl,
  validateAuthorizationRequest,
} from "../src/features/integration/oauth/authorization-request";
import { extractBearerToken } from "../src/features/integration/oauth/bearer";
import { isValidClientIdUrl, parseClientMetadata } from "../src/features/integration/oauth/client-metadata";
import { parseAllowedClientIds, resolveOAuthConfig } from "../src/features/integration/oauth/config";
import { authorizationServerMetadata, protectedResourceMetadata } from "../src/features/integration/oauth/metadata";
import { grantedScopes } from "../src/features/integration/oauth/authorize";
import { declaresTooLargeBody, readTextWithLimit } from "../src/features/integration/oauth/limited-body";
import { isSameConsentScreen } from "../src/app/oauth/authorize/consent-snapshot";

const CLIENT_ID = "https://client.example.test/oauth/client.json";
const REDIRECT_URI = "https://client.example.test/callback";
const config = {
  allowedClientIds: [CLIENT_ID],
  issuer: "https://yamoru.example.test",
  resource: "https://yamoru.example.test/mcp",
};
const client = { redirectUris: [REDIRECT_URI] };

function params(overrides: Record<string, string | null> = {}): URLSearchParams {
  const values: Record<string, string | null> = {
    client_id: CLIENT_ID,
    code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    code_challenge_method: "S256",
    redirect_uri: REDIRECT_URI,
    resource: config.resource,
    response_type: "code",
    scope: "household.read household.write",
    state: "state-1",
    ...overrides,
  };
  const result = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) if (value !== null) result.set(name, value);
  return result;
}

describe("外部接続の受付設定", () => {
  it("許可するclient_idが無ければ受付を無効にする", () => {
    expect(resolveOAuthConfig(new URL("https://yamoru.example.test/oauth/token"), {})).toBeNull();
    expect(resolveOAuthConfig(new URL("https://yamoru.example.test/"), { YAMORU_OAUTH_ALLOWED_CLIENT_IDS: " " })).toBeNull();
  });

  it("issuerは受けたオリジン、resourceはその/mcpにする", () => {
    expect(resolveOAuthConfig(new URL("https://yamoru.example.test/oauth/token?x=1"), {
      YAMORU_OAUTH_ALLOWED_CLIENT_IDS: CLIENT_ID,
    })).toEqual(config);
  });

  it("loopback以外のhttpでは受付を無効にする", () => {
    const environment = { YAMORU_OAUTH_ALLOWED_CLIENT_IDS: CLIENT_ID };
    expect(resolveOAuthConfig(new URL("http://yamoru.example.test/"), environment)).toBeNull();
    expect(resolveOAuthConfig(new URL("http://localhost:3000/"), environment)?.issuer).toBe("http://localhost:3000");
  });

  it("許可リストはhttpsのURLだけを、空白またはカンマ区切りで読む", () => {
    expect(parseAllowedClientIds(`${CLIENT_ID}, https://b.example.test/c.json\nhttp://insecure.test/c.json`))
      .toEqual([CLIENT_ID, "https://b.example.test/c.json"]);
  });
});

describe("認可要求の検証", () => {
  it("正しい要求を受け付け、読み取りscopeを必ず含める", () => {
    const result = validateAuthorizationRequest(params({ scope: "household.write" }), config, client);
    expect(result).toEqual({
      ok: true,
      request: {
        clientId: CLIENT_ID,
        codeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
        redirectUri: REDIRECT_URI,
        requestedScopes: ["household.read", "household.write"],
        resource: config.resource,
        state: "state-1",
      },
    });
  });

  it("scopeが省略されたら読み取りだけを要求したものとして扱う", () => {
    const result = validateAuthorizationRequest(params({ scope: null }), config, client);
    expect(result.ok && result.request.requestedScopes).toEqual(["household.read"]);
  });

  it.each([
    ["clientが未許可", params(), null, "invalid_client"],
    ["client_idが無い", params({ client_id: null }), client, "invalid_client"],
    ["redirect_uriが登録と不一致", params({ redirect_uri: `${REDIRECT_URI}/` }), client, "invalid_redirect_uri"],
    ["redirect_uriが無い", params({ redirect_uri: null }), client, "invalid_redirect_uri"],
  ])("%sなら要求元へ戻さず画面で説明する", (_label, search, resolvedClient, error) => {
    expect(validateAuthorizationRequest(search, config, resolvedClient)).toEqual({ error, kind: "page", ok: false });
  });

  it("同じパラメーターの重複は画面で拒否する", () => {
    const search = params();
    search.append("redirect_uri", "https://attacker.example.test/cb");
    expect(validateAuthorizationRequest(search, config, client)).toMatchObject({ error: "invalid_request", kind: "page" });
  });

  it.each([
    ["response_typeがcode以外", { response_type: "token" }, "unsupported_response_type"],
    ["PKCEが無い", { code_challenge: null }, "invalid_request"],
    ["PKCEがplain", { code_challenge_method: "plain" }, "invalid_request"],
    ["PKCEのmethod省略", { code_challenge_method: null }, "invalid_request"],
    ["challengeの形式が不正", { code_challenge: "short" }, "invalid_request"],
    ["resourceが別のサーバー", { resource: "https://other.example.test/mcp" }, "invalid_target"],
    ["resourceが無い", { resource: null }, "invalid_target"],
    ["未知のscope", { scope: "household.read admin" }, "invalid_scope"],
  ])("%sならredirect_uriへエラーを返す", (_label, overrides, error) => {
    expect(validateAuthorizationRequest(params(overrides), config, client)).toEqual({
      error, kind: "redirect", ok: false, redirectUri: REDIRECT_URI, state: "state-1",
    });
  });

  it("応答URLにはstateとissを付ける", () => {
    const url = new URL(buildAuthorizationResponseUrl(`${REDIRECT_URI}?keep=1`, config, { error: "access_denied" }, "s"));
    expect(Object.fromEntries(url.searchParams)).toEqual({
      error: "access_denied", iss: config.issuer, keep: "1", state: "s",
    });
  });
});

describe("同意で付与するscope", () => {
  const validated = validateAuthorizationRequest(params({ scope: "household.write events.subscribe" }), config, client);
  const request = validated.ok ? validated.request : null;

  it("外したscopeは付与せず、要求に無いscopeを足せない", () => {
    if (request === null) throw new Error("要求が不正です");
    expect(grantedScopes(request, ["household.write", "notifications.manage"])).toEqual(["household.read", "household.write"]);
    expect(grantedScopes(request, [])).toEqual(["household.read"]);
  });
});

describe("metadata", () => {
  it("認可サーバーはPKCE S256・公開クライアント・CIMD・issの付与を示す", () => {
    expect(authorizationServerMetadata(config)).toMatchObject({
      authorization_endpoint: "https://yamoru.example.test/oauth/authorize",
      authorization_response_iss_parameter_supported: true,
      client_id_metadata_document_supported: true,
      code_challenge_methods_supported: ["S256"],
      issuer: config.issuer,
      token_endpoint: "https://yamoru.example.test/oauth/token",
      token_endpoint_auth_methods_supported: ["none"],
    });
    expect(authorizationServerMetadata(config)).not.toHaveProperty("registration_endpoint");
  });

  it("Protected Resource MetadataはMCPの正規URIとissuerを結ぶ", () => {
    expect(protectedResourceMetadata(config)).toMatchObject({
      authorization_servers: [config.issuer],
      resource: config.resource,
      scopes_supported: ["household.read", "household.write", "notifications.manage", "events.subscribe"],
    });
  });
});

describe("CIMDのclient_idと文書", () => {
  it.each([
    [CLIENT_ID, true],
    ["https://client.example.test/", false],
    ["http://client.example.test/client.json", false],
    ["https://127.0.0.1/client.json", false],
    ["https://[::1]/client.json", false],
    ["https://localhost/client.json", false],
    ["https://user:pass@client.example.test/client.json", false],
    ["https://client.example.test/client.json#x", false],
    ["https://client.example.test/a/../client.json", false],
    [`https://client.example.test/${"a".repeat(2048)}`, false],
  ])("%s の妥当性は%s", (value, expected) => {
    expect(isValidClientIdUrl(value)).toBe(expected);
  });

  it("表示名が無ければclient_idのホスト名を使う", () => {
    const parsed = parseClientMetadata({
      client_id: CLIENT_ID, redirect_uris: [REDIRECT_URI], token_endpoint_auth_method: "none",
    }, CLIENT_ID, "2026-10-17T00:00:00.000Z");
    expect(parsed?.clientName).toBe("client.example.test");
  });

  it("redirect_urisが空、fragment付き、または多すぎる文書を拒否する", () => {
    for (const redirectUris of [[], [`${REDIRECT_URI}#f`], Array.from({ length: 11 }, (_, i) => `${REDIRECT_URI}/${String(i)}`)]) {
      expect(parseClientMetadata({
        client_id: CLIENT_ID, redirect_uris: redirectUris, token_endpoint_auth_method: "none",
      }, CLIENT_ID, "t")).toBeNull();
    }
  });

  it("表示名が無く、ホスト名が長いときも上限の100文字に収める", () => {
    const longHostClientId = `https://${"a".repeat(60)}.${"b".repeat(60)}.example.test/client.json`;
    const parsed = parseClientMetadata({
      client_id: longHostClientId, redirect_uris: [REDIRECT_URI], token_endpoint_auth_method: "none",
    }, longHostClientId, "t");
    expect(parsed?.clientName).toHaveLength(100);
  });

  it("表示名から双方向テキストの上書きなどの書式文字を除く", () => {
    const parsed = parseClientMetadata({
      client_id: CLIENT_ID,
      client_name: "Assistant\u202E(moc.elpmaxe)\u200B",
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: "none",
    }, CLIENT_ID, "t");
    expect(parsed?.clientName).toBe("Assistant(moc.elpmaxe)");
  });

  it("公開クライアント(none)への対応を明示しない文書を拒否する", () => {
    const base = { client_id: CLIENT_ID, redirect_uris: [REDIRECT_URI] };
    expect(parseClientMetadata(base, CLIENT_ID, "t")).toBeNull();
    expect(parseClientMetadata({ ...base, token_endpoint_auth_methods_supported: ["private_key_jwt"] }, CLIENT_ID, "t")).toBeNull();
    expect(parseClientMetadata({ ...base, token_endpoint_auth_methods_supported: ["none"] }, CLIENT_ID, "t")).not.toBeNull();
  });
});

describe("bearer token", () => {
  it("Authorizationヘッダーのbearerだけを読み、queryのtokenは無視する", () => {
    expect(extractBearerToken(new Request("https://y.test/mcp", { headers: { authorization: "Bearer ymr_at_abc" } }))).toBe("ymr_at_abc");
    expect(extractBearerToken(new Request("https://y.test/mcp?access_token=ymr_at_abc"))).toBeNull();
    expect(extractBearerToken(new Request("https://y.test/mcp", { headers: { authorization: "Basic abc" } }))).toBeNull();
    // 認証方式名は大文字小文字を区別しない。
    expect(extractBearerToken(new Request("https://y.test/mcp", { headers: { authorization: "bearer ymr_at_abc" } }))).toBe("ymr_at_abc");
  });
});

describe("本文の上限", () => {
  it("上限を超えた時点で読むのをやめ、nullを返す", async () => {
    const small = new Response("a".repeat(10)).body;
    const large = new Response("a".repeat(11)).body;
    await expect(readTextWithLimit(small, 10)).resolves.toBe("a".repeat(10));
    await expect(readTextWithLimit(large, 10)).resolves.toBeNull();
    await expect(readTextWithLimit(null, 10)).resolves.toBe("");
  });

  it("Content-Lengthが上限を超えると宣言する要求は本文を読まずに判定できる", () => {
    expect(declaresTooLargeBody(new Headers({ "content-length": "8193" }), 8192)).toBe(true);
    expect(declaresTooLargeBody(new Headers({ "content-length": "8192" }), 8192)).toBe(false);
    expect(declaresTooLargeBody(new Headers(), 8192)).toBe(false);
  });
});

describe("同意画面の表示と送信の照合", () => {
  function displayed(values: Record<string, string>): FormData {
    const formData = new FormData();
    for (const [name, value] of Object.entries(values)) formData.set(name, value);
    return formData;
  }
  const current = { clientName: "Example Assistant", householdId: "household-a" };

  it("表示した接続元の名前と家庭が送信時と一致するときだけ許可を受け付ける", () => {
    const shown = { displayedClientName: "Example Assistant", displayedHouseholdId: "household-a" };
    expect(isSameConsentScreen(displayed(shown), current)).toBe(true);
    expect(isSameConsentScreen(displayed(shown), { ...current, clientName: "Renamed Assistant" })).toBe(false);
    expect(isSameConsentScreen(displayed(shown), { ...current, householdId: "household-b" })).toBe(false);
    expect(isSameConsentScreen(displayed({ displayedClientName: "Example Assistant" }), current)).toBe(false);
  });
});
