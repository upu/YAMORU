// 外部クライアントのaccess tokenを検証し、IntegrationPrincipalへ変える(#436)。
// MCPアダプタ(#439)など、外部から家庭データへ触れるすべての入口はこれを
// 通す。tokenの期限だけでなく、issuer・resource(audience)・scope・接続の
// 失効・現在の家庭所属を毎回確かめる(conversation-integration.md 3節)。

import {
  findToken,
  lostConnectionPremise,
  revokeConnection,
  touchConnection,
} from "../../../lib/d1/oauth-connections";
import type { IntegrationPrincipal } from "../principal";
import { formatScopes, hasScopes, parseStoredScopes, type IntegrationScope } from "../scopes";
import { protectedResourceMetadataUrl, type OAuthConfig } from "./config";
import { hashSecret, SECRET_PREFIXES } from "./secrets";

export type AccessTokenFailure = "insufficient_scope" | "invalid_token";

export type AccessTokenVerification =
  | { ok: true; principal: IntegrationPrincipal }
  | { error: AccessTokenFailure; ok: false };

type VerifyDependencies = { config: OAuthConfig; db: D1Database; now?: () => Date };

export async function verifyAccessToken(
  dependencies: VerifyDependencies,
  accessToken: string,
  requiredScopes: readonly IntegrationScope[],
): Promise<AccessTokenVerification> {
  const { config, db } = dependencies;
  const now = (dependencies.now ?? (() => new Date()))();
  if (!accessToken.startsWith(SECRET_PREFIXES.accessToken)) return { error: "invalid_token", ok: false };
  const token = await findToken(db, await hashSecret(accessToken), "access");
  if (token === null || token.revokedAt !== null) return { error: "invalid_token", ok: false };
  if (token.expiresAt <= now.toISOString()) return { error: "invalid_token", ok: false };
  if (token.issuer !== config.issuer || token.resource !== config.resource) {
    return { error: "invalid_token", ok: false };
  }
  const lost = lostConnectionPremise(token);
  if (lost !== null) {
    // 接続時の家庭から離れた、またはパスワードが変わった。別の家庭へ転用せず、
    // Webのログイン状態と同じく接続を失効させる。
    await revokeConnection(db, token.connectionId, lost, now.toISOString());
    return { error: "invalid_token", ok: false };
  }
  const scopes = parseStoredScopes(token.scopes);
  if (!hasScopes(scopes, requiredScopes)) return { error: "insufficient_scope", ok: false };
  await touchConnection(db, token.connectionId, now);
  return {
    ok: true,
    principal: {
      clientId: token.clientId,
      connectionId: token.connectionId,
      householdId: token.householdId,
      scopes,
      userId: token.userId,
    },
  };
}

// Authorizationヘッダーのbearer tokenだけを受け付ける。query stringのtokenは扱わない。
export function extractBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header === null) return null;
  const match = /^Bearer ([A-Za-z0-9\-._~+/]+=*)$/u.exec(header.trim());
  return match === null ? null : match[1];
}

function challenge(
  config: OAuthConfig,
  requiredScopes: readonly IntegrationScope[],
  error?: { code: AccessTokenFailure; description: string },
): string {
  const parts = [`resource_metadata="${protectedResourceMetadataUrl(config)}"`];
  if (requiredScopes.length > 0) parts.push(`scope="${formatScopes(requiredScopes)}"`);
  if (error !== undefined) {
    parts.unshift(`error="${error.code}"`);
    parts.push(`error_description="${error.description}"`);
  }
  return `Bearer ${parts.join(", ")}`;
}

// 401/403とWWW-Authenticate(RFC 6750、RFC 9728、MCP認可仕様のscope challenge)。
export function bearerErrorResponse(
  config: OAuthConfig,
  requiredScopes: readonly IntegrationScope[],
  failure: AccessTokenFailure | "missing_token",
): Response {
  if (failure === "missing_token") {
    return new Response(null, {
      headers: { "www-authenticate": challenge(config, requiredScopes) },
      status: 401,
    });
  }
  const description = failure === "insufficient_scope"
    ? "This operation requires additional permission"
    : "The access token is invalid, expired, or revoked";
  return Response.json({ error: failure, error_description: description }, {
    headers: { "www-authenticate": challenge(config, requiredScopes, { code: failure, description }) },
    status: failure === "insufficient_scope" ? 403 : 401,
  });
}

export async function authenticateBearerRequest(
  dependencies: VerifyDependencies,
  request: Request,
  requiredScopes: readonly IntegrationScope[],
): Promise<{ ok: true; principal: IntegrationPrincipal } | { ok: false; response: Response }> {
  const token = extractBearerToken(request);
  if (token === null) {
    return { ok: false, response: bearerErrorResponse(dependencies.config, requiredScopes, "missing_token") };
  }
  const result = await verifyAccessToken(dependencies, token, requiredScopes);
  if (!result.ok) {
    return { ok: false, response: bearerErrorResponse(dependencies.config, requiredScopes, result.error) };
  }
  return result;
}
