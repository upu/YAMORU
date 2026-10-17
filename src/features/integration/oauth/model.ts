// @node-oauth/oauth2-serverのmodelをD1へ接続する(YDR-052)。
//
// プロトコル上の検証(PKCEの照合、redirect_uriの完全一致、codeの期限と一回性、
// refresh tokenのローテーション、scopeの縮小のみ許可)はライブラリが行い、
// ここは保存と、YAMORU固有の条件(許可済みclient、家庭への所属、resource/
// issuerの束縛、再使用の検知)を担う。

import OAuth2Server from "@node-oauth/oauth2-server";

import {
  consumeAuthorizationCode,
  findAuthorizationCode,
  markAuthorizationCodeReplayed,
  saveAuthorizationCode,
} from "../../../lib/d1/oauth-authorization-codes";
import { getOAuthClient } from "../../../lib/d1/oauth-clients";
import {
  createConnectionFromCode,
  findToken,
  issueRotatedTokens,
  lostConnectionPremise,
  revokeConnection,
  rotateRefreshToken,
  type IssuedTokenHashes,
} from "../../../lib/d1/oauth-connections";
import {
  formatScopes,
  normalizeScopes,
  parseStoredScopes,
  REQUIRED_SCOPE,
  type IntegrationScope,
} from "../scopes";
import type { OAuthConfig } from "./config";
import { generateSecret, hashSecret, SECRET_PREFIXES } from "./secrets";

// 同意したときに決まり、codeとtokenへ引き継ぐ利用者側の情報。
export type GrantUser = {
  clientName?: string;
  codeHash?: string;
  connectionId?: string;
  householdId: string;
  scopes: IntegrationScope[];
  userId: string;
  // 同意時だけ持つ。codeの発行はこの世代が現在のusersと一致するときに限る。
  userSessionVersion?: number;
};

export type OAuthModel = OAuth2Server.AuthorizationCodeModel & OAuth2Server.RefreshTokenModel;

export type OAuthModelDependencies = {
  config: OAuthConfig;
  db: D1Database;
  now?: () => Date;
};

const SUPPORTED_GRANTS = ["authorization_code", "refresh_token"];

function grantUser(user: OAuth2Server.User): GrantUser {
  return user as GrantUser;
}

function scopeArray(scope: string[] | undefined): IntegrationScope[] {
  return parseStoredScopes((scope ?? []).join(" "));
}

async function tokenHashes(token: OAuth2Server.Token): Promise<IssuedTokenHashes> {
  const { accessTokenExpiresAt, refreshToken, refreshTokenExpiresAt } = token;
  if (refreshToken === undefined || accessTokenExpiresAt === undefined || refreshTokenExpiresAt === undefined) {
    throw new OAuth2Server.ServerError("Server error: token lifetime is missing");
  }
  return {
    access: { expiresAt: accessTokenExpiresAt.toISOString(), hash: await hashSecret(token.accessToken) },
    refresh: { expiresAt: refreshTokenExpiresAt.toISOString(), hash: await hashSecret(refreshToken) },
  };
}

function clientModel({ config, db }: OAuthModelDependencies) {
  return {
    // 公開クライアント(PKCE + token_endpoint_auth_method "none")だけを扱う。
    // 運用者が許可したclient_idで、同意画面でCIMDを取得済みのものに限る。
    async getClient(clientId: string, clientSecret: string | null | undefined) {
      if (typeof clientSecret === "string" && clientSecret.length > 0) return false;
      if (!config.allowedClientIds.includes(clientId)) return false;
      const client = await getOAuthClient(db, clientId);
      if (client === null) return false;
      return {
        clientName: client.clientName,
        grants: SUPPORTED_GRANTS,
        id: client.id,
        redirectUris: client.redirectUris,
      };
    },

    validateScope(user: OAuth2Server.User) {
      const scopes = normalizeScopes(grantUser(user).scopes);
      return Promise.resolve<string[] | false>(scopes.length > 0 ? scopes : false);
    },

    generateAccessToken: () => Promise.resolve(generateSecret(SECRET_PREFIXES.accessToken)),
    generateAuthorizationCode: () => Promise.resolve(generateSecret(SECRET_PREFIXES.authorizationCode)),
    generateRefreshToken: () => Promise.resolve(generateSecret(SECRET_PREFIXES.refreshToken)),
    // access tokenの検証はライブラリのauthenticateではなくbearer.tsで行う。
    getAccessToken: () => Promise.resolve(false as const),
  };
}

async function revokeReplayedCode(db: D1Database, codeHash: string, at: string): Promise<void> {
  const connectionId = await markAuthorizationCodeReplayed(db, codeHash, at);
  if (connectionId !== null) await revokeConnection(db, connectionId, "token_reuse_detected", at);
}

