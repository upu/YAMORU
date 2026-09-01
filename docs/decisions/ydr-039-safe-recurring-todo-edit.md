---
type: Decision
ydr_id: YDR-039
title: 繰り返しTodoの現在回、次回以降、過去回を分けて安全に編集する
description: 繰り返しTodoの編集対象を現在回と次回以降に分け、過去回を発生時スナップショットで固定する
tags: [yamoru, decisions, ydr, todo, recurrence, history]
status: stable
decision_status: Accepted
decision_date: 2026-09-01
---

# YDR-039: 繰り返しTodoの現在回、次回以降、過去回を分けて安全に編集する

- 状態: Accepted
- 決定日: 2026-09-01

## 背景

繰り返しTodoは登録後も、作業名、関連する管理対象、周期、今回の担当や期限が変わる。しかしTaskRuleだけを上書きすると、既に完了したOccurrenceまで現在の名前や関連先で表示され、当時の実施記録が変質する。反対に、現在回と将来の定義をすべて固定すると、日常的な変更を反映できない。

[YDR-012](ydr-012-separate-occurred-recorded-scheduled-due.md)は実施日時・記録日時と本来の予定・現在期限を分け、[YDR-013](ydr-013-fixed-date-next-occurrence-calculation.md)は固定日基準の次回予定枠を決めている。[YDR-015](ydr-015-occurrence-state-activitylog-history-safe-undo.md)と[YDR-026](ydr-026-completion-correction-events.md)は完了取消・訂正で後続の変更を失わない境界を定めている。この決定は、その境界を繰り返しTodoの編集へ拡張する。

## 検討した選択肢

1. TaskRuleの基本情報と繰り返し条件を編集し、現在回と将来回へまとめて反映する。入口は単純だが、現在回の本来の予定・延期済み期限を再計算するかが曖昧になり、過去表示を守るスナップショットも必要になるため採用しない。
2. 現在Occurrenceで安全に変更できる担当・期限と、TaskRuleの名前・関連先・繰り返し条件を分ける。履歴への影響と適用範囲が明確になるため採用する。二つの場所を探す負担は、同じ編集画面内の二領域と独立した保存操作にして抑える。
3. 編集のたびに「現在回だけ」「今後すべて」を選ぶ。柔軟だが、各項目で選べる適用範囲が異なり、誤操作とデータモデルの複雑さが増えるため採用しない。

## 決定

### 1. 編集画面と適用範囲

- pendingの繰り返しTodo詳細から同じ編集画面へ入り、「今回の予定」と「次回以降の繰り返し」を分けて保存する。
- 今回の予定では、TaskOccurrenceの担当者と現在期限`due_at`だけを変更できる。本来の予定`scheduled_for`は変更しない。担当変更と延期は既存のActivityLogへ追記する。
- 次回以降の繰り返しでは、TaskRuleの名前、関連ManagedItem、同じ繰り返し方式内の条件を変更できる。`calendar`、`completion`、`interval`の方式間は変更できない。
- TaskRuleの変更は現在回の`scheduled_for`と`due_at`を再計算しない。変更後に現在回を完了したとき、既存の次回計算規則が新しいTaskRuleを使って次回Occurrenceを一件だけ生成する。

### 2. 過去回と現在回の表示

- TaskOccurrenceは発生時のTaskRuleスナップショットを持つ。対象は名前、関連ManagedItemのIDと表示名、繰り返し方式・条件、期限種別である。
- 新規Occurrenceは生成時のTaskRuleからスナップショットを保存する。既存Occurrenceは移行時点のTaskRuleからbackfillする。
- 次回以降のルールを編集したときは、現在のpending Occurrenceのスナップショットだけを更新する。完了済み・取消済みを含む過去Occurrenceは更新しない。
- Todo詳細、ホームの直近完了、ManagedItem詳細はOccurrenceのスナップショットを優先する。展開移行中に空のスナップショットを持つ行だけは現在のTaskRuleへフォールバックする。

### 3. 変更履歴と取消・訂正

- TaskRuleの変更はActivityLogと混ぜず、変更前後のスナップショット、対象の現在Occurrence、操作主体を`task_rule_changes`へ追記する。
- 完了により生成された次回OccurrenceへTaskRule変更が記録された後は、元Occurrenceの完了取消と実施日訂正を拒否する。編集済みの次回Occurrenceを削除・再生成して利用者の変更を失わない。
- 担当変更や延期に対する既存の取消ガードは維持する。TaskRule変更も同じ「後続Occurrenceが変更済み」という安全条件へ加える。

### 4. 整合性と家庭境界

- TaskRule本体、変更履歴、現在Occurrenceのスナップショット更新は一つのD1 batchで実行し、いずれかが失敗したら全体をロールバックする。
- TaskRule、TaskOccurrence、TaskRuleChange、ManagedItem、担当者は認証済みユーザーの現在家庭で絞り込む。クライアントから`household_id`を受け取らない。
- TaskRuleの既存のCHECK制約、pending一件制約、予定枠の一意制約を維持する。編集は新しいOccurrenceを直接作らない。

## 結果

- 今回だけの担当・期限変更と、将来も使う繰り返し内容の変更を一画面から区別して行える。
- 過去の完了記録は、後のルール編集や関連先変更で表示が変わらない。
- 現在回の予定枠と延期済み期限を保ったまま、完了後の次回だけへ新条件を適用できる。
- 繰り返し方式の変更、ルール版の復元UI、過去ルールとの詳細な差分表示は含めない。

## 見直す条件

- 繰り返し方式そのものを変更する必要が生じた場合。
- 将来の特定回だけを編集する、またはルール変更の適用開始回を予約する場合。
- ルール変更履歴の閲覧・復元が利用者向け機能として必要になった場合。
- 一件持ち越し方式をやめ、複数の将来Occurrenceを先に生成する場合。
