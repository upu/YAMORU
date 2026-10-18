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
| 複数宛先の固定、結果・再試行・中断の分離 | `notification-event-dispatch.ts`、`notification-recipient-state.ts` |
| 固定した本文の署名付きPOSTとjob内の並列処理 | `notifications/event-delivery.ts`、`event-job.ts` |
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

URLのoriginも暗号文の中だけに置く。適用済みschemaのcallback_origin列は空文字で保持し、過去の非空値は保守で一回100件ずつ消す。ID・暗号文・日時は変更しない。この列は以後も空のまま残し、削除するcontract migrationは予定しない。originを書いていた実装はremoteへ配備しておらず、現行Workerへのrollbackで平文originが復活する経路はない。

暗号化鍵の更新等で旧暗号文を読めない購読は、旧署名鍵の再利用と検証cacheを止め、再検証したURL・署名鍵を現行の鍵で保存し直す。解除済み・期限切れの購読も、別購読の同URL cacheだけで復活させない。現行の暗号化鍵自体が利用不能なら保存を拒否する。

`notification-event-subscriptions*.d1-test.ts`は認可・上限・TTL・解除競合・鍵更新・中断・更新DBの互換性、`notification-event-crypto.test.ts`は別所有者への暗号文移動と署名移行、`notification-webhook-transport.test.ts`はDNS再検証・private混在・redirect拒否を確認する。

0042と[YDR-061](../decisions/ydr-061-notification-source-and-retention.md)は通知時の元entity IDとTodo rule IDを候補から独立して保持する。候補の解消・元実体の削除後も次回へ読み替えず、既に候補が消えた過去行は推測でbackfillしない。詳細とsourceは終端から90日後に順次削除するが、unknown/failedのID・状態・試行数は保持して自動再送を防ぐ。pendingなど非終端の記録は削除しない。`notification-outbox-context*.d1-test.ts`が元の回・消耗品・旧SQL・全取消・cascade・期限と100件の上限の入口。

現在は永続走査、送信管理と購読の基盤である。2026版のevents/list・subscribe・unsubscribeは明示的な送信providerの注入時だけ公開する。runtimeはproviderを設定しておらず、外部向けEventsは無効である。`createPinnedWebhookTransport`はDNS resolverと接続先IP・元hostのTLSを維持するconnectorを必須にし、通常のfetchで代用しない。テストの架空providerは実環境の証拠ではない。

0043と[YDR-063](../decisions/ydr-063-notification-recipient-results.md)は一致した全宛先の集合・安定event ID・本文と、宛先ごとの試行結果を保存する。受領済み・unknownを再送せず、他の未送信宛先だけを続行する。解除・失効を越えた購読世代には古い通知を送らず、有効期間中の鍵更新は継続できる。親leaseとrevisionは各宛先のbatchでも照合する。購読の削除では証拠を消さず、親配信の物理削除はcascadeする。終端から90日後は本文を100件ずつ消し、unknown/failedの最小結果を保持する。`notification-event-dispatch.d1-test.ts`・`notification-event-lifecycle.d1-test.ts`・`notification-event-recipients-migration.d1-test.ts`が複数宛先の回復、境界、更新DBの入口。

実ランタイムへの送信provider設定、定期取得の実行主体との接続、実dotの到達は#442で引き続き実装・検証する。未検証の送信経路は有効にしない。イベントにreplay cursorはなく、差分取得のcursorとは区別する。

[YDR-068](../decisions/ydr-068-pinned-tls-engine.md)の`packages/pinned-tls/`は、検査済みIPに対して元hostnameの証明書とSNIを使うTLS部品である。[実験](../spikes/pinned-tls.md)は実Cloudflareで正例・証明書負例を確認しているが、HTTP connector/runtimeへの接続や実dotへの到達の証拠ではない。

