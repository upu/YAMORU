// 外部クライアント連携(#436)のD1統合テストが共有する、OAuthクライアント側の
// 操作。クライアント役には検証済みのOAuthクライアントライブラリ(oauth4webapi)
// を使い、YAMORU側の実装(同意・token endpoint)へ直接つなぐ。HTTPは経由せず、
// token endpointへの通信はcustomFetchでhandleTokenRequestへ渡す。

import * as oauth from "oauth4webapi";

import { approveAuthorization } from "../../../features/integration/oauth/authorize";
import { validateAuthorizationRequest } from "../../../features/integration/oauth/authorization-request";
import type { OAuthConfig } from "../../../features/integration/oauth/config";
import { authorizationServerMetadata } from "../../../features/integration/oauth/metadata";
import { handleTokenRequest } from "../../../features/integration/oauth/token-endpoint";
import { upsertOAuthClient } from "../oauth-clients";

export const TEST_CLIENT_ID = "https://client.example.test/oauth/client.json";
export const TEST_REDIRECT_URI = "https://client.example.test/callback";

export const testOAuthConfig: OAuthConfig = {
  allowedClientIds: [TEST_CLIENT_ID],
  issuer: "https://yamoru.example.test",
  resource: "https://yamoru.example.test/mcp",
};

export const testClient: oauth.Client = { client_id: TEST_CLIENT_ID };

export async function registerTestClient(db: D1Database, fetchedAt = new Date().toISOString()): Promise<void> {
  await upsertOAuthClient(db, {
    clientName: "Example Assistant",
    clientUri: null,
    id: TEST_CLIENT_ID,
    metadataFetchedAt: fetchedAt,
    redirectUris: [TEST_REDIRECT_URI],
  });
}

export async function discoverTestServer(config: OAuthConfig = testOAuthConfig): Promise<oauth.AuthorizationServer> {
  return oauth.processDiscoveryResponse(
    new URL(config.issuer),
    Response.json(authorizationServerMetadata(config)),
  );
}

export function tokenFetch(db: D1Database, config: OAuthConfig, now?: () => Date) {
  return (url: string, init: RequestInit) =>
    handleTokenRequest(new Request(url, init), { config, db, now });
}

export type ConsentInput = {
  approvedScopes?: readonly string[];
  config?: OAuthConfig;
  householdId: string;
  requestedScope?: string;
  userId: string;
  // 同意画面で確かめたWebセッションのパスワード世代。fixtureの利用者は0。
  userSessionVersion?: number;
};

export type ConsentResult = { redirectUrl: URL; state: string; verifier: string };

// 認可要求を作り、利用者が同意画面で許可したときの応答URLを得る。
export async function consent(db: D1Database, input: ConsentInput): Promise<ConsentResult> {
  const config = input.config ?? testOAuthConfig;
  const verifier = oauth.generateRandomCodeVerifier();
  const state = oauth.generateRandomState();
  const params = new URLSearchParams({
    client_id: TEST_CLIENT_ID,
    code_challenge: await oauth.calculatePKCECodeChallenge(verifier),
    code_challenge_method: "S256",
    redirect_uri: TEST_REDIRECT_URI,
    resource: config.resource,
    response_type: "code",
    scope: input.requestedScope ?? "household.read household.write",
    state,
  });
  const validated = validateAuthorizationRequest(params, config, { redirectUris: [TEST_REDIRECT_URI] });
  if (!validated.ok) throw new Error(`認可要求が不正です: ${validated.error}`);
  const redirectUrl = await approveAuthorization({ config, db }, {
    approvedScopes: input.approvedScopes ?? validated.request.requestedScopes,
    householdId: input.householdId,
    request: validated.request,
    userId: input.userId,
    userSessionVersion: input.userSessionVersion ?? 0,
  });
  return { redirectUrl: new URL(redirectUrl), state, verifier };
}

export async function exchangeCode(
  db: D1Database,
  consentResult: ConsentResult,
  options: { config?: OAuthConfig; redirectUri?: string; resource?: string; verifier?: string } = {},
): Promise<Response> {
  const config = options.config ?? testOAuthConfig;
  const as = await discoverTestServer(config);
  const params = oauth.validateAuthResponse(as, testClient, consentResult.redirectUrl, consentResult.state);
  return oauth.authorizationCodeGrantRequest(
    as,
    testClient,
    oauth.None(),
    params,
    options.redirectUri ?? TEST_REDIRECT_URI,
    options.verifier ?? consentResult.verifier,
    {
      [oauth.customFetch]: tokenFetch(db, config),
      additionalParameters: { resource: options.resource ?? config.resource },
    },
  );
}

export async function connect(db: D1Database, input: ConsentInput): Promise<oauth.TokenEndpointResponse> {
  const consentResult = await consent(db, input);
  const as = await discoverTestServer(input.config);
  return oauth.processAuthorizationCodeResponse(as, testClient, await exchangeCode(db, consentResult, input));
}

export async function refresh(
  db: D1Database,
  refreshToken: string,
  config: OAuthConfig = testOAuthConfig,
): Promise<Response> {
  return oauth.refreshTokenGrantRequest(await discoverTestServer(config), testClient, oauth.None(), refreshToken, {
    [oauth.customFetch]: tokenFetch(db, config),
    additionalParameters: { resource: config.resource },
  });
}