function authorizationCodeModel({ config, db, now = () => new Date() }: OAuthModelDependencies) {
  return {
    async saveAuthorizationCode(
      code: Pick<OAuth2Server.AuthorizationCode, "authorizationCode" | "codeChallenge" | "codeChallengeMethod" | "expiresAt" | "redirectUri" | "scope">,
      client: OAuth2Server.Client,
      user: OAuth2Server.User,
    ) {
      const owner = grantUser(user);
      if (code.codeChallenge === undefined || code.codeChallengeMethod !== "S256") return false;
      const saved = await saveAuthorizationCode(db, {
        clientId: client.id,
        clientName: typeof client.clientName === "string" ? client.clientName : new URL(client.id).hostname.slice(0, 100),
        codeChallenge: code.codeChallenge,
        codeChallengeMethod: "S256",
        codeHash: await hashSecret(code.authorizationCode),
        createdAt: now().toISOString(),
        expiresAt: code.expiresAt.toISOString(),
        householdId: owner.householdId,
        redirectUri: code.redirectUri,
        resource: config.resource,
        scopes: formatScopes(scopeArray(code.scope)),
        userId: owner.userId,
        userSessionVersion: owner.userSessionVersion ?? -1,
      });
      if (!saved) throw new OAuth2Server.AccessDeniedError("Access denied: household membership is required");
      return { ...code, client, user };
    },

    async getAuthorizationCode(authorizationCode: string) {
      const codeHash = await hashSecret(authorizationCode);
      const code = await findAuthorizationCode(db, codeHash);
      if (code === null || code.resource !== config.resource) return false;
      // 期限を過ぎたcodeは何にも使えない。再提示されても接続を失効させず、
      // 短命のcodeが後から接続を切る手段として残らないようにする。
      if (code.expiresAt <= now().toISOString()) return false;
      if (code.consumedAt !== null) {
        // 一回限りのcodeが再提示された。漏えいの可能性があるため、そのcodeで
        // 作られた接続を失効させる(OAuth 2.1 4.1.3)。
        await revokeReplayedCode(db, codeHash, now().toISOString());
        return false;
      }
      return {
        authorizationCode,
        client: { grants: SUPPORTED_GRANTS, id: code.clientId },
        codeChallenge: code.codeChallenge,
        codeChallengeMethod: code.codeChallengeMethod,
        expiresAt: new Date(code.expiresAt),
        redirectUri: code.redirectUri,
        scope: parseStoredScopes(code.scopes),
        user: {
          codeHash,
          householdId: code.householdId,
          scopes: parseStoredScopes(code.scopes),
          userId: code.userId,
        } satisfies GrantUser,
      };
    },

    async revokeAuthorizationCode(code: OAuth2Server.AuthorizationCode) {
      const codeHash = await hashSecret(code.authorizationCode);
      if (await consumeAuthorizationCode(db, codeHash, now().toISOString())) return true;
      // 同じcodeで同時に交換され、もう一方が先に消費した。どちらが正規の利用者か
      // 区別できないため、再提示と同じく扱い、勝った側の接続も作らせない。
      await revokeReplayedCode(db, codeHash, now().toISOString());
      return false;
    },
  };
}

function refreshTokenModel({ config, db, now = () => new Date() }: OAuthModelDependencies) {
  return {
    async getRefreshToken(refreshToken: string) {
      const token = await findToken(db, await hashSecret(refreshToken), "refresh");
      if (token?.revokedAt !== null || token.issuer !== config.issuer || token.resource !== config.resource) {
        return false;
      }
      const at = now().toISOString();
      // 期限を過ぎたrefresh tokenは何にも使えない。再提示されても接続を失効させず、
      // 期限切れの秘密が後から接続を切る手段として残らないようにする。
      if (token.expiresAt <= at) return false;
      if (token.rotatedAt !== null) {
        // ローテーション済みのrefresh tokenが再提示された。盗用とみなし接続ごと失効させる。
        await revokeConnection(db, token.connectionId, "token_reuse_detected", at);
        return false;
      }
      const lost = lostConnectionPremise(token);
      if (lost !== null) {
        await revokeConnection(db, token.connectionId, lost, at);
        return false;
      }
      return {
        client: { grants: SUPPORTED_GRANTS, id: token.clientId },
        refreshToken,
        refreshTokenExpiresAt: new Date(token.expiresAt),
        scope: parseStoredScopes(token.scopes),
        user: {
          connectionId: token.connectionId,
          householdId: token.householdId,
          scopes: parseStoredScopes(token.scopes),
          userId: token.userId,
        } satisfies GrantUser,
      };
    },

    async revokeToken(token: OAuth2Server.RefreshToken) {
      const at = now().toISOString();
      if (await rotateRefreshToken(db, await hashSecret(token.refreshToken), at)) return true;
      // 同じrefresh tokenで同時に交換され、もう一方が先にローテーションした。
      // どちらが正規の利用者か区別できないため、再提示と同じく接続ごと失効させる。
      const { connectionId } = grantUser(token.user);
      if (connectionId !== undefined) await revokeConnection(db, connectionId, "token_reuse_detected", at);
      return false;
    },
  };
}

function saveTokenModel({ config, db, now = () => new Date() }: OAuthModelDependencies) {
  return {
    async saveToken(token: OAuth2Server.Token, client: OAuth2Server.Client, user: OAuth2Server.User) {
      const owner = grantUser(user);
      // refreshでは要求に応じてscopeを縮められるが、読み取りは常に含める。
      const scopeList = normalizeScopes([REQUIRED_SCOPE, ...scopeArray(token.scope)]);
      const scopes = formatScopes(scopeList);
      const hashes = await tokenHashes(token);
      const at = now().toISOString();
      const saved = owner.connectionId === undefined
        ? await createConnectionFromCode(db, {
            clientId: client.id,
            codeHash: owner.codeHash ?? "",
            connectionId: crypto.randomUUID(),
            householdId: owner.householdId,
            issuer: config.issuer,
            now: at,
            resource: config.resource,
            scopes,
            userId: owner.userId,
          }, hashes)
        : await issueRotatedTokens(db, owner.connectionId, scopes, hashes, at);
      if (!saved) throw new OAuth2Server.InvalidGrantError("Invalid grant: connection is no longer valid");
      return { ...token, client, scope: scopeList, user };
    },
  };
}

export function createOAuthModel(dependencies: OAuthModelDependencies): OAuthModel {
  return {
    ...clientModel(dependencies),
    ...authorizationCodeModel(dependencies),
    ...refreshTokenModel(dependencies),
    ...saveTokenModel(dependencies),
  };
}
