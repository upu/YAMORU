import OAuth2Server from "@node-oauth/oauth2-server";

import type { OAuthModel } from "./model";

// tokenの寿命(YDR-052)。access tokenは短命にし、解除や所属の変更はtokenの
// 寿命を待たず、検証のたびに接続の状態を見て反映する。
export const ACCESS_TOKEN_LIFETIME_SECONDS = 60 * 60;
export const REFRESH_TOKEN_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
export const AUTHORIZATION_CODE_LIFETIME_SECONDS = 2 * 60;

export function createOAuthServer(model: OAuthModel): OAuth2Server {
  return new OAuth2Server({
    accessTokenLifetime: ACCESS_TOKEN_LIFETIME_SECONDS,
    allowEmptyState: true,
    alwaysIssueNewRefreshToken: true,
    authorizationCodeLifetime: AUTHORIZATION_CODE_LIFETIME_SECONDS,
    model,
    refreshTokenLifetime: REFRESH_TOKEN_LIFETIME_SECONDS,
    // 公開クライアントはclient secretを持たない。codeの交換はPKCEで、
    // refreshはローテーションと再使用検知で守る。
    requireClientAuthentication: { authorization_code: false, refresh_token: false },
  });
}
