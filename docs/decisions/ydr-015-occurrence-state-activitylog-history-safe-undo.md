---
type: Decision
ydr_id: YDR-015
title: Occurrenceを状態、ActivityLogを履歴とし、安全な条件で完了取消する
description: TaskOccurrenceを現在状態、ActivityLogを追記型履歴とし、未変更の派生Occurrenceだけを対象に完了取消を許可する
tags: [yamoru, decisions, ydr]
status: stable
decision_status: Accepted
decision_date: 2026-08-12
---

# YDR-015: Occurrenceを状態、ActivityLogを履歴とし、安全な条件で完了取消する

- 状態: Accepted
- 決定日: 2026-08-12

## 背景

完了取消では、元のTodoだけでなく、完了によって自動生成された次回Todoとの整合も戻す必要がある。ただし、その次回Todoを家族がすでに延期、担当変更、完了している場合、機械的に削除すると正当な操作を失う。

## 決定

- TaskOccurrenceはTodoの現在状態を表す。
- ActivityLogは完了、取消、延期、スキップ、担当変更などの追記型履歴を表す。
- 完了取消は、取消ActivityLogの追記、自動生成された未変更の次回Occurrenceの物理削除、元Occurrenceの`pending`への復帰を一つのトランザクションで行う。
- 次回Occurrenceに利用者操作のActivityLogが一つでもある場合、取消を拒否して手動訂正を案内する。
- 自動生成後に一度も操作されていない派生Occurrenceだけを削除するため、履歴を黙って消さない原則とは矛盾しない。

## 結果

誤完了を簡単に戻せる一方、後続の正当な操作や履歴を失わない。

## 見直す条件

複数段階の訂正や、任意の過去完了を取り消す必要が実運用で確認された場合。
