---
type: Decision
ydr_id: YDR-063
title: 通知の宛先集合と結果を購読の世代ごとに保持する
description: 複数宛先の再試行と中断回復を分け、解除後の古い配信を防ぐ
tags: [yamoru, decisions, notifications, d1]
status: stable
decision_status: Accepted
decision_date: 2026-10-18
---

# YDR-063: 通知の宛先集合と結果を購読の世代ごとに保持する

[#442](https://github.com/upu/YAMORU/issues/442)で[YDR-059](ydr-059-durable-notification-outbox.md)・[YDR-060](ydr-060-event-subscription-boundary.md)・[YDR-061](ydr-061-notification-source-and-retention.md)を具体化する。共有予定や通知設定を変更しない。

## 宛先と結果

送信前に、その時点の全ての一致する有効購読を固定する。安定event IDと一度だけ直列化した本文を親配信へ保存し、再試行でも維持する。本文は候補IDと元対象IDだけを含み、callbackや署名鍵は複写しない。固定後に追加された購読へ古いイベントを追加配信しない。

購読にランダムな世代を持たせる。有効期間内の鍵更新は同じ世代、解除・失効を越える再開と削除後の再作成は新しい世代とする。旧WorkerのINSERT/UPDATEにもtriggerで適用し、古い配信を復活させない。

宛先ごとに試行数、初回送信時刻、backoff、試行tokenと既知・不明の結果を保持する。受領済み宛先と結果不明の宛先は自動再送しない。8回・24時間を宛先ごとに検査し、親の回数は宛先の最大試行数とする。複数宛先を処理するだけで上限を消費しない。

各宛先の開始batchで親lease・親revision・家庭revision・最新の本人設定・候補・権限・購読revision/世代/期限を照合する。結果の保存は解除後も可能だが、期限切れの親leaseや古い試行tokenでは保存できない。

送信中断でその宛先だけをunknownにし、残りの未送信宛先は続行する。未送信分が残る間は親のunknown重複抑止を確定しない。全宛先が終わったらunknown、failed、accepted、cancelledの順で集計する。受領済みがあり他が取消しならacceptedとする。全受領保存後の中断はacceptedへ回復する。後の通知停止で既存のunknownやfailedを取消しへ書き換えない。

## データと配備

0043は購読への世代追加と、親配信へ複合FKを持つbatch・宛先表を追加する。宛先のINSERT triggerで購読の家庭・本人・接続・世代一致も強制し、identity更新を禁止する。購読の清掃で送信証拠を消さず、旧WorkerのDELETEも維持するため、生存購読へのFKは持たない。家庭・本人・接続・親配信の物理削除ではcascadeする。

| 状態 | 互換性 |
|---|---|
| 現Worker / 現schema | 既存操作を継続 |
| 現Worker / 0043 | 旧購読SQLを維持。新表を無視し、世代はtriggerが保守 |
| 新Worker / 0043 | 宛先別APIと回復を利用。旧Workerへ戻しても行を保持 |
| contract後 | 旧構造の置換はなくcontract不要 |

既存ID・日時・履歴を保持し、新構造は以後も利用する。終端から90日後に本文を一回100件ずつ消す。unknown/failedは最小の宛先結果・ID・試行数を維持し、上限回避を防ぐ。非終端の本文は維持する。

この追加は内部の保存APIであり、runtimeのEvents providerを有効にしない。実connector、定期取得の代替方式、日次まとめ、実dotの到達・解除・失効は#442の残る合格条件である。

参照: [OpenAI MCP Events](https://developers.openai.com/plugins/build/mcp-events)（2026-10-18確認）。
