---
type: Decision
ydr_id: YDR-071
title: 通知への返答を保存済みの元対象へ結び付ける
description: 通知の照合と参照付きcommandで次回への付け替えを防ぎ、旧Workerへのrollbackでは参照付きpreviewを拒否する
tags: [yamoru, decisions, notifications, integration, d1]
status: stable
decision_status: Accepted
decision_date: 2026-10-18
---

# YDR-071: 通知への返答を保存済みの元対象へ結び付ける

[#443](https://github.com/upu/YAMORU/issues/443)で[YDR-049](ydr-049-conversation-command-boundary.md)・[YDR-050](ydr-050-conversation-reminders.md)・[YDR-061](ydr-061-notification-source-and-retention.md)の返答契約を具体化する。これらの判断は置き換えない。[YDR-070](ydr-070-free-polling-first.md)に従い、今回の実接続経路は定期取得とする。

## 読み取りと選択

`notification_context_get`は`delivery_id`と任意の`candidate_id`を受け、本人・家庭・接続・clientの有効性と`household.read notifications.manage`を確認する。定期取得の集合IDと、各候補の親配信IDを扱う。lease tokenやcallbackの秘密は返さない。

既存のoutbox sourceに保存した元のOccurrence/消耗品を現在の家庭データと照合する。候補が消えても元の回を取得し、同じruleの次回や似た名前へ置き換えない。期限は終端から90日で、清掃が遅れて行が残っていても期限切れとして扱う。元対象の削除・source不明・期限切れは`selected=null`と選び直しを案内する。別所有者のIDや解除済み接続は存在を明かさず拒否する。

集合に複数件ある場合は`selection_required`と候補を返し、自動で一つに絞らない。途中で一部の親が消えても元の件数を保持し、残った一件を勝手に選ばない。候補の全件が失効した場合は空の選択を求めず、現在対象の選び直しへ戻す。選択した後は、その対象の現在状態・revision・日付・詳細リンクを共通読み取りから返す。

## 参照付きの変更

通知への返答では、既存`command_prepare`へ`notification_reference: {delivery_id,candidate_id}`を添える。自然言語の解釈は接続先が担当し、YAMORUは構造化された操作を検証する。

| 返答 | 既存commandと保存する事実 |
|---|---|
| やった / 昨日済ませた | `todo.complete`。元の回だけを完了し、実施日と記録日、次回予定、取消可否を返す |
| 日付や実施者を訂正 / 完了を取り消す | `history_list`等で元の完了記録を特定し、`todo.correct` / `todo.undo`。完了記録が通知の元Occurrenceに属することも検査する |
| 明日教えて | `notification.snooze`。本人の通知制御だけを変更し、共有期限・他人の設定を変更しない |
| 予定を来週へ | `todo.reschedule`。元の回の現在期限を延期し、本来の予定日・必達日や次回へ暗黙に作用しない |
| 少ない / 買い足した / 記録を訂正 | 元の消耗品への`stock.observe` / `stock.refill` / `stock.correct`。観測と補充を分離する |

通知の選択には通知設定権限を要するが、家庭変更の権限は別である。スヌーズだけなら`household.write`を要求せず、完了・予定変更・在庫記録には従来どおり要求する。通知設定がOFFでも、有効な接続と必要な権限のもとで過去の通知に返答できる。通知停止を接続解除として扱わない。

prepare、commitの再計画、業務とreceiptを保存する同じD1 batchで参照と元対象を検査する。sourceの消失・保持期限・scope縮小がbatch直前に起きても、完了や次回、成功receiptの一部を残さない。家族が完了済みなら現在状態を返し、二重完了や次回への付け替えをしない。応答喪失時は同じ操作IDの保存結果を照合し、勝手に別IDで再実行しない。

参照はnormalized command・request hash・fingerprintに含め、同じIDで別参照への変更を拒否する。previewの`schedule_effect.notification_reference`にも固定するが、参照IDだけの違いを意味のある業務差分として追加確認を発生させない。YDR-062の確認方針を維持する。本人・接続・現在の通知権限は成功済み結果の再取得にも確認する。

## 保存と配備の互換性

既存のsource・outbox・定期取得集合と、既存の操作receiptのJSONを使う。schema、ID、timestamp、元の履歴、cascadeを変更しない。遠隔D1の手動変更や新しいmigration、contractは不要である。

| 状態 | 読み書きとrollback |
|---|---|
| 現Worker / 現schema | 既存Web・command・通知を継続 |
| 配備前 / 同schema | migrationはなく、既存行とSQLを維持 |
| 新Worker / 同schema | 新Toolと参照付き操作を追加し、参照なし要求のhash・挙動を維持 |
| 旧Workerへ戻す / 同schema | 新しい入力項目は未対応。新Workerが保存した参照付きpreviewは、旧handlerの再計画に専用参照情報がないため不一致になり、旧serviceの`stale_preview`判定で実行を止める。新Workerへ戻した後、拒否された操作は現在状態から作り直す。既存操作・行・履歴は維持し、contract不要 |
| 互換期間終了後 | 置換・rename・dropや互換構造の撤去がなく、contract migrationは実施しない |

このJSON上のpreview差分による拒否をrollback条件として保持する。将来handlerが未知のpreview情報を無条件コピーする変更を入れる場合は、この条件も再検証する。

## 検証

`notification-replies.d1-test.ts`で、元の回、家族の完了、次回指定拒否、単件/複数件/一部削除、90日の論理期限、別本人・家庭・接続・client、scope・解除・期限・所属・セッション変更、スヌーズと予定変更、過去日完了・訂正・取消、在庫、操作再取得、batch直前の消失/失効を確認する。既存handler単体の再計画は参照付きpreviewと一致せず、参照情報だけでは意味のある差分を増やさないことも照合する。

`integration-mcp.d1-test.ts`で公開schemaから新Tool・参照付きcommand・権限challengeまでを通す。これらのローカルD1試験を実dotの通知返答と同一視せず、同一SHAのpreview配備後に架空データで実接続を確認する。
