---
type: Component Map
title: 認証付きMCP入口の修正箇所マップ
description: 共通ユースケースをMCPへ公開するHTTP境界、入力schema、権限、再接続、検証の入口
tags: [yamoru, components, integration, mcp, oauth]
status: stable
---

# 認証付きMCP入口

## 責務と入口

`src/app/mcp/route.ts` → `src/features/integration/mcp/http.ts`は、既存OAuthのresource `/mcp`へStreamable HTTPを接続する。認証・業務判定は[外部連携](integration.md)、読み取りは[会話読み取り](conversation-read.md)へ委譲する。SQLや日付計算をMCPへ複製しない。

| 変更したいこと | 入口 |
|---|---|
| HTTP、Origin、本文上限、OAuth challenge | `mcp/http.ts`、環境取得は`runtime.ts` |
| Tool名・説明・副作用、公開入力 | `catalog.ts`、`command-schemas.ts` |
| 公開出力の形、SDK登録と一覧 | `output-schemas.ts`、`server.ts` |
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

公式`@modelcontextprotocol/sdk` 1.32.1、Zod 4.6.7、Cloudflare向け`@cfworker/json-schema` 4.1.1を使う。Workerで動的コード生成をしないvalidatorを指定する。公式SDKの対応版は`2025-11-25`以前であり、ここで通し確認した版は`2025-11-25`。MCP Events 2.0 (`2026-07-28`)への対応をSDK採用から推定しない。Events・通知配信はまだcapabilitiesでfalseを返し、#442で実装・実証する。

`YAMORU_OAUTH_ALLOWED_CLIENT_IDS`が既定で空のため、MCPも既定で無効。設定は[Cloudflare運用手順](../references/cloudflare-production-operations.md)に従う。ブラウザーclientのOriginは同一originだけを既定で許可し、Inspector等は`YAMORU_MCP_ALLOWED_ORIGINS`へ完全なoriginを空白/カンマ区切りで設定する。パス・認証情報付きURLは採用しない。Originを送らないサーバー間clientもBearer認証を要する。

回数制限と同時commit枠は[YDR-058](../decisions/ydr-058-mcp-request-budgets.md)とmigration `0039`で追加する。利用者の固定1分窓を全接続で共有し、read 60回・prepare/commit各20回、接続別の有効commit leaseは2件まで。429とRetry-Afterを返し、leaseを業務batch内のDB時刻でfenceする。期限切れのWorkerは書き込めず、古いreleaseは新しい枠へ作用しない。

0039は追加表だけで、新しい秘密・contract migrationはない。旧Worker/追加schemaと新Worker/追加schemaの両方で既存操作を保持する。Workerを戻しても共通の操作receiptは保持され、MCP入口だけが利用不可になる。previewはmainのCI成功後に通常の自動配備で検証し、ローカルからの手動配備を常用しない。

## 検証と未完了の境界

`tests/integration-mcp-http.test.ts`は設定前・Cookie/query非採用・Origin・切断済み要求、`integration-mcp.d1-test.ts`はOAuth、schema、家庭境界、登録/完了/在庫、再送・切断後照合・再接続・失効・本文上限を実D1で確認する。

`integration-mcp-limits.d1-test.ts`は並列の回数・同時commit枠と期限切れのfence、`integration-mcp-limits-migration.d1-test.ts`は更新DB・旧SQL・制約・cascadeの検証入口。全migrationを当てるD1テストと生成schema確認は空DBの検証も兼ねる。

`e2e/mcp-integration.spec.ts`はローカル専用の架空clientで、ブラウザーのOAuth同意、実token endpoint、公式SDKの登録→取得→完了→次回確認、revocationを通す。通常のNext開発serverと、ビルド済みWorkerを対象に同じテストを使う。e2e envの架空clientはpreview/productionへ設定しない。

```sh
npm test -- tests/integration-mcp-http.test.ts tests/auth-boundary.test.ts
npm run test:d1 -- src/lib/d1/integration-mcp.d1-test.ts
npm run test:e2e:local
npm run test:e2e:worker
```

実dotの発見・接続・読み取り→登録→取得→完了→次回確認・再接続は、preview配備後に別途実証する。このテスト用clientの成功で代用せず、#439は実dotの証拠が揃うまで閉じない。

実装時に参照した公式文書（2026-10-18）: [MCP server](https://developers.openai.com/plugins/build/mcp-server)、[OAuth](https://developers.openai.com/plugins/build/auth)、[接続と検証](https://developers.openai.com/plugins/deploy/connect-chatgpt)、[Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)。
