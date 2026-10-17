---
type: Decision
ydr_id: YDR-061
title: 通知時の元対象を保持し、詳細と再送防止の保存期限を分ける
description: 元Occurrenceを候補から独立させ、90日後も不確定な配信の再送を防ぐ
tags: [yamoru, decisions, notifications, d1]
status: stable
decision_status: Accepted
decision_date: 2026-10-18
---

# YDR-061: 通知時の元対象を保持し、詳細と再送防止の保存期限を分ける

[#442](https://github.com/upu/YAMORU/issues/442)の配信証拠と[#443](https://github.com/upu/YAMORU/issues/443)の元対象の照合を具体化する。[YDR-050](ydr-050-conversation-reminders.md)・[YDR-056](ydr-056-personal-notification-policy.md)・[YDR-059](ydr-059-durable-notification-outbox.md)は置き換えない。

## 元対象

outboxの作成時に、その通知が指す種類・entity ID・Todo rule IDを本人の配信IDへ結び付ける。Todoのentity IDは元のOccurrenceであり、同じruleの次回Occurrenceへ読み替えない。候補の解消や元データの削除で、保持期間内のこの証拠を消さない。

候補がまだ存在する既存行だけを同じ家庭の実体と照合してbackfillする。候補が既に消えている過去の配信に元対象を推測で埋めない。sourceがない、期限を過ぎた、元対象を削除した場合は、#443で利用者に現在の対象を選び直してもらう。古い通知を根拠に次回へ操作しない。sourceの保持だけでは操作を認可せず、実行時の再認証・現在状態・変更確認を別途要する。

## 保持期限

配信の詳細は終端状態から90日後に順次削除する。accepted・reported・cancelled・suppressedのoutboxとsourceは、一回100件ずつ削除する。候補が有効な間の既存の最小配信markは消さず、再通知の可否を引き続き判定する。

unknown・failedは配信ID・候補ID・状態・試行数・日時を保持し、新しいIDによる自動再送や上限の回避を防ぐ。90日後は名前を空にし、元対象のsourceを削除する。名前の削除で状態日時を書き換えず、revisionだけを増やす。まだ送っていないpending・leased・sending・retry_waitのsourceと名前は保持する。

sourceのterminal_atは親の状態と日時の変更をtriggerで追従し、非終端へ戻れば解除する。sourceの期限索引、既知結果の削除用部分索引、未redact行だけの部分索引を使い、既に処理した不明記録を繰り返し走査しない。削除・redactはそれぞれ一回100件までとし、候補の走査とは独立して保守する。

## 配備と互換性

0042はsource表・索引・triggerの追加だけで、既存のIDと日時を変更しない。親outboxの配信・家庭・本人・接続の複合FKを使い、接続や家庭の物理削除ではcascadeする。元の業務実体へのFKは置かず、削除後も通知時の証拠を保持できるようにする。

| 状態 | 読み書きと互換性 |
|---|---|
| 現Worker / 現schema | 既存操作を継続 |
| 現Worker / 0042追加後 | 元のINSERT列・状態更新だけでtriggerがsourceと保持期限を補う |
| 新Worker / 0042追加後 | 元対象を保持し、小分けの保守を実施。旧Workerへ戻しても既存操作とsourceを保持 |
| contract後 | 置換する旧構造はなくcontract不要 |

旧Workerへ戻した間は新しい保守が停止し、次の対応Workerで再開する。通常のCI経由でmigrationをWorkerより先に適用する。更新DB・空DB、候補と実体の削除、本人FK・cascade、batch rollback、元の日時、100件の上限と不明結果の再送防止をD1で確認する。
