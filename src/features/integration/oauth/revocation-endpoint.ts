// revocation endpoint(POST /oauth/revoke、RFC 7009)。クライアント側から
// 連携を解除したときに呼ばれる。access/refreshのどちらを渡されても、その
// 接続全体を失効させる(YAMORUの接続管理画面からの解除と同じ結果)。

import { findToken, revokeConnection } from "../../../lib/d1/oauth-connections";
import { logOAuthEvent } from "./log";
import { hashSecret } from "./secrets";
import {
  notFoundResponse,
  oauthErrorResponse,
  readFormBody,
  type OAuthEndpointDependencies,
} from "./token-endpoint";

async function findAnyToken(db: D1Database, token: string) {
  const hash = await hashSecret(token);
  return await findToken(db, hash, "refresh") ?? await findToken(db, hash, "access");
}

export async function handleRevocationRequest(
  request: Request,
  dependencies: OAuthEndpointDependencies,
): Promise<Response> {
  const { config, db } = dependencies;
  if (config === null) return notFoundResponse();
  const body = await readFormBody(request);
  if (body instanceof Response) return body;
  const token = body.get("token");
  const clientId = body.get("client_id");
  if (token === undefined || clientId === undefined) {
    return oauthErrorResponse(400, "invalid_request", "token and client_id are required");
  }
  const found = await findAnyToken(db, token);
  // RFC 7009 2.2: 不明・失効済みのtokenでも200を返し、存在を明かさない。
  // 別のクライアントへ発行されたtokenは、そのクライアントだけが失効できる。
  if (found?.clientId === clientId && found.revokedAt === null) {
    const now = (dependencies.now ?? (() => new Date()))().toISOString();
    await revokeConnection(db, found.connectionId, "client_revoked", now);
    logOAuthEvent({ clientId, connectionId: found.connectionId, event: "connection_revoked", reason: "client_revoked" });
  }
  return new Response(null, { headers: { "cache-control": "no-store" }, status: 200 });
}
