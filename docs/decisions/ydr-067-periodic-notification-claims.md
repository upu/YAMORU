---
type: Decision
ydr_id: YDR-067
title: 定期取得の候補確保と案内報告を本人・接続・leaseへ束縛する
description: 共通commandの受付と全件の確保・結果保存を同じbatchへまとめ、応答喪失と期限切れを回復する
tags: [yamoru, decisions, notifications, d1, mcp]
status: stable
decision_status: Accepted
decision_date: 2026-10-18
---

# YDR-067: 定期取得の候補確保と案内報告を本人・接続・leaseへ束縛する

[#442](https://github.com/upu/YAMORU/issues/442)で、[会話連携設計7節](../product/conversation-integration.md#7-候補通知設定配信状態)の定期取得を具体化する。[YDR-054](ydr-054-integration-command-receipts.md)・[YDR-059](ydr-059-durable-notification-outbox.md)・[YDR-066](ydr-066-scheduled-event-delivery.md)を置き換えず、共通commandの認可・追加確認・受付記録と既存outboxを使う。

## 操作と認可

`notification.claim`は、取得済みの`candidate_ids`（1〜50件、重複不可）と、各IDをキー・revisionを値とする`candidate_revisions`を受け取る。prepareは差分と操作受付だけを保存し、配信を確保しない。commitで、本人の設定と接続、所属、grant、session、候補と休止状態、過去の配信、既存の確保を再照合する。静かな時間を前倒しせず、他の確保やEventの固定本文を横取りしない。別家庭のIDは存在を区別せず見送る。

結果の`delivery_id`は確保集合のID、`lease_token`・`lease_expires_at`は5分の確保である。`candidates`には各候補のrevision・表示内容と、元のoutboxの`delivery_id`を含める。全件見送りの場合は三つの確保値をnullとし、空の集合と`skipped_reasons`を返す。成功した操作の再送は保存済み結果を返し、新しい確保を作らない。

外部の実行主体はcommitの後で案内し得るため、確保と同時に各親をsendingへ進める。案内直前に最新の詳細を読み直す。確保後の家族の操作による即時停止は保証しない。

`notification.ack`は集合の`delivery_id`・同じ`lease_token`・`outcome(reported/unknown)`を受け取る。集合の全件を一つの結果として扱い、reportedは案内の報告であり、既読・Todo完了を意味しない。一部の案内後に結果が分からなくなった場合もunknownにする。期限内の集合・全親の世代・完全な所属を照合し、全親と配信履歴・最小証拠・操作受付を一つのbatchで更新する。

同じtokenと既知の同じ結果へのackは、lease期限後でも元の結果と日時を返す。別の結果では上書きしない。結果のsnapshotはIDとoutcome・報告日時だけを保持し、親の保持期限による削除後も作り直さない。新しいackも有効な接続と本人の通知設定を必要とする。

両commandのprepare・commit・operation_getは`household.read`と`events.subscribe`を要求する。`notifications.manage`だけでは実行できない。MCPの権限回復案内とSQLの受付確定でも同じ分類を使い、要求内のscopeを採用しない。本人設定の変更commandは従来どおりnotifications.manageを要求する。家庭の予定や在庫、完了履歴は変更しない。共有対象を更新しないこれらの結果へ架空の対象revisionを付けず、候補のrevisionを返す。

## 保存と回復

0047は`notification_poll_claims`と`notification_poll_claim_items`を追加する。headerは本人・家庭・接続・token・期限・元日時・状態・件数・最後のcommandの証跡を持ち、itemは既存outboxへの参照だけを持つ。親子の家庭・本人・接続は複合FKで一致させ、同じ親を複数集合へ所属させない。候補や本文を複製する表は増やさない。全件見送りでも空のheaderを保存し、受付成功を裏付ける。

候補ページには同じ判定frameのstampを使い、各親とEventの固定状況も変更batchで検査する。ackでは所属の件数とID集合、各親のrevision・token・期限を検査する。途中の制約違反や受付確定の失敗では、sourceのtrigger行も含めて全取消する。

期限切れは現在のCronの保守権限でunknownへ進め、自動再送しない。接続やscopeを失っていても権限を偽装せず後処理でき、古いCron tokenでは更新できない。親がなくても未処理headerを走査対象へ残す。一回の接続処理では1集合・最大50親を回収する。旧Workerが先に親を回復した場合も、終端の親や新しい世代を上書きしない。

終端から90日後はheaderを一回100件まで削除し、itemsをcascadeする。親の削除はitemsだけをcascadeし、headerの元の件数を維持する。connection・user・householdの削除は両表をcascadeする。既存outboxと最小証拠の保持・重複抑止を変えない。

## 配備

| 状態 | 互換性 |
|---|---|
| 6cb46cf Worker / 0046 | 既存Web・会話操作・内部送信jobを継続 |
| 6cb46cf Worker / 0047追加後 | 新表を使わず、既存のID・日時・SQLを保持 |
| 新Worker / 0047 | claim/ackとheader回収を追加。旧Workerへ戻しても行・受付を保持 |
| contract後 | 置換・rename・dropがなくcontractは不要 |

旧Workerへ戻す間は新commandを処理できないが、sendingの親は既存の期限切れ回復でunknownになり、再送されない。新Workerへ戻した後にheaderも回復する。遠隔D1は通常のmain CIとpreview自動配備で更新し、適用済みmigrationを変更しない。

この実装だけでは15分の実行主体や実dotの通知到達は用意できない。実行周期と遅延、Eventsの実TLS・到達・解除・失効の証拠が揃うまで#442を閉じず、通知完成や即時到達を保証しない。
