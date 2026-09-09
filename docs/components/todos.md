---
type: Component Map
title: Todoの修正箇所マップ
description: Todoの登録・編集・完了・予定計算について、最初に読む実装とテスト、守る不変条件、関連する有効なYDRへの入口
tags: [yamoru, components, todo]
status: stable
---

# Todoの修正箇所マップ

## 責務

管理対象に紐づくTaskRule(繰り返し条件を含む定義)と、その1回分であるOccurrence(現在の予定と状態)を扱う。実施の履歴はActivityLogとして追記し、Occurrenceを履歴の置き場にしない。

## 主要入口

| 変更したいこと | 画面・action | データアクセス |
|---|---|---|
| 登録 | `src/app/todos/new/actions.ts`(`createTodo`)、入力の正規化は`src/app/todos/new/calendar-todo-input.ts`、`src/app/todos/new/save-todo.ts` | `src/lib/d1/todos/creation.ts` |
| 1回だけのTodoの編集 | `src/app/todos/[id]/actions.ts`(`updateTodo`) | `src/lib/d1/todos/edit.ts` |
| 繰り返しTodoの現在回・次回以降の編集 | `src/app/todos/[id]/actions.ts`(`updateRecurringOccurrence`、`updateRecurringRule`)、`src/app/todos/[id]/edit/recurring-todo-edit-values.ts` | `src/lib/d1/todos/recurring-edit.ts`、`src/lib/d1/todos/rule-snapshot.ts` |
| 完了・完了取消 | `src/features/todos/actions/completion.ts`(`completeMaintenanceTask`、`undoMaintenanceTaskCompletion`)、UIは`src/features/todos/components/complete-todo-panel.tsx` | `src/lib/d1/todos/completion.ts` |
| 実施日時・実施者の訂正 | `src/features/todos/actions/correction.ts`(`correctCompletionOccurredAt`、`correctCompletionPerformer`)、UIは`src/features/todos/components/correction-panel.tsx` | `src/lib/d1/todos/corrections.ts` |
| 担当者の設定・引き受け | `src/features/todos/actions/assignee.ts`(`setTaskOccurrenceAssignee`、`claimTaskOccurrenceAssignee`)、UIは`src/features/todos/components/assignee-panel.tsx` | `src/lib/d1/todos/assignment.ts` |
| 延期・予定日の設定 | `src/features/todos/actions/schedule.ts`(`postponeTaskOccurrence`、`setTaskOccurrenceSchedule`、`unsetTaskOccurrenceSchedule`)、UIは`src/features/todos/components/postpone-panel.tsx`、`schedule-panel.tsx` | `src/lib/d1/todos/assignment.ts` |
| 繰り返し条件と次回予定の計算 | 表示側の言い回しは`src/app/task-schedule.ts` | `src/lib/d1/calendar.ts`、`src/lib/d1/calendar-schedule-specs.ts` |

公開する名前は`src/lib/d1/todos/index.ts`に集約している。呼び出し側は`../lib/d1/todos`をimportし、分割後のファイルを直接importしない。

画面をまたいで使うTodo操作(action・パネル・action状態型)は`src/features/todos/`に置き、画面(`src/app/`)から参照する。ホーム・Todo一覧・Todo詳細・管理対象詳細・横断検索はいずれも同じ実装を共有し、画面ごとの保存処理を持たない。action同士が共有するRPCエラーの読み替えは`src/features/todos/actions/rpc-error.ts`、更新後の再検証先は`src/features/todos/actions/revalidation.ts`にまとめる。

## 重要な不変条件

