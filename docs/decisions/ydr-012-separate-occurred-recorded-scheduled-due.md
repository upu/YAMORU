---
type: Decision
ydr_id: YDR-012
title: 実施日時と記録日時、本来の予定と現在期限を分離する
description: ActivityLogのoccurred_at/recorded_atと、TaskOccurrenceのscheduled_for/due_atをそれぞれ分離する
tags: [yamoru, decisions, ydr]
status: stable
decision_status: Accepted
decision_date: 2026-08-12
---

# YDR-012: 実施日時と記録日時、本来の予定と現在期限を分離する

- 状態: Accepted
- 決定日: 2026-08-12

## 背景

バックデート完了と延期を扱うため、実際に起きた時刻とアプリ操作時刻、本来の予定と延期後の期限を同じ値にすると履歴と周期計算が曖昧になる。

## 決定

- ActivityLogは`occurred_at`と`recorded_at`を分ける。
- TaskOccurrenceは`scheduled_for`と`due_at`を分ける。
- `recorded_at`はサーバー時刻とし、利用者が変更できない。
- 延期は`due_at`だけを変更し、`scheduled_for`は変更しない。
- 完了日基準の次回期限は`occurred_at`から計算する。
- 固定日基準では`scheduled_for`から暦上の候補を進め、`occurred_at`以前の候補を飛ばす。
- `(task_rule_id, scheduled_for)`に一意性を持たせる。

## 結果

バックデート幅、期限超過、延期履歴を区別でき、同じ予定枠の重複生成を防げる。

## 見直す条件

この決定は履歴と周期計算の基礎となるため、原則として維持する。
