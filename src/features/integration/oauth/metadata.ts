// 認可サーバーのmetadata(RFC 8414)とProtected Resource Metadata(RFC 9728)。
// MCPクライアントはPRMからissuerを見つけ、ここからendpointと対応方式を読む。

import { INTEGRATION_SCOPES } from "../scopes";
import type { OAuthConfig } from "./config";

export const AUTHORIZATION_PATH = "/oauth/authorize";
export const TOKEN_PATH = "/oauth/token";
export const REVOCATION_PATH = "/oauth/revoke";

export function authorizationServerMetadata(config: OAuthConfig) {
  return {
    authorization_endpoint: `${config.issuer}${AUTHORIZATION_PATH}`,
    // 認可応答の成功・失敗ともにissを付ける(RFC 9207)。
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: true,
    code_challenge_methods_supported: ["S256"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    issuer: config.issuer,
    response_modes_supported: ["query"],
    response_types_supported: ["code"],
    revocation_endpoint: `${config.issuer}${REVOCATION_PATH}`,
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...INTEGRATION_SCOPES],
    token_endpoint: `${config.issuer}${TOKEN_PATH}`,
    token_endpoint_auth_methods_supported: ["none"],
  };
}

export function protectedResourceMetadata(config: OAuthConfig) {
  return {
    authorization_servers: [config.issuer],
    bearer_methods_supported: ["header"],
    resource: config.resource,
    resource_name: "YAMORU",
    scopes_supported: [...INTEGRATION_SCOPES],
  };
}

// 公開情報なので、ブラウザー上のMCPクライアントからも読めるようにする。
export function metadataResponse(body: unknown): Response {
  return Response.json(body, {
    headers: {
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=300",
    },
  });
}
