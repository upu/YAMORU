---
type: Component Map
title: 外部連携の修正箇所マップ
description: 会話エージェントなど外部クライアントへの委任(OAuth認可、同意画面、接続管理、access tokenの検証)について、最初に読む実装とテスト、守る不変条件、関連する有効なYDRへの入口
tags: [yamoru, components, integration, oauth]
status: stable
---

# 外部連携の修正箇所マップ

## 責務

利用者本人が、会話エージェントなどの外部クライアントへ家庭データへのアクセスを委任する仕組みを扱う([#436](https://github.com/upu/YAMORU/issues/436))。OAuth 2.1の認可サーバー(metadata、同意画面、token・revocation endpoint)、接続(grant)の保存と失効、外部入口でのaccess token検証、接続管理画面を含む。MCPのTool(#439)、共通操作(#435、#437)、通知(#440〜#442)はまだ無い。

## 主要入口

| 役割 | 実装 |
|---|---|
| scopeの定義と説明文 | `src/features/integration/scopes.ts` |
| 環境ごとの設定(受付の有効化、issuer、resource) | `src/features/integration/oauth/config.ts`、`src/features/integration/oauth/runtime.ts` |
| metadata(RFC 8414 / RFC 9728) | `src/features/integration/oauth/metadata.ts` → `src/app/.well-known/` |
| 認可要求の検証と応答URL | `src/features/integration/oauth/authorization-request.ts` |
| 同意画面と許可・拒否 | `src/app/oauth/authorize/` → `src/features/integration/oauth/authorize.ts` |
| CIMDの取得・検証 | `src/features/integration/oauth/client-metadata.ts` → `src/lib/d1/oauth-clients.ts` |
| token・revocation endpoint | `src/features/integration/oauth/token-endpoint.ts`、`revocation-endpoint.ts` → `src/app/oauth/token/`、`src/app/oauth/revoke/` |
| ライブラリ(`@node-oauth/oauth2-server`)とD1の接続 | `src/features/integration/oauth/model.ts`、`server.ts` |
| 接続・tokenの保存と失効 | `src/lib/d1/oauth-connections.ts`、`src/lib/d1/oauth-authorization-codes.ts` |
| access tokenの検証とPrincipal | `src/features/integration/oauth/bearer.ts`、`src/features/integration/principal.ts` |
| 接続管理画面 | `src/app/settings/integrations/` → `src/lib/d1/oauth-connection-list.ts` |

## 重要な不変条件

- 受付は既定で無効。runtime変数`YAMORU_OAUTH_ALLOWED_CLIENT_IDS`に、実接続で検証したclient_id(CIMDのURL)を設定したときだけmetadata・同意画面・endpointが応答する([YDR-052](../decisions/ydr-052-oauth-authorization-server-on-d1.md))。CIMDは許可したclient_idだけを取得する。
- 外部入口は`authenticateBearerRequest` / `verifyAccessToken`を通し、そのPrincipalの`householdId`と`userId`だけを使う。要求本文の利用者IDや家庭IDで`getD1Context`を呼ばない([会話連携設計](../product/conversation-integration.md) 3節)。
- 検証のたびに、tokenの期限、issuer・resource、scope、接続の失効、接続時の家庭への現在の所属、パスワードの世代(`users.session_version`)を確かめる。所属を失った、またはパスワードが変わった接続は失効させ、別の家庭へ転用しない。
- 通知配信など、tokenを介さずに接続を使う処理(#442)は、送信直前に`isConnectionActive`で接続の有効性を確かめる。
- 生のcode・tokenはD1にもログにも残さない。保存はSHA-256だけ。ログは`logOAuthEvent`を通し、ID・理由コードだけを出す。
- 接続管理は本人の接続だけを扱う。同じ家庭の家族でも他人の接続を見たり解除したりできない。

## 関連YDR

- 有効: [YDR-049](../decisions/ydr-049-conversation-command-boundary.md)、[YDR-052](../decisions/ydr-052-oauth-authorization-server-on-d1.md)、[YDR-022](../decisions/ydr-022-cloudflare-workers-d1-migration.md)

## 検証方法

```
npm test -- tests/integration-oauth-request.test.ts tests/integration-connections-ui.test.tsx tests/auth-boundary.test.ts
npm run test:d1 -- src/lib/d1/oauth-flow.d1-test.ts src/lib/d1/oauth-connections-authorization.d1-test.ts src/lib/d1/oauth-clients.d1-test.ts src/lib/d1/oauth-connections-migration.d1-test.ts
```

D1テストは検証済みのOAuthクライアントライブラリ`oauth4webapi`をクライアント役にして流れ全体を確かめる。これは実際の接続先との接続確認(設計のE1)の代わりにはならない。
