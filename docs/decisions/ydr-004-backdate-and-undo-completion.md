---
type: Decision
ydr_id: YDR-004
title: バックデート完了と完了取消をMVPに含める
description: 完了日時を過去に指定できる機能と、完了を取り消せる機能をMVPに含める
tags: [yamoru, decisions, ydr]
status: stable
decision_status: Accepted
decision_date: 2026-08-12
---

# YDR-004: バックデート完了と完了取消をMVPに含める

- 状態: Accepted
- 決定日: 2026-08-12

## 背景

実際には作業したが、その場でアプリへ記録しないことは避けられない。また、誤タップも発生する。これらを修正できないと、アプリの履歴が現実とずれ、信頼されなくなる。

## 決定

- 完了日時を過去に指定できる。
- 完了を取り消せる。
- 取消時に過去の履歴を削除せず、取消イベントを追記する。

## 結果

ActivityLogは、指定された実際の実施日時`occurred_at`と、サーバーが付与する記録日時`recorded_at`を分けて保持する。完了日基準の次回期限は`occurred_at`から計算する。固定日基準では、元の`scheduled_for`から進めた暦上の候補が`occurred_at`以前なら飛ばす。どちらも画面を操作した`recorded_at`を次回計算には使わない。

## 見直す条件

この決定は中核要件のため、原則として維持する。
