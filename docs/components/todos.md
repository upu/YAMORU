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
| 必要になったら繰り返すTodo(`manual`)の登録・完了・編集 | `src/app/todos/new/actions.ts`、`src/app/todos/[id]/edit/page.tsx` | `src/lib/d1/todos/creation.ts`(`createManualTask`)、`src/lib/d1/todos/shared.ts`(`nextOccurrence`)、`src/lib/d1/todos/edit.ts` |
| 繰り返し条件の入力解釈・制約値(登録と編集で共通) | `src/app/todos/calendar-schedule-input.ts`(定例日条件とエラー識別子)、`src/app/todos/todo-input-limits.ts`(Todo名とメモの長さ、完了日基準・固定間隔の上限) | - |
| メモ(手順・注意点)の入力・表示 | 入力欄は`src/app/todos/todo-note-field.tsx`、入力の解釈は`src/app/todos/todo-input-limits.ts`(`parseTodoNote`)、表示は`src/app/todos/[id]/page.tsx` | `src/lib/d1/todos/creation.ts`、`src/lib/d1/todos/edit.ts`、`src/lib/d1/todos/recurring-edit.ts` |
| 1回だけのTodo・必要時Todoの編集 | `src/app/todos/[id]/actions.ts`(`updateTodo`) | `src/lib/d1/todos/edit.ts` |

必要時Todo(`manual`)は現在期限も繰り返し条件も持たないため、繰り返しTodoの「今回の予定 / 次回以降」の二分割を使わず、一回限りTodoと同じ一つの画面・一つの保存で編集する([YDR-046](../decisions/ydr-046-manual-recurrence-todos.md))。保存先の分離、現在回のスナップショット更新、`task_rule_changes`への追記、完了取消・実施日訂正のガードは[YDR-039](../decisions/ydr-039-safe-recurring-todo-edit.md)のまま。

| 繰り返しTodoの現在回・次回以降の編集 | `src/app/todos/[id]/actions.ts`(`updateRecurringOccurrence`、`updateRecurringRule`)、`src/app/todos/[id]/edit/recurring-todo-edit-values.ts` | `src/lib/d1/todos/recurring-edit.ts`、`src/lib/d1/todos/rule-snapshot.ts` |
| 完了・完了取消 | `src/features/todos/actions/completion.ts`(`completeMaintenanceTask`、`undoMaintenanceTaskCompletion`)、UIは`src/features/todos/components/complete-todo-panel.tsx` | `src/lib/d1/todos/completion.ts` |
| 実施日時・実施者の訂正 | `src/features/todos/actions/correction.ts`(`correctCompletionOccurredAt`、`correctCompletionPerformer`)、UIは`src/features/todos/components/correction-panel.tsx` | `src/lib/d1/todos/corrections.ts` |
| 担当者の設定・引き受け | `src/features/todos/actions/assignee.ts`(`setTaskOccurrenceAssignee`、`claimTaskOccurrenceAssignee`)、UIは`src/features/todos/components/assignee-panel.tsx` | `src/lib/d1/todos/assignment.ts` |
| 延期・予定日の設定 | `src/features/todos/actions/schedule.ts`(`postponeTaskOccurrence`、`setTaskOccurrenceSchedule`、`unsetTaskOccurrenceSchedule`)、UIは`src/features/todos/components/postpone-panel.tsx`、`schedule-panel.tsx` | `src/lib/d1/todos/assignment.ts` |
| 繰り返し条件と次回予定の計算 | 表示側の言い回しは`src/app/task-schedule.ts` | `src/lib/d1/calendar.ts`、`src/lib/d1/calendar-schedule-specs.ts` |

公開する名前は`src/lib/d1/todos/index.ts`に集約している。呼び出し側は`../lib/d1/todos`をimportし、分割後のファイルを直接importしない。

画面をまたいで使うTodo操作(action・パネル・action状態型)は`src/features/todos/`に置き、画面(`src/app/`)から参照する。ホーム・Todo一覧・Todo詳細・管理対象詳細・横断検索はいずれも同じ実装を共有し、画面ごとの保存処理を持たない。action同士が共有するエラーの読み替えは`src/features/todos/actions/error-mapping.ts`、更新後の再検証先は`src/features/todos/actions/revalidation.ts`にまとめる。

