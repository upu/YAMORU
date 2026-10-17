---
type: Component Map
title: 通知outbox・定期走査
description: 個人の配信試行、lease、走査checkpointと実配信の検証境界
tags: [yamoru, components, notifications, d1]
status: draft
---

# 通知outbox・定期走査

`worker.ts`はOpenNextのfetchを保持し、scheduledから`src/features/integration/notifications/scheduler.ts`をawaitする。Cronはpreview/productionで5分間隔。公開HTTPに管理用のCron endpointを追加しない。

| 変更対象 | 入口 |
|---|---|
| 接続ごとの走査、量の上限、回復 | `notifications/scheduler.ts`、`src/lib/d1/notification-scheduler.ts` |
| 配信の一意性、lease世代、開始前の判定 | `src/lib/d1/notification-outbox.ts` |
| 最新の時刻・設定の可否 | `src/lib/d1/notification-policy.ts`、[個人の通知](notifications.md) |
| 受領・不明結果と履歴の同時保存 | `notification-outbox.ts` → `notification-deliveries.ts` |
| 実ランタイムの検証 | `e2e/notification-scheduler.worker-e2e.ts`、`config/playwright.worker.config.ts` |

家庭共有の日時は変更しない。接続元・本人・家庭・候補を照合し、events.subscribeとhousehold.readを要する。期限切れの送信処理は成功結果を上書きできない。unknownは自動再送せず、失敗の上限も新しい配信IDで回避しない。設定・休止の再評価ではretry_waitのbackoffを短縮しない。

0040と[YDR-059](../decisions/ydr-059-durable-notification-outbox.md)が保存と回復の契約。既存の行とSQLを保持する追加migrationで、接続の物理削除は本人のoutboxと進捗をcascadeする。候補の削除で送信証拠は消さない。

`notification-outbox*.d1-test.ts`は並列・回復・競合・履歴との全取消・更新DB、`notification-scheduler.d1-test.ts`はcheckpoint継続と解除の入口。built WorkerのCronテストはローカルの実ハンドラーを通すが、previewの定期実行や実dotへの到達の証明ではない。

現在は永続走査と送信管理の基盤である。MCP Eventsの公開、購読・callback検証・署名・実送信、定期取得のclaim/ack、実dotの到達は#442で引き続き実装・検証する。未検証の送信経路は有効にしない。

参照: [OpenNext custom worker](https://opennext.js.org/cloudflare/howtos/custom-worker)、[Cloudflare scheduled handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/)、[MCP Events](https://developers.openai.com/plugins/build/mcp-events)（2026-10-18確認）。