- 完了は冪等性キー付きで`D1Database.batch()`により一括実行し、二種類の一意制約と条件付き更新で重複完了を防ぐ([YDR-014](../decisions/ydr-014-unique-constraints-and-conditional-update.md))。再送は同じ結果を返す。
- Occurrenceは状態、ActivityLogは履歴。完了取消は安全な条件でのみ行う([YDR-015](../decisions/ydr-015-occurrence-state-activitylog-history-safe-undo.md))。
- 実施記録の訂正は上書きせず追記型の訂正イベントとして残し、有効値は読み取り時に解決する([YDR-026](../decisions/ydr-026-completion-correction-events.md)、`loadActiveCompletion`/`resolveEffectiveCompletion`)。
- 実施日時と記録日時、本来の予定と現在期限を別々に持つ([YDR-012](../decisions/ydr-012-separate-occurred-recorded-scheduled-due.md))。バックデート完了と完了取消はMVPの対象([YDR-004](../decisions/ydr-004-backdate-and-undo-completion.md))。
- 担当予定者・実施者・操作主体は別概念であり保存先が異なる([YDR-020](../decisions/ydr-020-assignee-performer-actor.md))。担当者未設定が既定([YDR-006](../decisions/ydr-006-unassigned-by-default.md))。
- 繰り返しTodoの編集は現在回・次回以降・過去回を分け、過去回の記録を書き換えない([YDR-039](../decisions/ydr-039-safe-recurring-todo-edit.md))。Occurrenceは発生時のTaskRuleの値を`rule_snapshot`に持ち、表示・検索はsnapshotがあればそれを使う。
- 候補日の計算はAsia/Tokyoの暦日で行い、存在しない暦日を黙って繰り上げない。方式ごとの規則は[YDR-021](../decisions/ydr-021-recurring-calendar-rules.md)(定例日)、[YDR-032](../decisions/ydr-032-monthly-day-month-end.md)(月末)、[YDR-040](../decisions/ydr-040-multi-candidate-calendar-rules.md)(複数候補の和集合)、[YDR-037](../decisions/ydr-037-fixed-interval-recurrence.md)(固定間隔)、[YDR-038](../decisions/ydr-038-completion-calendar-intervals.md)(完了日基準の月・年)、[YDR-013](../decisions/ydr-013-fixed-date-next-occurrence-calculation.md)(次回予定枠)。
- 方式変更や導入時に過去分のOccurrenceを自動生成しない([YDR-016](../decisions/ydr-016-no-backfill-on-per-occurrence-mode.md))。
- 予定日未定は`scheduled_for`と`due_at`がNULLであることで表し、`recurrence_basis = 'once'`に限る。新しいTodo状態を追加しない。

## 関連YDR

- 有効: YDR-004、YDR-006、YDR-012、YDR-013、YDR-014、YDR-015、YDR-016、YDR-020、YDR-021、YDR-026、YDR-031、YDR-032、YDR-037、YDR-038、YDR-039、YDR-040
- 部分的に置き換えられている(範囲に注意):
  - [YDR-030](../decisions/ydr-030-undated-one-time-task-occurrences.md)は[YDR-031](../decisions/ydr-031-undated-todos-out-of-home.md)が置き換えたが、置き換えたのはホームの表示先だけである。NULLペアの扱い、一回限りTodoへの限定、具体日と未定の往復、未定中は延期を提供しないこと、未定のまま完了できることはYDR-030の記述がそのまま継続する。
  - [YDR-010](../decisions/ydr-010-single-pending-occurrence-per-task-rule.md)と[YDR-017](../decisions/ydr-017-strict-deadline-vs-maintenance-recommended-window.md)は過去の経緯として読む。推奨期間の現在の表示規則は[YDR-034](../decisions/ydr-034-maintenance-home-progress-states.md)。

## 検証方法

```
npm test
npm run test:d1
npm run lint
npm run typecheck
```

暦計算だけを変える場合は`tests/d1-calendar.test.ts`と`tests/task-schedule.test.ts`、保存や家庭間分離を変える場合は`src/lib/d1/`配下の`*.d1-test.ts`(`todos-authorization`、`recurring-todo-edit`、`interval-recurrence`、`completion-calendar-interval`など)を先に確認する。画面操作の回帰は`e2e/todo-list.spec.ts`、`e2e/todo-edit.spec.ts`、`e2e/todo-completed-detail.spec.ts`で確認する。
