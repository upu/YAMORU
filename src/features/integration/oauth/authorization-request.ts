// 認可要求(GET /oauth/authorize)の検証(#436、YDR-052)。
//
// OAuthの規則では、clientとredirect_uriが確かめられるまでは要求元へ
// リダイレクトしてはならない(open redirectになる)。そのためエラーを
// 「画面に表示するもの」と「redirect_uriへ返すもの」に分ける。

import {
  isIntegrationScope,
  normalizeScopes,
  REQUIRED_SCOPE,
  type IntegrationScope,
} from "../scopes";
import type { OAuthConfig } from "./config";

export const AUTHORIZATION_PARAMETERS = [
  "client_id",
  "redirect_uri",
  "response_type",
  "code_challenge",
  "code_challenge_method",
  "scope",
  "state",
  "resource",
] as const;

// redirect_uriが確定する前の失敗。要求元へ戻さず、YAMORUの画面で説明する。
export type AuthorizationPageError = "invalid_client" | "invalid_redirect_uri" | "invalid_request";

export type AuthorizationRedirectError =
  | "invalid_request"
  | "invalid_scope"
  | "invalid_target"
  | "unsupported_response_type";

export type ValidAuthorizationRequest = {
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  requestedScopes: IntegrationScope[];
  resource: string;
  state: string | null;
};

export type ClientRedirectUris = { redirectUris: readonly string[] };

export type AuthorizationRequestResult =
  | { ok: true; request: ValidAuthorizationRequest }
  | { error: AuthorizationPageError; kind: "page"; ok: false }
  | { error: AuthorizationRedirectError; kind: "redirect"; ok: false; redirectUri: string; state: string | null };

const CODE_CHALLENGE_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/u;
// RFC 6749のVSCHAR(0x20-0x7E)。
const STATE_PATTERN = /^[\x20-\x7E]{1,500}$/u;

// 同じ名前のパラメーターが複数ある要求は拒否する(RFC 6749 3.1)。
export function singleParameters(params: URLSearchParams): Map<string, string> | null {
  const values = new Map<string, string>();
  for (const name of AUTHORIZATION_PARAMETERS) {
    const all = params.getAll(name);
    if (all.length > 1) return null;
    if (all.length === 1) values.set(name, all[0]);
  }
  return values;
}

// readは必須のため、要求に含まれていなくても加える。未知のscopeは拒否する。
export function parseRequestedScopes(value: string | undefined): IntegrationScope[] | null {
  const names = (value ?? "").split(" ").filter((name) => name.length > 0);
  if (!names.every(isIntegrationScope)) return null;
  return normalizeScopes([REQUIRED_SCOPE, ...names]);
}

function redirectError(
  error: AuthorizationRedirectError,
  redirectUri: string,
  state: string | null,
): AuthorizationRequestResult {
  return { error, kind: "redirect", ok: false, redirectUri, state };
}

function validateAfterRedirect(
  values: Map<string, string>,
  config: OAuthConfig,
  clientId: string,
  redirectUri: string,
): AuthorizationRequestResult {
  const rawState = values.get("state");
  const state = rawState !== undefined && STATE_PATTERN.test(rawState) ? rawState : null;
  if (rawState !== undefined && state === null) return redirectError("invalid_request", redirectUri, null);
  if (values.get("response_type") !== "code") return redirectError("unsupported_response_type", redirectUri, state);
  const codeChallenge = values.get("code_challenge");
  if (codeChallenge === undefined || !CODE_CHALLENGE_PATTERN.test(codeChallenge)) {
    return redirectError("invalid_request", redirectUri, state);
  }
  // 省略時の既定値はplainなので、S256の明示を必須にする。
  if (values.get("code_challenge_method") !== "S256") return redirectError("invalid_request", redirectUri, state);
  if (values.get("resource") !== config.resource) return redirectError("invalid_target", redirectUri, state);
  const requestedScopes = parseRequestedScopes(values.get("scope"));
  if (requestedScopes === null) return redirectError("invalid_scope", redirectUri, state);
  return {
    ok: true,
    request: { clientId, codeChallenge, redirectUri, requestedScopes, resource: config.resource, state },
  };
}

// clientの解決(CIMDの取得)は呼び出し側が行い、結果のredirect_urisを渡す。
// client_idが不正・未許可ならclientはnull。
export function validateAuthorizationRequest(
  params: URLSearchParams,
  config: OAuthConfig,
  client: ClientRedirectUris | null,
): AuthorizationRequestResult {
  const values = singleParameters(params);
  if (values === null) return { error: "invalid_request", kind: "page", ok: false };
  const clientId = values.get("client_id");
  if (clientId === undefined || client === null) return { error: "invalid_client", kind: "page", ok: false };
  const redirectUri = values.get("redirect_uri");
  // OAuth 2.1では、登録済みの値と文字列として完全一致するredirect_uriだけを使う。
  if (redirectUri === undefined || !client.redirectUris.includes(redirectUri)) {
    return { error: "invalid_redirect_uri", kind: "page", ok: false };
  }
  return validateAfterRedirect(values, config, clientId, redirectUri);
}

// 認可応答(成功・失敗とも)へstateとissを付ける(RFC 9207)。
export function buildAuthorizationResponseUrl(
  redirectUri: string,
  config: OAuthConfig,
  parameters: Record<string, string>,
  state: string | null,
): string {
  const url = new URL(redirectUri);
  for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, value);
  if (state !== null) url.searchParams.set("state", state);
  url.searchParams.set("iss", config.issuer);
  return url.toString();
}
