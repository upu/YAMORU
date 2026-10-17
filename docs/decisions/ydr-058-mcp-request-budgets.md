---
type: Decision
ydr_id: YDR-058
title: MCPの回数制限と同時実行枠をD1で共有する
description: 認証付きMCP入口の利用者別回数制限と接続別commit leaseをWorker間で共有し、期限切れの処理を業務batchで拒否する
tags: [yamoru, decisions, integration, mcp, d1]
status: stable
decision_status: Accepted
decision_date: 2026-10-18
---

# YDR-058: MCPの回数制限と同時実行枠をD1で共有する

[会話連携設計](../product/conversation-integration.md)5節と[YDR-052](ydr-052-oauth-authorization-server-on-d1.md)のMCP入口の制限を具体化する。既存の認可・受付記録の決定は変更しない。関連: #439。

## 決定

- 認証済み要求を利用者単位のUTC固定1分窓で数え、読み取り60回、prepare・commit各20回を上限とする。利用者の枠を全接続で共有するため、個々の接続も同じ上限に収まり、再接続で枠を増やせない。initialize・Tool発見等も読み取りに数える。拒否した要求を別IDで連打しない。
- commitは接続ごとにD1上の2つのslotを原子的に確保する。leaseは120秒で期限切れにしてWorker停止から回復する。業務更新とreceiptの同じbatchの先頭でlease IDとDB時刻を照合し、期限切れ・置換済みの処理を制約違反で全取消にする。解放もlease IDを照合し、古い要求が新しいslotを解放しない。
- 制限はHTTP 429、`rate_limited`、`Retry-After`で返す。家庭の期限・履歴を変更しない。commitの結果が不明なら、別枠の読み取りで`operation_get`を先に照合する。
- 運用状態は`0039_integration_mcp_limits.sql`の追加テーブルにだけ保存し、payload・家庭の文章・秘密を保存しない。回数窓はuser個人、leaseはOAuth接続の子で、親削除にcascadeする。古い窓の掃除は要求ごと最大100行とする。

## 配備と互換性

| 状態 | 読み書きと保持 |
|---|---|
| 旧Worker + 旧schema | 既存のWeb・共通操作を維持 |
| 旧Worker + 0039 | 追加表を使わず、既存ID・時刻・履歴・SQLを維持 |
| 新Worker + 0039 | MCPだけが制限表を使う。旧Workerへ戻しても業務記録とreceiptは保持 |
| contract後 | 今回はcontractを設けない。恒久的な運用表であり、置換元や暫定同期表はない |

mainの通常CI・preview自動配備でmigrationをWorkerより先に適用する。既存migrationは編集しない。運用表の不具合も新migrationによるforward fixとする。

## 比較と検証

プロセス内MapはWorker間・再起動をまたいで共有できない。edge単位の近似制限だけでは接続の同時commit枠と期限切れ処理の拒否を業務batchへ結び付けられない。既存のD1の原子性を使う。

空DBと0038からの更新、旧SQL、FK/cascade、並列枠確保、再接続、カテゴリ別の枠、leaseの解放/回収/古い処理の全取消、HTTP 429と業務データ不変を実D1テストで確認する。固定窓の境界前後では短時間に2窓分が通り得るため、厳密な移動60秒制限とは扱わない。必要な値は実接続の計測後に別変更で調整する。
