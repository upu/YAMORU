---
type: Component Map
title: 外部連携の修正箇所マップ
description: 会話エージェントなど外部クライアントへの委任(OAuth認可、同意画面、接続管理、access tokenの検証)と変更操作(prepare/commitと受付記録)について、最初に読む実装とテスト、守る不変条件、関連する有効なYDRへの入口
tags: [yamoru, components, integration, oauth]
status: stable
---

# 外部連携の修正箇所マップ

## 責務

利用者本人が、会話エージェントなどの外部クライアントへ家庭データへのアクセスを委任する仕組みを扱う([#436](https://github.com/upu/YAMORU/issues/436))。OAuth 2.1の認可サーバー(metadata、同意画面、token・revocation endpoint)、接続(grant)の保存と失効、外部入口でのaccess token検証、接続管理画面を含む。変更操作の共通基盤(command_prepare / command_commit / operation_getと受付記録、[#437](https://github.com/upu/YAMORU/issues/437))は、Todoの完了・訂正・取消の3 commandだけを持ち、競合は家庭の世代([YDR-053](../decisions/ydr-053-conversation-read-revisions.md))で検出する。登録・編集と追加確認(confirmation_url)はまだ無い。MCPのTool(#439)と通知(#440〜#442)もまだ無く、変更操作を外部へ公開する入口は存在しない。

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
| 変更操作の入口(prepare/commit/operation_get) | `src/features/integration/commands/service.ts` |
| 変更操作の入力・エラー契約、command別の処理 | `src/features/integration/commands/contract.ts`、`input.ts`、`todo-complete.ts`、`todo-history.ts` |
| 受付記録の保存と、世代の確認・成功を確定させる文 | `src/lib/d1/integration-operations.ts` |
| 家庭の世代と`expected_revision`の照合 | `src/features/integration/commands/revision.ts` → `src/lib/d1/conversation-read.ts` |
| commandのpreview用の読み取りと業務更新の文 | `src/lib/d1/todos/command-plans.ts` → `completion.ts`、`corrections.ts` |

## 重要な不変条件

- 受付は既定で無効。runtime変数`YAMORU_OAUTH_ALLOWED_CLIENT_IDS`に、実接続で検証したclient_id(CIMDのURL)を設定したときだけmetadata・同意画面・endpointが応答する([YDR-052](../decisions/ydr-052-oauth-authorization-server-on-d1.md))。CIMDは許可したclient_idだけを取得する。
- 外部入口は`authenticateBearerRequest` / `verifyAccessToken`を通し、そのPrincipalの`householdId`と`userId`だけを使う。要求本文の利用者IDや家庭IDで`getD1Context`を呼ばない([会話連携設計](../product/conversation-integration.md) 3節)。
- 検証のたびに、tokenの期限、issuer・resource、scope、接続の失効、接続時の家庭への現在の所属、パスワードの世代(`users.session_version`)を確かめる。所属を失った、またはパスワードが変わった接続は失効させ、別の家庭へ転用しない。
- 通知配信など、tokenを介さずに接続を使う処理(#442)は、送信直前に`isConnectionActive`で接続の有効性を確かめる。
- 生のcode・tokenはD1にもログにも残さない。保存はSHA-256だけ。ログは`logOAuthEvent`を通し、ID・理由コードだけを出す。
- 接続管理は本人の接続だけを扱う。同じ家庭の家族でも他人の接続を見たり解除したりできない。
- 変更操作は、業務の更新と受付記録の成功を同じD1 batchへ載せる。最初の`revisionGuardStatement`がpreview時の家庭の世代を、最後の`commitReceiptStatement`が条件(未確定・期限内・接続が有効・業務の記録が存在・取消/訂正の対象が最新の完了)を確かめ、満たさなければbatch全体を取り消す([YDR-054](../decisions/ydr-054-integration-command-receipts.md))。業務の更新はWeb操作と同じ条件付きSQL(`completionStatements`等)を使い、外部向けに判定を複製しない。
- 「今」や「昨日」はprepare時に固定し、commitでは保存した正規化commandからpreviewを計算し直して、一致したときだけ実行する。同じ操作IDの再送は保存した結果を返す。
- 家庭の世代は保守的で、previewから実行までに家族が無関係なものを更新しても再確認(`stale_preview`)になる。

## 関連YDR

- 有効: [YDR-049](../decisions/ydr-049-conversation-command-boundary.md)、[YDR-052](../decisions/ydr-052-oauth-authorization-server-on-d1.md)、[YDR-054](../decisions/ydr-054-integration-command-receipts.md)、[YDR-015](../decisions/ydr-015-occurrence-state-activitylog-history-safe-undo.md)、[YDR-026](../decisions/ydr-026-completion-correction-events.md)、[YDR-022](../decisions/ydr-022-cloudflare-workers-d1-migration.md)

## 検証方法

```
npm test -- tests/integration-oauth-request.test.ts tests/integration-connections-ui.test.tsx tests/auth-boundary.test.ts tests/integration-command-input.test.ts
npm run test:d1 -- src/lib/d1/oauth-flow.d1-test.ts src/lib/d1/oauth-connections-authorization.d1-test.ts src/lib/d1/oauth-clients.d1-test.ts src/lib/d1/oauth-connections-migration.d1-test.ts
npm run test:d1 -- src/lib/d1/integration-commands.d1-test.ts src/lib/d1/integration-history-commands.d1-test.ts src/lib/d1/integration-operations-migration.d1-test.ts
```

D1テストは検証済みのOAuthクライアントライブラリ`oauth4webapi`をクライアント役にして流れ全体を確かめる。これは実際の接続先との接続確認(設計のE1)の代わりにはならない。変更操作のテストは、確認と実行の間に家族の更新や接続の解除を割り込ませ(`interruptBeforeBatch`)、業務データと受付記録が全成功か全取消になることを確かめる。
