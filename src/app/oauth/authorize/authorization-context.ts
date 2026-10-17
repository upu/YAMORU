import "server-only";

import type { AuthenticatedD1User } from "../../../lib/d1/authentication";
import { loadAccountState, type HouseholdSummary } from "../../../lib/d1/households";
import type { StoredOAuthClient } from "../../../lib/d1/oauth-clients";
import {
  buildAuthorizationResponseUrl,
  singleParameters,
  validateAuthorizationRequest,
  type AuthorizationPageError,
  type ValidAuthorizationRequest,
} from "../../../features/integration/oauth/authorization-request";
import { resolveOAuthClient } from "../../../features/integration/oauth/client-metadata";
import type { OAuthConfig } from "../../../features/integration/oauth/config";
import { logOAuthEvent } from "../../../features/integration/oauth/log";

export type AuthorizationContext =
  | { error: AuthorizationPageError | "client_unavailable"; kind: "page_error" }
  | { kind: "redirect"; url: string }
  | {
      client: StoredOAuthClient;
      household: HouseholdSummary | null;
      kind: "consent";
      request: ValidAuthorizationRequest;
    };

async function resolveClient(
  db: D1Database,
  config: OAuthConfig,
  params: URLSearchParams,
): Promise<StoredOAuthClient | "unavailable" | null> {
  const clientId = singleParameters(params)?.get("client_id");
  if (clientId === undefined) return null;
  const resolution = await resolveOAuthClient(db, config, clientId);
  if (resolution.ok) return resolution.client;
  // 許可リストに無いclient_idは要求元が自由に書ける値なので、ログへ書かない。
  const loggedClientId = resolution.reason === "client_not_allowed" ? undefined : clientId;
  logOAuthEvent({ clientId: loggedClientId, event: "client_metadata_rejected", reason: resolution.reason });
  return resolution.reason === "client_not_allowed" ? null : "unavailable";
}

// 同意画面の表示と、許可・拒否の送信の両方で同じ検証を行う。送信時も
// hiddenの値を信用せず、元の認可要求を最初から検証し直す。
export async function loadAuthorizationContext(
  db: D1Database,
  config: OAuthConfig,
  user: AuthenticatedD1User,
  params: URLSearchParams,
): Promise<AuthorizationContext> {
  const client = await resolveClient(db, config, params);
  if (client === "unavailable") return { error: "client_unavailable", kind: "page_error" };
  const result = validateAuthorizationRequest(params, config, client);
  if (!result.ok && result.kind === "page") return { error: result.error, kind: "page_error" };
  if (!result.ok) {
    return {
      kind: "redirect",
      url: buildAuthorizationResponseUrl(result.redirectUri, config, { error: result.error }, result.state),
    };
  }
  if (client === null) return { error: "invalid_client", kind: "page_error" };
  const { household } = await loadAccountState(db, { userId: user.id });
  return { client, household, kind: "consent", request: result.request };
}
