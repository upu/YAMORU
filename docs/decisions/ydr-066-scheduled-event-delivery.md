---
type: Decision
ydr_id: YDR-066
title: 通知の送信開始を接続ごとの定期実行の確保へ結び付ける
description: 全親の一括確保と共通判定snapshotで、定期送信・権限縮小後の回収・D1呼出量を両立する
tags: [yamoru, decisions, notifications, d1]
status: stable
decision_status: Accepted
decision_date: 2026-10-18
---

# YDR-066: 通知の送信開始を接続ごとの定期実行の確保へ結び付ける

[#442](https://github.com/upu/YAMORU/issues/442)で[YDR-059](ydr-059-durable-notification-outbox.md)・[YDR-063](ydr-063-notification-recipient-results.md)・[YDR-064](ydr-064-signed-notification-event-jobs.md)・[YDR-065](ydr-065-daily-notification-groups.md)の定期実行への接続を具体化する。家庭の予定、本人の設定、元対象、受領と既読の区別は変更しない。

## 定期実行と確保

既定の一回2接続・各25候補の走査と、接続ごとの2分のCron leaseを維持する。送信providerを内部へ渡した場合だけ、保存済みoutboxから送信jobへ進む。Worker runtimeへ未検証のproviderは設定しない。

日次まとめの再試行を新しい仕事より先に探し、含まれる全親を一つのbatchで5分間確保する。一部の親を別処理が確保中なら、残りだけを確保しない。未処理groupが確保している親を新しい仕事にも使わず、部分確保の繰り返しによる停滞を避ける。古い本文・event IDを保ち、同じ宛先の受領済み・unknownを送り直さない。

新しい仕事は最大10親、送信と宛先の後処理は接続ごとに同じ延べ10候補・宛先の枠を使う。個別方式では未送信の宛先だけを選び、日次方式ではfilterに一致した集合を一通にする。日次の作成候補が空振りした場合、同じ回で全購読を試さず、宛先の照合を上限内で進める。処理しなかった宛先を保持し、親の確保を解放して次回へ継続する。購読がまだなければ同じ配信IDで待ち、配信済みとは記録しない。静かな時間や再試行のbackoffも短縮しない。

親の確保・固定・送信直前の開始batchでは、現在のCron token・本人・家庭・接続・DB時刻を照合する。その時点で置換・期限切れならHTTPへ進まず、開始後の取消による即時停止までは保証しない。接続内の送信は全体の90秒の中断signalを共有し、既存jobの二宛先の並列上限と保存だけの再試行を使う。結果保存は開始済みの親lease・試行tokenを照合し、Cronの期限を過ぎても親の期限内なら受領結果を残せる。Cron・job・親の確保時間は処理完了や到達時間の保証ではない。

## 回収と権限縮小

期限切れのgroupを先にunknownへ回復してから、各親を既存の集計規則で回復する。受領済み結果をunknownへ落とさず、未送信だけを回収する。完了等で解消した親や所属が欠けたgroupは、古い本文を取りやめて確保を解放する。

解除・失効・scope縮小・client停止では、現在のCron leaseを使う保守専用の経路で未送信groupを取りやめ、その後で既存の親の後処理を行う。外部principalへ失ったscopeを付け直さない。送信中でまだ期限内のgroupは結果保存を妨げず、期限切れを待って回復する。outboxがなくても未処理groupが残る接続は走査の対象に残し、回収後に終了する。

## 判定のsnapshotと呼出量

同じ本人設定・接続・所属・sessionを候補ごとに読み直す方式は、二つの家庭・各10候補・20購読の試験で一回1,580回のD1呼び出しになった。家庭数や候補数の既定値を減らさず、共通情報を一つのSQLで読む判定frameを導入する。frameは処理内の短い段階だけで使い、globalなcacheや永続データを追加しない。

各候補の休止・最新実体・元candidate revision・過去の配信は、最大50 IDの現在値をまとめて読む。固定・開始の各段階では新しいframeを取り、候補stampの家庭epoch/version・設定revisionをそのframeへ束縛する。後から新しく読んだcandidate stampで古い設定を有効にしない。候補の解消で先頭の候補が選択から外れても、残りの候補には共通frameのguardを使う。接続の現在の有効性・scope・sessionは変更batchでも検証する。

候補ページのenqueueは元の一意制約と`ON CONFLICT`を保った一括batchにし、途中失敗ではsourceのtrigger行も全取消する。単一候補APIの戻り値とnullの意味は維持する。pendingの再照合はまとめて評価してから各行のrevisionを照合し、失敗した行の扱いも従来どおりにする。二つの家庭・各25候補・20購読の継続試験では、毎回のD1 binding呼出数を1,000未満にする。これはローカルの量の検証であり、実環境の到達や課金量の証明ではない。

方式変更後の全宛先の照合では2,832回、全購読失効後の空振りと照合では4,092回になったため、通常送信と同じ件数枠を後処理にも適用する。20購読の方式変更・失効で未処理を次回へ残すこと、古い方式と現在方式で枠を共有すること、二家庭の失効処理でも呼出枠内に収まることを確認する。

## 保存と配備

schemaは0046のままで新migrationを追加しない。既存のID・元日時・結果・所属を保持し、通常の状態遷移以外のデータ変換や削除をしない。

| 状態 | 読み書きと互換性 |
|---|---|
| a10cf6a Worker / 0046 | 既存のWeb・OAuth・内部group API。runtime providerは無効 |
| 同Worker / 同schema | schema変更がなく従来どおり |
| 新Worker / 0046 | 注入時の定期送信・group回収・最新Cronによる開始の照合を追加。runtime provider未設定では送らない |
| contract後 | 置換・rename・dropを伴わずcontractは不要 |

runtimeが無効な間はa10cf6aへ戻しても行と既存Webを保持する。実配信を有効にする前に、本判断のgroup-awareな回収以降をrollback先とし、検証済みconnectorと購読の実証を揃える。遠隔D1を手動変更せず、通常のmain CI・preview自動配備で確認する。TLS、定期取得、実dotの到達・解除・失効が未確認のまま#442を閉じない。

参照: [Cloudflare D1 limits](https://developers.cloudflare.com/d1/platform/limits/)、[D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)（2026-10-18確認）。
