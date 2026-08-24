---
type: Decision
ydr_id: YDR-030
title: 一回限りTodoだけ予定日未定のOccurrenceを許す
description: scheduled_forとdue_atのNULLペアを一回限りTodoに限定し、後から具体日と未定を往復できるようにする
tags: [yamoru, decisions, ydr, todo]
status: stable
decision_status: Accepted
decision_date: 2026-08-24
---

# YDR-030: 一回限りTodoだけ予定日未定のOccurrenceを許す

- 状態: Accepted
- 決定日: 2026-08-24

## 背景

外部から通知が届いた後の申請など、実施する必要は確定していても、実施可能な時期がまだ分からない一回限りTodoがある。仮の日付を入力すると、期限切れ・今日・近日や延期の意味が崩れ、予定日を信用できなくなる。

YDR-012は`scheduled_for`を本来の予定、`due_at`を現在の期限として分離し、YDR-014は予定枠とpending Occurrenceの重複を一意制約で防いでいる。日付未定をTaskRuleだけの特殊状態にすると、担当・完了・家庭間分離にOccurrenceがない別経路が必要になる。

## 決定

- 日付未定でも`status = 'pending'`のTaskOccurrenceを作る。
- `scheduled_for`と`due_at`は両方NULL、または両方非NULLに限定する。
- 両方NULLを許すのは`recurrence_basis = 'once'`のTaskRuleに属するOccurrenceだけとする。完了日基準・定例日基準では従来どおり両方を必須とする。
- 日付未定の一回限りTodoへ予定日を設定するときは、`scheduled_for`と`due_at`を同じ具体日にする。
- 具体日がある一回限りTodoは、両方をNULLにして予定日未定へ戻せる。
- 日付未定中は延期を提供しない。具体日があるときの延期はYDR-012どおり`scheduled_for`を保ち、`due_at`だけを変更する。
- 日付未定Todoは期限切れ・今日・近日へ分類せず、ホームの独立した「予定日未定」区分へ表示する。
- `(task_rule_id, scheduled_for)`の一意制約は具体的な予定枠の重複防止として維持する。NULL同士はSQLiteの一意制約では重複とみなされないため、`status = 'pending'`の`task_rule_id`部分一意制約を、日付未定を含む未解決Todo最大1件の保証として維持する。
- 一回限りTodoは日付未定のまま完了できる。完了時に次のOccurrenceは作らない。

## YDR-012 / YDR-014との関係

この決定はYDR-012またはYDR-014を置き換えない。日付が存在するときの`scheduled_for`と`due_at`の役割、延期規則、二種類の一意制約、pendingへの条件付き更新はそのまま維持する。本決定は、一回限りTodoの予定そのものがまだ存在しない期間に限り、二つの日時をNULLペアとして扱う例外を追加する。

## 結果

- 意味のない仮日付を入力せず、担当・完了・履歴・家庭間分離を既存のOccurrence経路で扱える。
- 予定日が決まった後も、事情が変われば未定へ戻せる。
- NULLを日付計算や文字列比較へ渡さない表示分岐が必要になる。
- D1ではTaskOccurrenceの再構築と、繰り返し方式を照合する制約が必要になる。

## 見直す条件

- 繰り返しTodoにも実施時期未定が必要になった。
- `waiting`、依存関係、自動有効化など、予定日以外の待機理由を状態として区別する必要が確認された。
