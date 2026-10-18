---
type: Component Map
title: 認証付きMCP入口の修正箇所マップ
description: 共通ユースケースをMCPへ公開するHTTP境界、入力schema、権限、再接続、検証の入口
tags: [yamoru, components, integration, mcp, oauth]
status: stable
---

# 認証付きMCP入口

## 責務と入口

導入・復旧と最終確認の種類は[会話連携の検証表](../references/conversation-integration-checks.md)へまとめる。`connection_get`の`notification_polling`はAPIの対応と外部タスクの状態不明を分け、`integration_guide_url`を返す。従来のEvents関連のbooleanだけで定期取得まで非対応と判断しない。公開output schemaは成功形と構造化エラーのunionで、SDK内部の成功時検証とは分ける。

`src/app/mcp/route.ts` → `src/features/integration/mcp/http.ts`は、既存OAuthのresource `/mcp`へStreamable HTTPを接続する。認証・業務判定は[外部連携](integration.md)、読み取りは[会話読み取り](conversation-read.md)へ委譲する。SQLや日付計算をMCPへ複製しない。

通知への返答は`notification_context_get`と任意の`command_prepare.notification_reference`を[通知への返答](notification-replies.md)へ委譲する。どちらも現在の通知設定権限を検証し、元の回への束縛、複数件の選択、sourceの保持期限をサーバーで照合する。本人スヌーズと家庭の完了/予定変更のscopeは引き続き分ける。

| 変更したいこと | 入口 |
|---|---|
| HTTP、Origin、本文上限、OAuth challenge | `mcp/http.ts`、環境取得は`runtime.ts` |
| Tool名・説明・副作用、公開入力 | `catalog.ts`、`command-schemas.ts` |
| 公開出力の形、SDK登録と一覧 | `output-schemas.ts`、`server.ts` |
| 2026版の要求・HTTP header照合・発見 | `modern-request.ts`、`modern.ts` |
| 版に共通のTool定義・権限説明・実行 | `server-tools.ts`、`instructions.ts` |
| 共通読み取り・commandへの委譲 | `service.ts` |
| 権限追加・期限切れの再認証案内 | `auth-challenge.ts` → 既存`oauth/bearer.ts` |
| 回数制限・同時commit枠とbatchのfence | `src/lib/d1/integration-mcp-limits.ts`、`commands/service.ts`の`commitGuard` |

## 不変条件

- `/mcp`だけをAuth.jsのCookie判定から除外し、Bearer検証を必須にする。`/mcp-help`や未知の下位経路は除外しない。Cookieやqueryのtokenを代用しない。
- 設定前は404、認証なしは401とProtected Resource Metadata、権限不足は説明と`mcp/www_authenticate`を返す。秘密を会話へ貼らせない。
- server・transport・Principalは要求ごとに作る。SDKセッションを使わず、操作の保存結果はD1、再送は同じoperation_id、応答喪失はoperation_getを使う。接続を閉じても操作結果は消えない。
- `command_prepare`はcommandを識別子とするunionを公開し、未実装command・未知のキーを受け付けない。業務の必須値・暦・競合・実施者は共通層が判断する。command追加時は公開schemaも同時に更新する。
- prepareはpreview/receiptを保存するのでreadOnlyではない。commitは変更操作、attention_getも候補の保存状態を更新するのでreadOnlyではない。権限をannotationsから推定しない。
- 家庭の文章をserver instructionsやTool定義へ埋め込まない。タイトル・メモ・履歴は利用者のデータとして扱う。actor・家庭・接続元は検証済みtokenだけから導出する。
- 本文は64 KiB、Tool引数の要素数は1,000まで。batch JSON-RPCは受け付けない。内部エラーや不正JSONの本文を応答へ反射しない。
- scope・token・家庭所属・失効を毎回検証し、読み取り後も確認する。入力のuser_id/household_id/scopeを信用しない。

## SDKと配備