## エラーの扱い

D1層が投げる業務エラーは`src/lib/d1/errors.ts`の`D1ErrorCode`(識別コード)を持ち、actionはコードだけを見て利用者向けの案内文を選ぶ。内部の英文メッセージは開発者向けであり、変更しても案内文は変わらない(Issue #369)。

- 業務エラー: アプリが明示的に投げる、利用者の操作で起こりうる失敗。コードを持つ。対応表はaction側(`src/features/todos/actions/error-mapping.ts`と各action、`src/app/todos/[id]/actions.ts`)にある。
- 外部エラー: D1/SQLiteの制約違反。文字列判定は`src/lib/d1/todos/completion.ts`と`src/lib/d1/todos/edit.ts`のD1境界だけに置き、`task_occurrences`の一意制約に限って業務エラーへ読み替える。
- 予期しないエラー: TaskRuleの保存内容が壊れている場合の不変条件違反など。コードを持たせず、actionの一般的な失敗表示へ落とす。

## 重要な不変条件

- 完了は冪等性キー付きで`D1Database.batch()`により一括実行し、二種類の一意制約と条件付き更新で重複完了を防ぐ([YDR-014](../decisions/ydr-014-unique-constraints-and-conditional-update.md))。再送は同じ結果を返す。
- Occurrenceは状態、ActivityLogは履歴。完了取消は安全な条件でのみ行う([YDR-015](../decisions/ydr-015-occurrence-state-activitylog-history-safe-undo.md))。
- 実施記録の訂正は上書きせず追記型の訂正イベントとして残し、有効値は読み取り時に解決する([YDR-026](../decisions/ydr-026-completion-correction-events.md)、`loadActiveCompletion`/`resolveEffectiveCompletion`)。
- 実施日時と記録日時、本来の予定と現在期限を別々に持つ([YDR-012](../decisions/ydr-012-separate-occurred-recorded-scheduled-due.md))。バックデート完了と完了取消はMVPの対象([YDR-004](../decisions/ydr-004-backdate-and-undo-completion.md))。
- 未完了Todoの詳細は、担当と完了を他の画面と同じパネル(`src/features/todos/components/`)で行い、画面固有の保存処理を持たない([Issue #392](https://github.com/upu/YAMORU/issues/392))。担当の現在値はそのselectが示すため、「Todoの内容」の一覧に読み取り専用の担当行を重ねて出さない。完了済みTodoの詳細には担当・完了の操作を出さず、追記型の実施記録の訂正・完了取消だけを置く。
- 担当予定者・実施者・操作主体は別概念であり保存先が異なる([YDR-020](../decisions/ydr-020-assignee-performer-actor.md))。担当者未設定が既定([YDR-006](../decisions/ydr-006-unassigned-by-default.md))。
- 繰り返しTodoの編集は現在回・次回以降・過去回を分け、過去回の記録を書き換えない([YDR-039](../decisions/ydr-039-safe-recurring-todo-edit.md))。Occurrenceは発生時のTaskRuleの値を`rule_snapshot`に持ち、表示・検索はsnapshotがあればそれを使う。
- 候補日の計算はAsia/Tokyoの暦日で行い、存在しない暦日を黙って繰り上げない。方式ごとの規則は[YDR-021](../decisions/ydr-021-recurring-calendar-rules.md)(定例日)、[YDR-032](../decisions/ydr-032-monthly-day-month-end.md)(月末)、[YDR-040](../decisions/ydr-040-multi-candidate-calendar-rules.md)(複数候補の和集合)、[YDR-037](../decisions/ydr-037-fixed-interval-recurrence.md)(固定間隔)、[YDR-038](../decisions/ydr-038-completion-calendar-intervals.md)(完了日基準の月・年)、[YDR-013](../decisions/ydr-013-fixed-date-next-occurrence-calculation.md)(次回予定枠)。
- 方式変更や導入時に過去分のOccurrenceを自動生成しない([YDR-016](../decisions/ydr-016-no-backfill-on-per-occurrence-mode.md))。
- 予定日未定は`scheduled_for`と`due_at`がNULLであることで表し、`recurrence_basis`が`'once'`または`'manual'`のTaskRuleに限る([YDR-046](../decisions/ydr-046-manual-recurrence-todos.md))。新しいTodo状態を追加しない。
- メモ(`task_rules.note`)はOccurrenceごとの記録ではなくTaskRuleの手順であり、`rule_snapshot`へ含めない。完了済みTodoの詳細でも現在の値を表示する。表示先はTodo詳細だけで、ホーム・Todo一覧・管理対象詳細・横断検索には出さない([YDR-047](../decisions/ydr-047-todo-note-on-task-rule.md))。
- 「必要になったら繰り返す」(`manual`)のOccurrenceは常に予定日未定で、具体日と未定を往復しない。完了すると次の予定日未定Occurrenceを1件だけ作る。予定日の設定・延期は提供せず、DB側のトリガーもこの不変条件を守る([YDR-046](../decisions/ydr-046-manual-recurrence-todos.md))。

## 関連YDR

- 有効: YDR-004、YDR-006、YDR-012、YDR-013、YDR-014、YDR-015、YDR-016、YDR-020、YDR-021、YDR-026、YDR-031、YDR-032、YDR-037、YDR-038、YDR-039、YDR-040、YDR-046、YDR-047
- 部分的に置き換えられている(範囲に注意):
  - [YDR-030](../decisions/ydr-030-undated-one-time-task-occurrences.md)は[YDR-031](../decisions/ydr-031-undated-todos-out-of-home.md)と[YDR-046](../decisions/ydr-046-manual-recurrence-todos.md)が部分的に置き換えた。YDR-031が置き換えたのはホームの表示先、YDR-046が置き換えたのは「両方NULLは一回限りTodoだけ」という限定(現在は`manual`も許す)である。NULLペアの扱い、一回限りTodoにおける具体日と未定の往復、未定中は延期を提供しないこと、未定のまま完了できることはYDR-030の記述がそのまま継続する。
  - [YDR-039](../decisions/ydr-039-safe-recurring-todo-edit.md)は[YDR-046](../decisions/ydr-046-manual-recurrence-todos.md)が部分的に置き換えた。置き換えたのは`manual`における編集画面の二分割だけで、保存先の分離・スナップショット・変更履歴・取消と訂正のガードはYDR-039のまま有効である。
  - [YDR-010](../decisions/ydr-010-single-pending-occurrence-per-task-rule.md)と[YDR-017](../decisions/ydr-017-strict-deadline-vs-maintenance-recommended-window.md)は過去の経緯として読む。推奨期間の現在の表示規則は[YDR-034](../decisions/ydr-034-maintenance-home-progress-states.md)。

## 検証方法

```
npm test
npm run test:d1
npm run lint
npm run typecheck
```

「必要になったら繰り返す」方式を変える場合は`src/lib/d1/manual-recurrence.d1-test.ts`(登録・完了・編集・家庭間分離)と`src/lib/d1/manual-recurrence-migration.d1-test.ts`(0027の再作成とDB制約)を先に確認する。メモを変える場合は`src/lib/d1/task-rule-note.d1-test.ts`(保存・引き継ぎ・家庭間分離)と`src/lib/d1/task-rule-note-migration.d1-test.ts`(0028の列追加とDB制約)を先に確認する。登録・編集で共通の入力解釈を変える場合は`tests/todo-calendar-schedule-input.test.ts`(境界値)と`tests/todo-recurrence-shared-input.test.ts`(両actionの受理・拒否と維持した文言の差)を先に確認する。暦計算だけを変える場合は`tests/d1-calendar.test.ts`と`tests/task-schedule.test.ts`、保存や家庭間分離を変える場合は`src/lib/d1/`配下の`*.d1-test.ts`(`todos-authorization`、`recurring-todo-edit`、`interval-recurrence`、`completion-calendar-interval`など)を先に確認する。画面操作の回帰は`e2e/todo-list.spec.ts`、`e2e/todo-edit.spec.ts`、`e2e/todo-completed-detail.spec.ts`で確認する。
