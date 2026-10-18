---
type: Decision
ydr_id: YDR-064
title: 署名付き通知のHTTP送信と結果保存を別々に再試行する
description: 宛先ごとの開始・送信・結果保存をつなぎ、保存失敗による再送を防ぐ
tags: [yamoru, decisions, notifications, integration]
status: stable
decision_status: Accepted
decision_date: 2026-10-18
partially_superseded_by:
  - ydr_id: YDR-070
    scope: 検証節の#442完了条件に含むEventsの実connector・scheduler送信配線・日次まとめの実配送・実到達と購読停止/失効
---

# YDR-064: 署名付き通知のHTTP送信と結果保存を別々に再試行する

[#442](https://github.com/upu/YAMORU/issues/442)で[YDR-059](ydr-059-durable-notification-outbox.md)・[YDR-060](ydr-060-event-subscription-boundary.md)・[YDR-063](ydr-063-notification-recipient-results.md)の送信段階を具体化する。共有予定・本人設定を変更しない。

## 送信と保存

送信直前に宛先別の開始をD1へ保存し、固定した本文・event IDに現時刻でStandard Webhooks署名を付ける。callbackと鍵は本人・家庭・接続・購読に束縛した暗号文からメモリ内だけへ復号し、provider不一致、scope不足、復号失敗では送らない。旧鍵との移行期間は既存の5分を維持する。

2xxは連携先の受領を示し、既読や案内済みを意味しない。408・425・429・5xxは既知の一時失敗、410・413とその他の4xxは再送しない失敗とする。宛先拒否・redirect・本文上限違反も再送しない。通信開始前の一時失敗はretry、開始後のtimeout・通信障害や分類できない例外はunknownとする。URL、鍵、例外の本文を結果やログへ返さない。

HTTPを呼ぶ関数は一度だけPOSTし、再送しない。応答を得た後のD1保存は同じ試行token・同じ結果で最大3回試す。保存が続けて失敗したらqueueを解放する前に停止を共有し、待機中の宛先も開始しない。準備中・通信中の要求へ中断を伝え、開始済み処理の結果保存と終了を待つ。プロセスが止まっても、既知結果と残るsending/pendingを永続回復で分ける。

一jobは固定済みの最大20宛先を二つまで並行送信する。D1遷移はjob内のqueueで直列化し、globalなmutexは持たない。各POSTは10秒でその通信を中断し、結果を保存する。一宛先のtimeoutだけではjob全体を停止せず、結果不明の宛先を繰り返さずに他の宛先を続ける。job開始90秒後、外部からの中断、または上述の保存失敗では、全体の通信を中断して新たな送信を始めない。開始済み試行の結果保存は待ち、全workerが終了してから親を確定する。保存待ちを含むjobの完了時刻や通知の到達時間は保証しない。開始件数はHTTP到達件数と区別する。

## 通知方式の変更

個別・日次の方式を本文内の`data.notification_mode`へ固定する。各宛先の開始時に最新の設定と比較し、変わっていれば未送信の古い本文を取りやめる。設定revisionの既存guardで比較と開始を束縛し、個別の本文を日次まとめへ読み替えない。

この項目がない旧形式は個別として扱う。従来runtimeはEvents providerを設定しておらず、実環境に旧形式の配信jobはない。MCPのpayload schemaでは追加項目をoptionalとし、古い形式も受け付ける。既存ID・本文・時刻・migrationは書き換えない。候補・購読が停止した場合も既に受領した結果は残す。

## 検証と公開の境界

新schemaは不要で、適用済み0043・0044と旧SQLを維持する。送信jobは内部APIであり、runtimeへの配線やEvents providerの有効化を含めない。

D1と架空transportの統合テストで、部分受領と再試行、結果不明、二宛先の上限、保存だけの再試行、家族の完了、通知方式変更、旧形式、要求中断、所有者境界を検証する。mockの受領は実connectorのTLSや実dotへの到達を証明しない。実connector、schedulerへの配線、日次まとめ、非対応時の定期取得、実dotの到達・停止・失効は#442の残る合格条件である。

このうちEventsの実connector・schedulerへのHTTP送信配線・日次まとめの実配送・実dot到達と購読停止/失効を#442の必須条件とする部分だけは[YDR-070](ydr-070-free-polling-first.md)で後続#474へ移す。内部job・結果保存・再送防止と上記の統合テストは維持し、定期取得の実案内・停止と接続失効の確認は今回に残す。

参照: [OpenAI MCP Events](https://developers.openai.com/plugins/build/mcp-events)（2026-10-18確認）。