公式`@modelcontextprotocol/sdk` 1.32.1、Zod 4.6.7、Cloudflare向け`@cfworker/json-schema` 4.1.1を使う。Workerで動的コード生成をしないvalidatorを指定する。公式SDKの対応版は`2025-11-25`以前であり、ここで通し確認した版は`2025-11-25`。MCP Events 2.0 (`2026-07-28`)への対応をSDK採用から推定しない。独自の2026入口は明示的なprovider有効時だけEventsを公開する。v0.21.0はYDR-070により定期取得を先行し、未実証のEvents実送信は#474へ分ける。従来の`notification_delivery:false`は維持し、外部の定期取得APIへの対応は`notification_polling`で明示する。どの対応フラグも外部タスクの稼働・到達の証明にはしない。

#442では`2026-07-28`の入口を明示的に追加する。initializeを使わない要求ごとにprotocolVersion・clientCapabilitiesとHTTPのMCP-Protocol-Version / Mcp-Method / Mcp-Nameを照合する。nameのBase64 sentinelも復号して比較し、不一致はHeaderMismatch、未知の版は対応版を案内する。Toolの一覧・説明・schema・実行・OAuth challengeを旧版と共有し、業務判定は複製しない。resultTypeとserverInfoを返すが、Eventsの購読や配信をそのことだけで対応済みにしない。

providerが有効な場合、`events/list`は認証済みの`household.read`で固定のイベント名・filter schema・payload schema・必要scopeだけを返す。家庭の候補や購読先は返さない。発見に`events.subscribe`を要求すると、追加同意の前にイベントが見つからず接続先へ権限要求を登録できないためである。`events/subscribe`と`events/unsubscribe`は引き続きreadと`events.subscribe`を要求し、callback確認・購読保存は追加同意後だけ行う。provider無効時の非公開と未認証の拒否は維持する。

`YAMORU_OAUTH_ALLOWED_CLIENT_IDS`が既定で空のため、MCPも既定で無効。設定は[Cloudflare運用手順](../references/cloudflare-production-operations.md)に従う。ブラウザーclientのOriginは同一originだけを既定で許可し、Inspector等は`YAMORU_MCP_ALLOWED_ORIGINS`へ完全なoriginを空白/カンマ区切りで設定する。パス・認証情報付きURLは採用しない。Originを送らないサーバー間clientもBearer認証を要する。

回数制限と同時commit枠は[YDR-058](../decisions/ydr-058-mcp-request-budgets.md)とmigration `0039`で追加する。利用者の固定1分窓を全接続で共有し、read 60回・prepare/commit各20回、接続別の有効commit leaseは2件まで。429とRetry-Afterを返し、leaseを業務batch内のDB時刻でfenceする。期限切れのWorkerは書き込めず、古いreleaseは新しい枠へ作用しない。

0039は追加表だけで、新しい秘密・contract migrationはない。旧Worker/追加schemaと新Worker/追加schemaの両方で既存操作を保持する。Workerを戻しても共通の操作receiptは保持され、MCP入口だけが利用不可になる。previewはmainのCI成功後に通常の自動配備で検証し、ローカルからの手動配備を常用しない。

## 検証と未完了の境界

`tests/integration-mcp-http.test.ts`は設定前・Cookie/query非採用・Origin・切断済み要求、`integration-mcp.d1-test.ts`はOAuth、schema、家庭境界、登録/完了/在庫、再送・切断後照合・再接続・失効・本文上限を実D1で確認する。

`integration-mcp-limits.d1-test.ts`は並列の回数・同時commit枠と期限切れのfence、`integration-mcp-limits-migration.d1-test.ts`は更新DB・旧SQL・制約・cascadeの検証入口。全migrationを当てるD1テストと生成schema確認は空DBの検証も兼ねる。

`e2e/mcp-integration.spec.ts`はローカル専用の架空clientで、ブラウザーのOAuth同意、実token endpoint、公式SDKの登録→取得→完了→次回確認、revocationを通す。通常のNext開発serverと、ビルド済みWorkerを対象に同じテストを使う。e2e envの架空clientはpreview/productionへ設定しない。

