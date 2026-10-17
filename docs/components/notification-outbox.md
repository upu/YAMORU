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
| 元のOccurrence・消耗品の保持と保存期限 | migration `0042`、`src/lib/d1/notification-outbox-retention.ts` |
| 最新の時刻・設定の可否 | `src/lib/d1/notification-policy.ts`、[個人の通知](notifications.md) |
| 受領・不明結果と履歴の同時保存 | `notification-outbox.ts` → `notification-deliveries.ts` |
| 購読の本人境界・暗号化・解除競合 | `notifications/event-subscriptions.ts`、`src/lib/d1/notification-event-subscriptions.ts` |
| callbackの宛先制限・署名 | `notifications/webhook-transport.ts`、`event-crypto.ts` |
| 実ランタイムの検証 | `e2e/notification-scheduler.worker-e2e.ts`、`config/playwright.worker.config.ts` |

家庭共有の日時は変更しない。接続元・本人・家庭・候補を照合し、events.subscribeとhousehold.readを要する。期限切れの送信処理は成功結果を上書きできない。unknownは自動再送せず、失敗の上限も新しい配信IDで回避しない。設定・休止の再評価ではretry_waitのbackoffを短縮しない。

走査対象は現在有効で選択中の接続、または未送信・lease中の後処理が残る接続だけとする。停止済みで空のprogressは一回100件ずつ削除し、削除待ちでも走査枠を確保しない。解除・期限切れ・scope縮小・接続先変更・通知停止後は、未処理分を回収してから終了する。scope縮小後の後処理は本人を偽装せず、現在のCron leaseとDB時刻を各batchで照合する専用経路を使う。通常の送信APIのscope制約は維持する。

0040と[YDR-059](../decisions/ydr-059-durable-notification-outbox.md)が保存と回復の契約。既存の行とSQLを保持する追加migrationで、接続の物理削除は本人のoutboxと進捗をcascadeする。候補の削除で送信証拠は消さない。

`notification-outbox*.d1-test.ts`は並列・回復・競合・履歴との全取消・更新DB、`notification-scheduler.d1-test.ts`はcheckpoint継続と解除の入口。built WorkerのCronテストはローカルの実ハンドラーを通すが、previewの定期実行や実dotへの到達の証明ではない。

0041は本人・家庭・接続の複合FKを持つ購読表だけを追加する。callback URLと署名鍵を所有者・client・購読IDに結び付けて暗号化し、解除・失効時には暗号文を消す。更新はrevisionで照合し、確認中の解除や遅い鍵更新で復活・上書きしない。詳細は[YDR-060](../decisions/ydr-060-event-subscription-boundary.md)。

`notification-event-subscriptions*.d1-test.ts`は認可・上限・TTL・解除競合・鍵更新・中断・更新DBの互換性、`notification-event-crypto.test.ts`は別所有者への暗号文移動と署名移行、`notification-webhook-transport.test.ts`はDNS再検証・private混在・redirect拒否を確認する。

0042と[YDR-061](../decisions/ydr-061-notification-source-and-retention.md)は通知時の元entity IDとTodo rule IDを候補から独立して保持する。候補の解消・元実体の削除後も次回へ読み替えず、既に候補が消えた過去行は推測でbackfillしない。詳細とsourceは終端から90日後に順次削除するが、unknown/failedのID・状態・試行数は保持して自動再送を防ぐ。pendingなど非終端の記録は削除しない。`notification-outbox-context*.d1-test.ts`が元の回・消耗品・旧SQL・全取消・cascade・期限と100件の上限の入口。

現在は永続走査、送信管理と購読の基盤である。2026版のevents/list・subscribe・unsubscribeは明示的な送信providerの注入時だけ公開する。runtimeはproviderを設定しておらず、外部向けEventsは無効である。`createPinnedWebhookTransport`はDNS resolverと接続先IP・元hostのTLSを維持するconnectorを必須にし、通常のfetchで代用しない。テストの架空providerは実環境の証拠ではない。

複数購読先への実送信と結果の永続化、定期取得のclaim/ack、実dotの到達は#442で引き続き実装・検証する。未検証の送信経路は有効にしない。イベントにreplay cursorはなく、差分取得のcursorとは区別する。

参照: [OpenNext custom worker](https://opennext.js.org/cloudflare/howtos/custom-worker)、[Cloudflare scheduled handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/)、[MCP Events](https://developers.openai.com/plugins/build/mcp-events)（2026-10-18確認）。
