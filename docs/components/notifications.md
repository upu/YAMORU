---
type: Component Map
title: 個人の通知設定・配信履歴
description: 通知先、時間帯、休止と配信判定、履歴の本人境界と後続配信処理の入口
tags: [yamoru, notifications, integration]
status: stable
---

# 個人の通知設定・配信履歴

## 入口

- Web: `src/app/settings/notifications/`。アカウント→外部サービスとの連携→定期的なお知らせを設定する。
- 保存: `src/lib/d1/notification-settings.ts`。セッションの家庭・本人だけを扱い、古いsettings revisionを拒否する。共有予定は変更しない。
- 時刻: `src/features/integration/notifications/schedule.ts`。日次まとめ/候補ごと、静かな時間、DSTを純粋計算する。
- 読み取り: `createNotificationReader`の`notificationSettingsGet` / `deliveryList`。検証済みPrincipalを返すauthorizeを注入する。`household.read`と`notifications.manage`、現接続のscope・所属・失効を前後で確認する。cursorは本人・家庭・client・接続・limitへ署名で束縛する。
- 会話変更: 既存`createCommandService`に`notification.configure` / `notification.snooze`を登録する。`household.write`ではなく`notifications.manage`と`household.read`を要求する。結果照合・再送は既存の操作receiptを使う。
- 配信判定: `src/lib/d1/notification-policy.ts`の`evaluateNotification`。最新の対象・設定・scope・接続・重複抑止を読み、ready/deferred/cancelled/suppressedと理由・nextAtを返す。
- 履歴: `src/lib/d1/notification-deliveries.ts`。受領/案内報告/不明と見送り理由を保存。既読は持たない。詳細は90日、最小重複抑止は候補区間の間保持する。

## Commandの入力

`notification.configure`のpayloadは`settings_revision`が必須。変更する`enabled, connection_id, time_zone, mode(daily/individual), digest_time, quiet_hours{enabled,start,end}, repeat_policy{high_hours,normal_hours}, muted`を渡す。再通知間隔はnullで無効、整数24〜720時間で有効。未指定の項目は現設定を保持する。targetは省略でき、指定する場合は`{kind: notification_settings, id: 本人ID}`。

`notification.snooze`は`candidate_id, candidate_revision, until`が必須。untilは時差付きの未来日時、nullで解除。任意の`muted`で候補単位の休止を指定できる。候補revisionはattention_getが返した値をそのまま渡す。targetは省略、または同じ候補を指す`{kind: attention_candidate, id}`。共有の延期操作とは別である。

prepareでは書き込まず本人への差分を示し、commit時に設定・候補・休止のrevisionを再確認する。変更SQLとreceiptは同じD1 batchであり、直前の競合でも両方を取り消す。時刻previewはprepareの基準時刻へ固定し、実際の配信可否は送信時に読み直す。

会話APIの設定・preview・結果・履歴は`notifications/wire.ts`でsnake_caseへ変換する。設定は入力と同じquiet_hours/repeat_policyの構造、休止はuntil、履歴はdelivery_id/candidate_id/candidate_name/connection_id/outcome/reason/recorded_atを返す。候補の元データをライブで投影し、キャッシュのpayloadと異なる場合も古いcandidate_revisionとして拒否する。

成功結果のrevisionは受付記録のbatch内で読み取って保存する。設定はsettings取得と同じ整数、候補はattention_getと同じ`[1,id,candidateRevision]`のJSON文字列とし、続く操作へそのまま渡せる。後から別の設定変更をしても、再送は最初に保存した結果を返す。

## 定期取得による通知と稼働確認

v0.21.0は[YDR-070](../decisions/ydr-070-free-polling-first.md)に従い、外部の定期取得を使う。会話での確認・操作から、任意の定期的なお知らせの導入を分ける。`delivery-status.tsx`は本人の保存済み状態（ON・OFF・休止・接続確認）と次の操作を短く表示し、準備手順はガイドへ集約する。未設定の詳細フォームは折りたたみ、受け取り可能な接続がなければ新規ONの操作は出さない。保存済みONの設定は接続が失効してもOFFへ戻せる。外部タスクの有効状態・次回予定・実行結果はYAMORUから確認できず、保存だけで外部タスクを作成したとは表示しない。時刻の目安は取得可能な最短時刻として示し、タスクの実行予定・到達時刻とは扱わない。導入は`/settings/integrations/guide#periodic-title`、復旧は`/settings/integrations/guide#recovery-title`へ案内する。

#442の永続outbox・lease・走査と定期取得の入口は[通知outbox・定期走査](notification-outbox.md)。実dotの定期起動・案内・重複抑止・停止を#442で、返答を#443で確認した。Eventsの実送信・購読は後続#474であり、利用可能とは表示しない。実接続と模擬試験の境界は[検証表](../references/conversation-integration-checks.md)を参照する。

- `evaluateNotification`は配信権の確保ではない。同じ本人・接続・候補・通知回をoutboxの一意制約とleaseで確保し、送信直前にも再判定する。
- `deferred`は同じ配信IDを保ってpendingへ戻し、leaseを解放してnextAtを保存する。通知回数は増やさない。settings/control更新時に既存outboxの次回時刻を再計算する連携を#442で追加する。今の判定はキャッシュを使わず変更を即時に反映する。
- `cancelled`/`suppressed`は試行を終了する。再有効化では未案内候補の新しい試行を作る。accepted/reportedは同じ配信の一回、unknownは自動再送しない。candidate revisionだけの変更は重複抑止を解除しない。
- 配信runtimeは`deliveryRecordStatements`をoutboxの結果更新と同じbatchへ組み込む。先にlease世代・配信ID・候補・本人・接続・許される状態遷移を検証する。外部のack入力をこの関数へ直接渡さない。候補消滅と送信結果の競合に備え、確保時の候補名をruntime側に保持して結果を記録する。
- 同じdelivery IDに複数候補を含められる。一意キーはdelivery IDとcandidate IDの組である。受領から案内報告へ進めても回数を増やさず、最初の受領時刻を保つ。unknownの解除には接続先との明示的な照合を別途実装する。
- `pruneDeliveryHistory`を定期保守から呼ぶ。一回100件で詳細を削除する。候補が存続する間はmarksを削除しない。実際の到達・遅延・lease回収は#442/#444で確認する。

## 不変条件と検証

根拠は[YDR-050](../decisions/ydr-050-conversation-reminders.md)と[YDR-056](../decisions/ydr-056-personal-notification-policy.md)。0035・0036は追加だけで既存の列・時刻を変えない。0036は候補の初回検出時刻を保持し、内容更新で日次まとめを翌日に動かさない。Todoは候補になる日付、在庫は初回検出時刻を初回配信の起点にする。fixtureは家庭/利用者/接続のcascadeで掃除するため旧migrationでも使える。

`tests/notification-*.test.*`は既定値・DST・表示、`src/lib/d1/notification-*.d1-test.ts`は本人境界・古いrevision・再送・解除・重複抑止・更新DB、`e2e/notification-settings.spec.ts`は保存・休止/解除・共有期限不変を検証する。自動テストは実dotへの通知到達の証拠ではない。