`integration-mcp-modern.d1-test.ts`は2026版の発見・一覧・読み取り、header不一致・版の再選択・入力上限、共通操作と再送、権限不足の再認証案内を検証する。実HTTPのMCP E2EでもOAuth後の2026版要求を送り、旧SDKの経路と併存させる。

Eventsの購読APIは同じ認証入口を使い、household.readとevents.subscribeを要する。subscribe/unsubscribeはcommitの回数・同時枠・DB時刻のfenceを共有する。callback失敗は静的な分類付きの-32015で返し、URLや秘密を応答へ載せない。runtimeに検証済みproviderがない間はEventsを公開しない。[通知outbox](notification-outbox.md)に購読と実送信の実装・未完了の境界を示す。

Events処理の既知の失敗は`mcp_event_failure`へmethod・code・reasonの固定分類だけを記録する。入力schema、filterのschema/矛盾、署名鍵の形式とcallback確認を区別し、要求本文・未知のキー名・URL・鍵・token・家庭IDをログへ出さない。HTTP400だけで原因を推測せず、この分類と実応答を照合する。入力エラーの外部応答は従来の固定messageのままとする。

server/discoverとconnection_getのEvents可否は、同じprovider設定を反映する。購読APIの対応と実配信は区別する。外部の定期取得は、これらのEvents関連booleanと別に対応・実行主体・タスク状態不明を返す。

