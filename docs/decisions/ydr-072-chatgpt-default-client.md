---
type: Decision
ydr_id: YDR-072
title: ChatGPTを標準許可し、環境変数を追加許可に使う
description: OAuthと通知走査で同じ標準許可を使い、CIMD検証と本人同意を維持する
tags: [yamoru, decisions, integration, oauth]
status: stable
decision_status: Accepted
decision_date: 2026-10-19
partially_supersedes:
  - ydr_id: YDR-052
    scope: 決定5の環境変数だけによる許可一覧と決定6の未設定時の受付無効、および末尾の有効化条件
---

# YDR-072: ChatGPTを標準許可し、環境変数を追加許可に使う

## 背景

previewでChatGPTのCIMDを使う実接続を確認した([MCP Component](../components/mcp.md))。運用者による環境変数の設定を省き、preview・productionで同じ既定値を使う。関連: [#484](https://github.com/upu/YAMORU/issues/484)。

適用済みmigration `0031_oauth_connections.sql`は変更しない。同ファイルの受付無効のコメントは導入当時の説明であり、現在の受付条件は本YDRと`src/features/integration/oauth/config.ts`に従う。

## 決定

1. `https://chatgpt.com/oauth/client.json`だけを標準許可する。`YAMORU_OAUTH_ALLOWED_CLIENT_IDS`は追加許可の一覧とし、未設定・空でもChatGPTを許可する。標準許可と追加許可の和集合を使い、重複を取り除く。OAuthの要求処理とWorkerの通知スケジューラは同じ関数で一覧を解決する。
2. 許可はCIMDの取得を認める条件であり、接続の同意やデータアクセス権の付与ではない。CIMDの取得・検証・有効期限付きの写し、SSRF対策、PKCE、redirect_uri、本人同意、scope、issuer/resource、家庭境界を維持する。ChatGPTも有効な写しがなくCIMDを取得・検証できなければ新たな接続を成立させない。
3. 適切な公開HTTPS originでOAuth/MCPの入口を有効にする。ローカル用loopback HTTPの例外と、それ以外のHTTPの拒否は維持する。
4. 変数の削除ではChatGPTを停止できない。個々の委任を止めるには本人が接続管理で解除する。ChatGPTの新規受付自体を止める必要がある場合は標準許可を外すコード変更をレビュー・配備する。本Issueでは新しい管理画面や停止スイッチを作らない。追加クライアントは変数から除外できる。

## 検証と影響

設定なし・空・追加・重複・HTTP origin制限を単体テストで確認し、CIMDの検証と拒否、ChatGPT接続の通知走査をD1テストで確認する。実production配備・環境変数変更・実家庭データでの確認はこの変更に含めない。

標準許可を増やす場合や運用上の全体停止が必要になった場合は、別の意思決定で受付範囲と操作方法を定める。
