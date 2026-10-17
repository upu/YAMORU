// 外部クライアント向けOAuthの環境ごとの設定(YDR-052)。
//
// - 受付は既定で無効。YAMORU_OAUTH_ALLOWED_CLIENT_IDSへ、実接続で検証した
//   client_id(CIMDのURL)を完全一致で列挙したときだけ有効になる。
// - issuerはリクエストを受けたオリジン、resource(MCPサーバーの正規URI)は
//   `${issuer}/mcp`とする。previewとproductionはオリジンが異なるため、
//   issuer/resourceも自然に別になり、一方で発行したtokenを他方で受け付けない。

export const MCP_RESOURCE_PATH = "/mcp";

export type OAuthConfig = {
  allowedClientIds: readonly string[];
  issuer: string;
  resource: string;
};

export type OAuthEnvironment = {
  YAMORU_OAUTH_ALLOWED_CLIENT_IDS?: string | undefined;
};

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function parseAllowedClientIds(value: string | undefined): string[] {
  if (value === undefined) return [];
  return value
    .split(/[\s,]+/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith("https://"));
}

// RFC 8414はissuerにhttpsを求める。ローカル開発と自動テストだけはloopbackの
// httpを許し、それ以外のhttpでは受付を無効にする。
function isAcceptableOrigin(url: URL): boolean {
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
}

export function resolveOAuthConfig(
  requestUrl: URL,
  environment: OAuthEnvironment,
): OAuthConfig | null {
  const allowedClientIds = parseAllowedClientIds(environment.YAMORU_OAUTH_ALLOWED_CLIENT_IDS);
  if (allowedClientIds.length === 0) return null;
  if (!isAcceptableOrigin(requestUrl)) return null;
  const issuer = requestUrl.origin;
  return { allowedClientIds, issuer, resource: `${issuer}${MCP_RESOURCE_PATH}` };
}

export function protectedResourceMetadataUrl(config: OAuthConfig): string {
  return `${config.issuer}/.well-known/oauth-protected-resource${MCP_RESOURCE_PATH}`;
}
