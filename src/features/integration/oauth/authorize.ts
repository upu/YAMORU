// 同意画面での許可・拒否を、要求元へ返す認可応答URLへ変える(#436)。
// codeの発行はライブラリのauthorizeに任せ、利用者・家庭・許可したscopeは
// 認証済みのWebセッションから渡す。

import OAuth2Server from "@node-oauth/oauth2-server";

import { normalizeScopes, REQUIRED_SCOPE, type IntegrationScope } from "../scopes";
import { buildAuthorizationResponseUrl, type ValidAuthorizationRequest } from "./authorization-request";
import type { OAuthConfig } from "./config";
import { logOAuthEvent } from "./log";
import { createOAuthModel, type GrantUser } from "./model";
import { createOAuthServer } from "./server";

export type AuthorizationApproval = {
  approvedScopes: readonly string[];
  householdId: string;
  request: ValidAuthorizationRequest;
  userId: string;
};

// 利用者が外したscopeは付与しない。要求に無いscopeを画面から足すこともできない。
export function grantedScopes(
  request: ValidAuthorizationRequest,
  approvedScopes: readonly string[],
): IntegrationScope[] {
  const approved = request.requestedScopes.filter((scope) => approvedScopes.includes(scope));
  return normalizeScopes([REQUIRED_SCOPE, ...approved]);
}

function errorName(error: unknown): string {
  return error instanceof OAuth2Server.OAuthError ? error.name : "server_error";
}

export async function approveAuthorization(
  dependencies: { config: OAuthConfig; db: D1Database; now?: () => Date },
  approval: AuthorizationApproval,
): Promise<string> {
  const { config } = dependencies;
  const { request } = approval;
  const server = createOAuthServer(createOAuthModel(dependencies));
  const user: GrantUser = {
    householdId: approval.householdId,
    scopes: grantedScopes(request, approval.approvedScopes),
    userId: approval.userId,
  };
  const query: Record<string, string> = {
    client_id: request.clientId,
    code_challenge: request.codeChallenge,
    code_challenge_method: "S256",
    redirect_uri: request.redirectUri,
    response_type: "code",
  };
  try {
    const code = await server.authorize(
      new OAuth2Server.Request({ body: {}, headers: {}, method: "GET", query }),
      new OAuth2Server.Response(),
      { authenticateHandler: { handle: () => user } },
    );
    logOAuthEvent({ clientId: request.clientId, event: "authorization_granted", scopes: user.scopes });
    return buildAuthorizationResponseUrl(
      request.redirectUri, config, { code: code.authorizationCode }, request.state,
    );
  } catch (error) {
    const name = errorName(error);
    logOAuthEvent({ clientId: request.clientId, error: name, event: "authorization_failed" });
    return buildAuthorizationResponseUrl(request.redirectUri, config, { error: name }, request.state);
  }
}

export function denyAuthorization(config: OAuthConfig, request: ValidAuthorizationRequest): string {
  logOAuthEvent({ clientId: request.clientId, event: "authorization_denied" });
  return buildAuthorizationResponseUrl(
    request.redirectUri, config, { error: "access_denied" }, request.state,
  );
}
