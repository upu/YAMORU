// 外部クライアント向けOAuthの環境ごとの設定(YDR-052、YDR-072)。
//
// - ChatGPTを標準許可し、YAMORU_OAUTH_ALLOWED_CLIENT_IDSは追加許可に使う。
//   この一覧はOAuthの要求処理とWorkerの通知走査で共有する。
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
const DEFAULT_CLIENT_ID = "https://chatgpt.com/oauth/client.json";

export function parseAllowedClientIds(value: string | undefined): string[] {
  const additionalClientIds = (value ?? "")
    .split(/[\s,]+/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith("https://"));
  return [...new Set([DEFAULT_CLIENT_ID, ...additionalClientIds])];
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
  if (!isAcceptableOrigin(requestUrl)) return null;
  const issuer = requestUrl.origin;
  return { allowedClientIds, issuer, resource: `${issuer}${MCP_RESOURCE_PATH}` };
}

export function protectedResourceMetadataUrl(config: OAuthConfig): string {
  return `${config.issuer}/.well-known/oauth-protected-resource${MCP_RESOURCE_PATH}`;
}
