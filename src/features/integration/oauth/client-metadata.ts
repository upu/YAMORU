// Client ID Metadata Document(CIMD)の取得と検証(#436、YDR-052)。
//
// client_idはクライアント自身が公開するHTTPSのURLで、YAMORUがそこから
// redirect_uri等を取得する。任意のURLを取得するとSSRFの入口になるため、
// 運用者が許可したclient_idの完全一致だけを取得し、さらにURLの形・
// リダイレクト・大きさ・時間を制限する。取得結果はD1へ写し、token
// endpointはその写しだけを使う(取得はしない)。

import { getOAuthClient, upsertOAuthClient, type StoredOAuthClient } from "../../../lib/d1/oauth-clients";
import type { OAuthConfig } from "./config";
import { declaresTooLargeBody, readTextWithLimit } from "./limited-body";

export type ClientResolution =
  | { client: StoredOAuthClient; ok: true }
  | { ok: false; reason: "client_not_allowed" | "invalid_client_metadata" | "metadata_unavailable" };

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const METADATA_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const METADATA_MAX_BYTES = 5 * 1024;
const METADATA_TIMEOUT_MS = 5000;
const MAX_REDIRECT_URIS = 10;
const CLIENT_NAME_MAX_LENGTH = 100;

function isIpLiteral(hostname: string): boolean {
  return hostname.startsWith("[") || /^[\d.]+$/u.test(hostname);
}

// CIMDのclient_idはpathを持つHTTPS URLで、fragment・認証情報・ドット区間を
// 含まない。IPアドレスやlocalhostは、内部宛ての取得を避けるため許さない。
export function isValidClientIdUrl(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === "https:" &&
    url.href === value &&
    url.username === "" && url.password === "" &&
    url.hash === "" && url.pathname !== "/" &&
    !url.pathname.split("/").some((segment) => segment === "." || segment === "..") &&
    !isIpLiteral(url.hostname) && url.hostname !== "localhost";
}

function isValidRedirectUri(value: unknown): value is string {
  if (typeof value !== "string" || !URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === "https:" && url.hash === "" && url.username === "" && url.password === "";
}

// トークンendpointでは"none"(公開クライアント + PKCE)だけを受け付ける。
// 文書の既定値が別方式でも、"none"にも対応すると明示していれば使える。
// どちらにも"none"が無い文書(省略を含む)は、対応を確かめられないため拒否する。
function supportsPublicClientAuthentication(metadata: Record<string, unknown>): boolean {
  const supported = metadata.token_endpoint_auth_methods_supported;
  if (metadata.token_endpoint_auth_method === "none") return true;
  return Array.isArray(supported) && supported.includes("none");
}

function includesOrAbsent(value: unknown, expected: string): boolean {
  return value === undefined || (Array.isArray(value) && value.includes(expected));
}

// 表示名は外部が自由に書ける値なので、制御文字と書式文字(双方向テキストの
// 上書き等)を除き、長さを制限する。同意画面では名前と並べてclient_idの
// ホスト名も表示するため、名前の文字でホスト名の見え方を変えさせない。
// 名前が無いときに使うホスト名も同じ上限に収める(DNS名は最大253文字)。
function displayName(value: unknown, fallback: string): string {
  const limitedFallback = fallback.slice(0, CLIENT_NAME_MAX_LENGTH);
  if (typeof value !== "string") return limitedFallback;
  const cleaned = value.replaceAll(/[\p{Cc}\p{Cf}]/gu, "").trim().slice(0, CLIENT_NAME_MAX_LENGTH);
  return cleaned.length > 0 ? cleaned : limitedFallback;
}

export function parseClientMetadata(
  document: unknown,
  clientId: string,
  fetchedAt: string,
): StoredOAuthClient | null {
  if (typeof document !== "object" || document === null || Array.isArray(document)) return null;
  const metadata = document as Record<string, unknown>;
  const redirectUris = metadata.redirect_uris;
  if (metadata.client_id !== clientId) return null;
  if (!Array.isArray(redirectUris) || redirectUris.length === 0 || redirectUris.length > MAX_REDIRECT_URIS) return null;
  if (!redirectUris.every(isValidRedirectUri)) return null;
  if (!supportsPublicClientAuthentication(metadata)) return null;
  if (!includesOrAbsent(metadata.grant_types, "authorization_code")) return null;
  if (!includesOrAbsent(metadata.response_types, "code")) return null;
  const clientUri = metadata.client_uri;
  return {
    clientName: displayName(metadata.client_name, new URL(clientId).hostname),
    clientUri: isValidRedirectUri(clientUri) ? clientUri : null,
    id: clientId,
    metadataFetchedAt: fetchedAt,
    redirectUris: [...redirectUris],
  };
}

export async function fetchClientMetadata(clientId: string, fetchImpl: FetchLike): Promise<unknown> {
  try {
    const response = await fetchImpl(clientId, {
      headers: { accept: "application/json" },
      // リダイレクト先が内部宛てになる経路を作らないよう、追従しない。
      redirect: "manual",
      signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
    });
    if (response.status !== 200) return null;
    if (declaresTooLargeBody(response.headers, METADATA_MAX_BYTES)) return null;
    const text = await readTextWithLimit(response.body, METADATA_MAX_BYTES);
    return text === null || text === "" ? null : JSON.parse(text);
  } catch {
    return null;
  }
}

function isFresh(client: StoredOAuthClient, now: Date): boolean {
  return now.getTime() - Date.parse(client.metadataFetchedAt) < METADATA_MAX_AGE_MS;
}

export async function resolveOAuthClient(
  db: D1Database,
  config: OAuthConfig,
  clientId: string,
  options: { fetchImpl?: FetchLike; now?: Date } = {},
): Promise<ClientResolution> {
  if (!config.allowedClientIds.includes(clientId) || !isValidClientIdUrl(clientId)) {
    return { ok: false, reason: "client_not_allowed" };
  }
  const now = options.now ?? new Date();
  const cached = await getOAuthClient(db, clientId);
  if (cached !== null && isFresh(cached, now)) return { client: cached, ok: true };
  const document = await fetchClientMetadata(clientId, options.fetchImpl ?? fetch);
  if (document === null) return { ok: false, reason: "metadata_unavailable" };
  const client = parseClientMetadata(document, clientId, now.toISOString());
  if (client === null) return { ok: false, reason: "invalid_client_metadata" };
  await upsertOAuthClient(db, client);
  return { client, ok: true };
}
