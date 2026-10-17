// token endpoint(POST /oauth/token)。authorization_codeとrefresh_tokenの
// 交換はライブラリが処理し、ここはHTTPの入出力、重複パラメーター・
// resource(RFC 8707)の事前検証、ログを担う(#436、YDR-052)。

import OAuth2Server from "@node-oauth/oauth2-server";

import type { OAuthConfig } from "./config";
import { declaresTooLargeBody, readTextWithLimit } from "./limited-body";
import { logOAuthEvent } from "./log";
import { createOAuthModel } from "./model";
import { createOAuthServer } from "./server";

const MAX_BODY_BYTES = 8 * 1024;
const NO_STORE_HEADERS = { "cache-control": "no-store", pragma: "no-cache" };

export type OAuthEndpointDependencies = {
  config: OAuthConfig | null;
  db: D1Database;
  now?: () => Date;
};

export function oauthErrorResponse(
  status: number,
  error: string,
  description?: string,
  headers: Record<string, string> = {},
): Response {
  const body = description === undefined ? { error } : { error, error_description: description };
  return Response.json(body, { headers: { ...NO_STORE_HEADERS, ...headers }, status });
}

export function notFoundResponse(): Response {
  return new Response(null, { status: 404 });
}

// application/x-www-form-urlencodedの本文を、同じ名前の重複を拒否して読む。
export async function readFormBody(request: Request): Promise<Map<string, string> | Response> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.split(";")[0].trim().toLowerCase() !== "application/x-www-form-urlencoded") {
    return oauthErrorResponse(400, "invalid_request", "Content-Type must be application/x-www-form-urlencoded");
  }
  const text = declaresTooLargeBody(request.headers, MAX_BODY_BYTES)
    ? null
    : await readTextWithLimit(request.body, MAX_BODY_BYTES);
  if (text === null) return oauthErrorResponse(400, "invalid_request", "Request body is too large");
  const values = new Map<string, string>();
  for (const [name, value] of new URLSearchParams(text)) {
    if (values.has(name)) return oauthErrorResponse(400, "invalid_request", `Duplicate parameter: ${name}`);
    values.set(name, value);
  }
  return values;
}

function libraryRequest(request: Request, body: Map<string, string>): OAuth2Server.Request {
  const encoded = new URLSearchParams([...body]).toString();
  const headers: Record<string, string> = {
    "content-length": String(new TextEncoder().encode(encoded).byteLength),
    "content-type": "application/x-www-form-urlencoded",
  };
  const authorization = request.headers.get("authorization");
  if (authorization !== null) headers.authorization = authorization;
  return new OAuth2Server.Request({ body: Object.fromEntries(body), headers, method: "POST", query: {} });
}

// 5xxの説明文には内部エラー(SQL等)が入り得るため、外へ返さない。
function responseBody(response: OAuth2Server.Response): unknown {
  if ((response.status ?? 500) >= 500) return { error: "server_error" };
  return response.body;
}

export async function handleTokenRequest(
  request: Request,
  dependencies: OAuthEndpointDependencies,
): Promise<Response> {
  const { config } = dependencies;
  if (config === null) return notFoundResponse();
  const body = await readFormBody(request);
  if (body instanceof Response) return body;
  const resource = body.get("resource");
  if (resource !== undefined && resource !== config.resource) {
    return oauthErrorResponse(400, "invalid_target", "The requested resource is not served by this server");
  }
  const server = createOAuthServer(createOAuthModel({ ...dependencies, config }));
  const response = new OAuth2Server.Response();
  const grantType = body.get("grant_type");
  try {
    await server.token(libraryRequest(request, body), response);
    logOAuthEvent({ clientId: body.get("client_id"), event: "token_issued", grantType });
  } catch (error) {
    const name = error instanceof OAuth2Server.OAuthError ? error.name : "server_error";
    logOAuthEvent({ clientId: body.get("client_id"), error: name, event: "token_failed", grantType });
    // ライブラリが応答を組み立てる前に失敗した場合でも、成功として返さない。
    if ((response.status ?? 200) < 400) response.status = 500;
  }
  const headers: Record<string, string> = { ...NO_STORE_HEADERS };
  const challenge = response.get("www-authenticate") as string | undefined;
  if (challenge !== undefined) headers["www-authenticate"] = challenge;
  return Response.json(responseBody(response), { headers, status: response.status ?? 500 });
}
