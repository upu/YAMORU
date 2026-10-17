// refreshで要求されたscopeを、ライブラリへ渡す前に確かめる(#436)。
//
// @node-oauth/oauth2-server 5.3.0は、refresh tokenをローテーションしてから
// 要求scopeを検証する。範囲外のscopeを要求されると、古いtokenは使用済みに
// なったまま新しいtokenが発行されず、正しい要求で再試行すると再使用として
// 接続ごと失効してしまう。そのため、範囲外の要求はローテーションの前に断る。

import { findToken } from "../../../lib/d1/oauth-connections";
import { isIntegrationScope, parseStoredScopes } from "../scopes";
import { hashSecret } from "./secrets";

// 断るべきならtrue。tokenが見つからない等の判定はライブラリに任せる。
export async function refreshRequestExceedsGrant(
  db: D1Database,
  body: ReadonlyMap<string, string>,
): Promise<boolean> {
  const requested = body.get("scope");
  const refreshToken = body.get("refresh_token");
  if (body.get("grant_type") !== "refresh_token" || requested === undefined || refreshToken === undefined) {
    return false;
  }
  const names = requested.split(" ").filter((name) => name.length > 0);
  if (!names.every(isIntegrationScope)) return true;
  const token = await findToken(db, await hashSecret(refreshToken), "refresh");
  if (token === null) return false;
  const granted = parseStoredScopes(token.scopes);
  return !names.every((name) => granted.includes(name));
}