Mcp-NameはTool・Resource・Prompt向けの標準ヘッダーであり、Events購読では必須にしない。EventsでもMcp-MethodとprotocolVersionは本文と照合する。[Streamable HTTPの標準ヘッダー](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http#standard-request-headers)（2026-10-18確認）。

```sh
npm test -- tests/integration-mcp-http.test.ts tests/auth-boundary.test.ts
npm run test:d1 -- src/lib/d1/integration-mcp.d1-test.ts
npm run test:e2e:local
npm run test:e2e:worker
```

### 実dotで確認した範囲（2026-10-18）

main `529a519e2fde070150cc446aa7e4af5b31e3e5c0`の[Quality checks](https://github.com/upu/YAMORU/actions/runs/39078251715)と[自動preview配備](https://github.com/upu/YAMORU/actions/runs/39078701944)の成功後、利用者が許可したpreviewの架空家庭で、ChatGPTのカスタムMCPプラグインから実際のdotを操作した。許可リストはpreviewのDashboardだけに公式CIMD `https://chatgpt.com/oauth/client.json`を設定した。本番の受付は変更していない。

| 検証 | 期待結果 | 実際の結果 |
|---|---|---|
| OAuth・Tool発見・本人照会 | 許可した家庭・本人・権限で接続 | CIMDを自動検出し、PKCEで接続。dotの`connection_get`が家庭・本人・`household.read household.write`を返した |
| 登録・取得 | 指定どおり1件だけ登録し、再取得でも一致 | 初回2026-10-18・完了から7日後・担当がWebとD1の保存内容に一致 |
| 完了・次回確認 | 指定日の完了と7日後の次回を保存 | 2026-10-18の実施者を保存し、今回の完了と次回2026-10-25の未完了をdot・Web・D1で照合。業務の受付記録も成功 |
| 接続解除 | 現在の取得を拒否し、過去の成功を転用しない | dotの呼び出しが`oauth_token_invalid_grant`で拒否され、再接続を案内 |
| 再接続 | 新しい同意の権限で取得を再開 | 同意画面で通知設定権限を外し、読み取りだけで再接続。本人と次回Todoを再取得できた |
| 権限不足 | 不足権限を説明し、業務更新をしない | 読み取り専用の`todo.complete` prepareは`www_authenticate_reauth`と不足する`household.write`を案内。commitせず、次回Todoは未完了のまま |
| 曖昧な対象 | 複数候補を勝手に一つへ絞らない | 「掃除」は14候補で検索完了。dotは種類・名前の違いと曖昧さを示し、変更しなかった |

保存済みの受付記録で照合した識別子と時刻（UTC）は次のとおり。架空の検証用Todoだけの記録であり、OAuthのcode・tokenではない。

| 操作 | operation_id | preparedの時刻 | 成功記録の時刻 | 観測間隔 |
|---|---|---|---|---|
| `todo.create` | `d2d4c2f1-5b9e-4db1-b116-4854ef07183a` | 2026-10-17T23:34:33.053Z | 2026-10-17T23:34:44.880Z | 11.827秒 |
| `todo.complete` | `96557b3b-3c8d-4b8c-84dc-247755c165a3` | 2026-10-17T23:36:30.514Z | 2026-10-17T23:36:41.728Z | 11.214秒 |

今回のTodoは`59e3433e-2ad1-4ede-bcf6-ed1c5fe18ad9`、生成された次回は`a8492e2b-0038-4b0f-b6c2-256c553d66aa`。上の観測間隔はprepareの保存からcommitの成功記録までであり、個別HTTPの往復時間やdotの最終返答までの時間ではない。通知配信の遅延は未測定である。

dotがTool応答から報告した読み取りの`request_id`と`as_of`（UTC）も記録する。prepare/commitの応答にはこの2項目が含まれず、上の保存済みoperation IDで照合した。

| 照会 | request_id | as_of |
|---|---|---|
| 登録後の`entity_get` | `d5a03d21-83db-4a59-b0c0-3aedb2b63753` | 2026-10-17T23:34:51.938Z |
| 完了後の`history_list` | `2c953163-fc61-4613-9ff5-febcee9c0ec9` | 2026-10-17T23:36:51.191Z |
| 完了後の次回`entity_get` | `2ab7a884-e677-4330-b7ca-c14b7387d1d4` | 2026-10-17T23:36:55.952Z |
| 基本スコープ設定後の再認証・`connection_get` | `3a43c11d-6524-48a1-8d06-0040cba532d3` | 2026-10-17T23:58:05.570Z |
| 同じ接続での次回`entity_get` | `1fef2fd6-07d3-4d3a-a84d-2895da374939` | 2026-10-17T23:58:08.231Z |

最後の2照会は、UI送信直前の23:57:41 UTCから最終返答を観測した23:58:58 UTCまで77秒だった。これはポーリングと報告の生成を含む観測間隔であり、個別HTTPの遅延ではない。再認証後も権限は読み取り・変更の2つだけで、次回は未完了・2026-10-25のまま一致した。

配備済みサーバーのSDKは`@modelcontextprotocol/sdk` 1.32.1。実dot側のSDK versionと、実際の要求ヘッダーで使われたprotocol versionは未採取であり、サーバーの対応版から推定しない。#444でE1〜E8の最終記録を揃える際の残項目として扱う。

ChatGPTのカスタムMCP設定では、会話操作用の接続に`household.read`・`household.write`をデフォルトのスコープと「基本スコープ」の両方へ指定する。デフォルトだけを指定した最初の設定では、Toolのscopeタグが採用される再接続時に書き込み権限が要求されず、代わりに通知設定権限が要求された。基本スコープは毎回の認可要求に加わる([公式仕様](https://developers.openai.com/plugins/build/plugins))。読み取りだけで使う場合は書き込みを指定しない。通知設定・Eventsは別の許可であり、今回の検証では追加していない。

パスワードは通常のログイン画面で利用者が入力し、会話やIssueへ貼っていない。これは#439の会話操作の実証であり、#442のEvents・通知到達、#443の通知への返答、#444の全体E1〜E8の完了とは区別する。家庭B・未所属・再送・応答喪失などの自動テストも、実dotで未実施の項目を代替して成功扱いしない。

実装時に参照した公式文書（2026-10-18）: [MCP server](https://developers.openai.com/plugins/build/mcp-server)、[OAuth](https://developers.openai.com/plugins/build/auth)、[接続と検証](https://developers.openai.com/plugins/deploy/connect-chatgpt)、[Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)。
