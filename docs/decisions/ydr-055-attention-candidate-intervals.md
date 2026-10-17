---
type: Decision
ydr_id: YDR-055
title: 通知候補の発生区間と差分を永続化する
description: 上限付き再評価、候補区間、削除差分、旧Worker互換を定める
tags: [yamoru, decisions, notifications, d1]
status: stable
decision_status: Accepted
decision_date: 2026-10-17
---

# YDR-055: 通知候補の発生区間と差分を永続化する

#440はYDR-050を具体化する。#437のYDR-054・migration 0033と番号を分離し、0034を使用する。既存Accepted判断を置き換えない。

## 操作と保存

認証済みの読み取りで家庭共有の候補を再評価する。業務上の期限・在庫・担当は変更せず、候補と変更IDだけを保存する。個人設定や配信済み状態は#441/#442で扱う。

候補が存在し続ける間はIDを保持し、理由・優先度・担当・日付の変化はrevisionで区別する。解消・完了・スキップ・削除では候補を削除して削除IDを残す。旧Workerの更新でもtriggerが区間終了を捕捉するため、次の取得までに完了取消や在庫再減少が起きても同じIDに戻らない。

一回の再評価は最大100対象、応答は候補と削除IDの合計で最大50件。再評価の続きはcursorで返し、途中はrefresh_complete=falseで候補を返さない。家庭versionと東京暦日が変わった場合は再評価をやり直す。完了した再評価を同じversion/日付で再利用する。

cursorは本人・家庭・client・接続・条件へ署名で束縛し15分で失効する。next_cursorはページ継続、sync_cursorは完了した取得以後の差分取得に使う。途中ページは家庭version・変更列の上限・暦日を固定し、変更されたら最初から取得する。削除履歴は少なくとも24時間保持し、期限超過cursorは全件の上限付き再取得へ戻す。

候補ID指定は最大50、他家庭IDと存在しないIDは同じ空結果とする。候補の取得は送信・既読を意味しない。候補revisionは候補の鮮度であり、業務commandのentity revisionとは別物。実行前にはentity_getを呼ぶ。

## 配備と互換性

| 状態 | 読み書き |
|---|---|
| 現Worker + 現schema | 既存Web・共通読み取りが動く |
| 0034追加直後 + 現Worker | 追加table/view/triggerのみ。業務行・ID・timestamp・履歴を保存し、旧SQLでも候補解消を捕捉 |
| 0034 + 新Worker | 上記に候補の再評価と差分取得を追加 |
| contract | 不要。追加構造は恒久利用、削除対象なし |

候補のOccurrence/消耗品参照は家庭を含む複合FK。対象削除はcascadeして削除IDを残し、家庭削除では候補・変更・再評価状態も削除する。batchのversion検査と候補更新は原子的に行う。制約違反で全体rollbackする。

Workerは#451の更新件数互換対応以降へ戻せる。productionは互換版v0.20.1配備済みだが、このIssueで本番へ配備はしない。適用済みmigrationは不変とし、配備後の修正はforward migrationとする。

## 検証

純粋projectionの東京日付境界・全理由、D1の再送・解消再発・完了取消・差分削除・家庭境界・失効・上限・競合、更新DB/空DB/旧SQL/rollback/cascadeと生成schemaを確認する。実通知や実dot接続は#439/#442/#444で検証する。