0044はbatchの終端時刻を旧SQLにも対応するtriggerで同期し、本文が残る終端記録だけの期限索引で100件ずつ清掃する。本文破棄後のunknown/failed証拠は以後の対象検索から外れる。`notification-event-body-retention-migration.d1-test.ts`と配信テストのquery plan検査で、時刻保持・旧更新・全取消・索引利用を確認する。

[YDR-064](../decisions/ydr-064-signed-notification-event-jobs.md)の送信jobは宛先の開始→署名付きPOST一回→同じtokenで結果保存をつなぐ。HTTPは二宛先まで並行、DB遷移はjob内で直列化し、保存失敗でPOSTを繰り返さない。通知方式も本文に固定し、変更後に古い方式の本文を送らない。旧形式の方式省略は個別を意味する。`notification-event-delivery.test.ts`は署名・応答分類、`notification-event-job.d1-test.ts`は実D1と架空transportの統合の入口。内部provider注入時のscheduler接続はYDR-066で追加し、runtimeのproviderは引き続き無効である。

参照: [OpenNext custom worker](https://opennext.js.org/cloudflare/howtos/custom-worker)、[Cloudflare scheduled handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/)、[MCP Events](https://developers.openai.com/plugins/build/mcp-events)（2026-10-18確認）。

0046と[YDR-065](../decisions/ydr-065-daily-notification-groups.md)は日次の固定本文・所属履歴・有効な確保を追加する。各候補の結果と上限は既存recipientを使い、一通の全件を同じtokenで原子的に開始・保存する。古い本文を削って再利用せず、未送信だけを再編成する。`notification-event-groups.d1-test.ts`がfilter・競合・家族の完了・休止・方式変更・上限・中断・保存失敗・保持期限、`notification-event-groups-migration.d1-test.ts`が更新DB・旧SQL・複合FK・cascadeの入口。内部jobでは同じ署名付きPOST経路を使い、保存失敗ではHTTPを再送しない。現在のAPIは10候補、一jobは全宛先の延べ10候補までとし、schema/payloadの保存上限50と区別する。全親leaseの再取得と後処理を行う定期送信はYDR-066で追加する。実TLS/到達は未検証で、runtime providerは無効のままである。

[YDR-066](../decisions/ydr-066-scheduled-event-delivery.md)の内部provider注入時は、`notifications/event-scheduler.ts`から日次・個別jobへ進む。`notification-event-work.ts`が再試行groupを優先して全親を一括確保し、開始batchでも現在のCronを照合する。scopeを失った後の回収はCronの保守権限で行い、未処理groupも走査の対象に残す。`notification-policy.ts`の処理内frameとページ評価で重複読取りを減らし、各候補stampは同じ家庭・設定revisionへ束縛する。`notification-event-scheduler.d1-test.ts`が実D1と架空HTTPの定期送信・競合・回復・二家庭の呼出枠、`notification-policy-frame.d1-test.ts`が設定変更・先頭候補解消・scope/session変更・所有者・全取消の入口。Workerへproviderを設定していないため、これらは実dotの通知到達を証明しない。

0047と[YDR-067](../decisions/ydr-067-periodic-notification-claims.md)の`notification.claim`・`notification.ack`は、`commands/notification-poll.ts`から`notification-poll.ts`・`notification-poll-statements.ts`へ進む。readとevents.subscribeを要求し、prepareでは確保せず、commitで最大50候補を5分間確保する。既存outboxを使い、Eventの固定本文を持つ親を横取りしない。ackは集合のIDとtoken・全親の世代を照合し、案内の報告と既読を区別する。`notification-poll-recovery.ts`は現在のCronで期限切れをunknownへ回復し、親がないheaderも走査に残す。`notification-poll-commands.d1-test.ts`が50件・権限・同じack・全取消・競合・回復・保持期限、`notification-poll-migration.d1-test.ts`が更新DB・旧SQL・複合FK・cascade、`integration-mcp.d1-test.ts`がwire schemaと権限回復案内の入口。15分の実行主体と実測遅延は未実証で、claim/ackだけをもって通知完成とはしない。
