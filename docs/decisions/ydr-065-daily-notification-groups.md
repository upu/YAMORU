---
type: Decision
ydr_id: YDR-065
title: 日次まとめの本文と各候補の配信結果を別々に保持する
description: 一通のまとめを原子的に開始・保存し、再編成でも受領済みと不明結果を再送しない
tags: [yamoru, decisions, notifications, d1]
status: stable
decision_status: Accepted
decision_date: 2026-10-18
supersedes: YDR-063（日次の本文とevent IDの送信単位のみ）
---

# YDR-065: 日次まとめの本文と各候補の配信結果を別々に保持する

[#442](https://github.com/upu/YAMORU/issues/442)の日次まとめでは、購読・世代ごとに一致する候補を一通にまとめる。[YDR-063](ydr-063-notification-recipient-results.md)の候補ごとの宛先結果を正本として使い続け、日次の実送信本文とevent IDだけを新しいgroupへ固定する。個別送信、所有者境界、再試行上限、受領と既読の区別は変更しない。共有Todo・家庭の予定・本人設定も変更しない。

## 本文と結果

groupは一つの購読・世代の不変本文・event ID・元の配信ID集合を持つ。宛先のfilterが違えば別の集合・別のevent IDになる。本文の`data.items`に各`delivery_id`・`candidate_id`・通知時の`source`を含め、元Occurrenceを次回へ読み替えない。既存の候補単位の本文・ID・日時は書き換えずに残す。callbackと鍵は複写しない。

groupの所属履歴と有効な確保は別表にし、一つのrecipientは同時に一つのgroupだけが確保できる。個別の開始APIもこの確保を原子的に照合する。現在の保存APIは一回10候補まで、送信jobも全groupの延べ候補数10までとする。schemaとpayloadの上限50は将来の最適化に備えた保存上限であり、現在のjob量とは区別する。残りを完了扱いにせず、scheduler接続時に続きの確保と呼出枠を検証する。

全件の親lease・revision、家庭・本人設定・休止・候補・認可、購読revision・世代・期限を照合し、同じ試行tokenで全件の開始を一つのD1 batchへ保存する。一度だけ署名付きPOSTを行い、結果も全件とgroupを同じbatchに保存する。HTTPと保存の再試行・二宛先の並列上限は[YDR-064](ydr-064-signed-notification-event-jobs.md)を共用する。group試行の期限は親leaseの最短期限とする。

送信前に一件でも完了・延期・休止・方式変更・購読停止等で送れなくなったら、その不変本文を取りやめ、確保だけを解放する。無効な未送信recipientは終了し、有効な残りは元の回数・初回時刻・backoffを保って別groupへまとめ直せる。所属の物理削除で件数が減った場合も古い本文を送らない。受領済み・unknown・failedの結果を取り消さない。

8回・24時間の上限は各recipientで判定する。同じ送信の一時失敗でも上限に達した候補だけがfailedなら、元groupを取りやめ、残りだけをbackoff以降にまとめ直す。開始後の期限切れは同じtokenのsendingをunknownにし、自動再送しない。本文を後から削って同じevent IDで送ることはない。日次の遅い初回検出を翌日へ送らない[YDR-056](ydr-056-personal-notification-policy.md)の判定も維持する。

## 保存と段階配備

0046はgroup・所属・確保の3表、既存recipientの複合一意索引と新表の索引・triggerを追加する。groupは接続・家庭・本人の複合FK、所属はgroupと既存recipientの両方へ所有者・購読世代を含む複合FKを持つ。本文・ID・元日時・所属identityを変更できない。購読への生存FKを置かず、購読清掃で証拠を消さない。

| 状態 | 読み書きと互換性 |
|---|---|
| d5bbcd4 Worker / 0045 | 既存のOAuth・command・設定・履歴を継続。Events providerは無効 |
| 同Worker / 0046 | 旧SQL・既存行・日時を維持。追加表を無視できる |
| 新Worker / 0046 | group-awareな内部API・jobを追加。個別APIは確保済みrecipientを開始しない |
| contract後 | 旧表も各候補の正本として使い続けるため、置換・drop・contractを予定しない |

旧Workerへ戻しても新しい行を保持し、既存Webは動く。旧Workerは新表の回復・清掃を行わないため、次の対応Workerで再開する。実配信を有効にする前に、group-awareなschedulerの回復・全親leaseの確保・解除後の後処理を配備し、その実装以降をrollback先に限定する。今回の内部API追加では実配信を有効にしない。適用済み0043〜0045は変更しない。

終端本文は90日後に100件ずつ破棄する。accepted/cancelledはgroupごと削除でき、unknown/failedは最小ID・状態・所属を保持する。非終端の本文は消さない。groupの清掃を既存outboxの清掃より先に行う。家庭・本人・接続・groupの物理削除はFKでcascadeし、元outboxの削除では所属と確保をcascadeするが、残る本文の件数は短縮しない。

実D1で更新DB・旧SQL・所有者・不変性・cascade・全取消、filter別の本文、競合、家族の完了、休止、世代変更、再試行上限、結果保存失敗、中断、期限と索引を検証する。架空transportの署名付き受領は実TLSと実dotの到達の証明ではない。scheduler接続、実connector、非対応時の定期取得と実到達・解除・失効の確認が残る間、#442は閉じない。

参照: [Cloudflare D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)、[D1 limits](https://developers.cloudflare.com/d1/platform/limits/)（2026-10-18確認）。
