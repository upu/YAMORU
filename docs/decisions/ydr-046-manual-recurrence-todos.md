---
type: Decision
ydr_id: YDR-046
title: 必要になったら繰り返すTodoを予定日未定Occurrenceの連鎖として表す
description: 実施時期を暦から決められない繰り返し作業をrecurrence_basis = 'manual'として追加し、予定日未定のOccurrenceを完了のたびに1件ずつ作る。YDR-030の「NULLペアは一回限りTodoだけ」と、YDR-039の編集画面の二分割だけをmanualについて置き換える
tags: [yamoru, decisions, ydr, todo]
status: stable
decision_status: Accepted
decision_date: 2026-09-12
supersedes: [YDR-030, YDR-039]
---

# YDR-046: 必要になったら繰り返すTodoを予定日未定Occurrenceの連鎖として表す

- 状態: Accepted
- 決定日: 2026-09-12
- 置き換える決定:
  - [YDR-030](ydr-030-undated-one-time-task-occurrences.md)(「両方NULLを許すのは`recurrence_basis = 'once'`のTaskRuleに属するOccurrenceだけ」という限定のみ。NULLペアの持ち方、一回限りTodoにおける具体日と未定の往復、日付未定中は延期を提供しないこと、未定のまま完了できること、二種類の一意制約の扱いは変更しない)
  - [YDR-039](ydr-039-safe-recurring-todo-edit.md)(「編集画面を『今回の予定』と『次回以降の繰り返し』へ分けて保存する」という点のみ、manualに限って置き換える。保存先の分離、現在回のスナップショット更新、変更履歴、完了取消・実施日訂正のガードはすべてYDR-039のまま維持する)

## 背景

コーヒーマシーンの石灰除去のように、実施時期をYAMORU側では決められず、本体の通知や消耗の合図で必要になるメンテナンスがある([Issue #325](https://github.com/upu/YAMORU/issues/325))。空気清浄機のフィルター通知、浄水器の交換ランプ、プリンターの消耗品警告も同じ形である。

この種の作業は一度きりではなく繰り返し発生するが、既存の三つの繰り返し方式はいずれも暦から次回を決める。完了日基準([YDR-038](ydr-038-completion-calendar-intervals.md))、固定間隔([YDR-037](ydr-037-fixed-interval-recurrence.md))、定例日基準([YDR-021](ydr-021-recurring-calendar-rules.md))のどれに当てはめても、実際のタイミングとずれた予定日が残り続ける。

一回限りTodoとして予定日未定で登録すれば仮の日付は避けられるが([YDR-030](ydr-030-undated-one-time-task-occurrences.md))、完了のたびに次回分を手作業で作り直す必要がある。

YDR-030は見直す条件として「繰り返しTodoにも実施時期未定が必要になった」場合を挙げている。本決定はその条件に当たる。

## 決定

- 新しい繰り返し方式`recurrence_basis = 'manual'`(利用者向けの呼び名は「必要になったら繰り返す」)を追加する。
- manualのTaskRuleは`deadline_kind = 'strict'`、推奨期間のoffsetは0、定例日指定・固定間隔の列はすべてNULLとする。条件として持つのはTodo名と関連する管理対象だけである。
- 両方NULLの`scheduled_for` / `due_at`を許すのは、`recurrence_basis`が`'once'`または`'manual'`のTaskRuleに属するOccurrenceに限る(YDR-030の限定をここだけ広げる)。
- manualのOccurrenceは常に予定日未定とする。一回限りTodoと違い、具体日と未定を往復しない。予定日の設定も延期も提供しない。
- 登録時に予定日未定のpending Occurrenceを1件だけ作る。先の回はまとめて作らない([YDR-016](ydr-016-no-backfill-on-per-occurrence-mode.md))。
- 完了すると、同じTaskRuleから次の予定日未定Occurrenceを1件だけ作る。完了の記録・冪等性・完了取消の扱いは、日付を持つ繰り返し方式と同じ([YDR-014](ydr-014-unique-constraints-and-conditional-update.md)、[YDR-015](ydr-015-occurrence-state-activitylog-history-safe-undo.md))。
- manualのTodoをホームのどの区分にも表示しない。予定日未定Todoをホームから外す規則([YDR-031](ydr-031-undated-todos-out-of-home.md))をそのまま適用する。
- すべてのTodo一覧(`/todos`)、Todo詳細、関連する管理対象の詳細には表示する。一覧では日付があるTodoの後ろへ置く。
- 一覧・カードのバッジは「必要時」とし、一回限りTodoの「未定」と区別する。「未定」は日付がまだ決まっていない状態、「必要時」は日付を決めない方式そのものを指す。
- `waiting`のような新しいTodo状態は追加しない。予定日未定であることは、これまでどおり`scheduled_for`と`due_at`がNULLであることで表す(YDR-030・YDR-031の見直し条件のまま)。
- 繰り返し方式そのものの変更は、既存の方式と同じく提供しない。
- manualのTodoの編集は、一つの画面・一つの保存で行う。Todo名、関連する管理対象、担当をまとめて変更する。

## YDR-039との関係

[YDR-039](ydr-039-safe-recurring-todo-edit.md)は、繰り返しTodoの編集画面を「今回の予定」(TaskOccurrenceの担当と現在期限`due_at`)と「次回以降の繰り返し」(TaskRuleの名前、関連ManagedItem、同じ方式内の条件)へ分けて保存すると定めている。この二分割は、ルールの編集が現在回の予定を動かしていないことを利用者が確かめられるようにするためのものであり、同項は対象の方式として`calendar`、`completion`、`interval`を挙げている。

manualは`due_at`も繰り返し条件も持たない。分割すると「今回の予定」側に残るのは担当だけになり、しかも担当はTodo詳細の担当パネルからその場で変更できる([YDR-020](ydr-020-assignee-performer-actor.md)、[Issue #392](https://github.com/upu/YAMORU/issues/392))。つまり分割しても空に近い半分ができるだけで、動いていないことを確かめる対象が存在しない。そこでmanualに限り、一つの画面・一つの保存で編集する。

置き換えるのは画面の分割だけである。次の点はYDR-039のまま維持する。

- 保存先の分離。担当はTaskOccurrence、名前・関連ManagedItem・メモはTaskRuleへ保存する。
- 現在回の`rule_snapshot`を新しい値へそろえ、過去の完了回のスナップショットは更新しない。
- TaskRuleの変更を`task_rule_changes`へ追記する。
- 完了により生成された次回OccurrenceへTaskRule変更が記録された後は、元Occurrenceの完了取消と実施日訂正を拒否する。

## 今回決めないこと

- 過去の実施間隔から次回時期を予測すること。
- 「前回からそろそろ○か月」のような、間隔にもとづく再確認の案内。
- 外部機器からYAMORUへの自動連携。

## データベース上の扱い

- `task_rules.recurrence_basis`のCHECK制約へ`'manual'`を足し、方式ごとの列の組み合わせを表す複合CHECK制約へmanualの分岐を足す。SQLiteはCHECK制約の列挙をALTER TABLEで拡張できないため、`d1/migrations/0027_manual_recurrence.sql`で0023と同じ手順によりtask_rulesと子孫テーブルを作り直す。
- 予定日未定を許す方式を照合するトリガーを`'once'`から`('once', 'manual')`へ広げる。
- 逆向きの不変条件(manualのOccurrenceが日付を持たないこと)を、Occurrenceの INSERT・UPDATE と、TaskRuleの方式変更の三経路でトリガーが守る。
- `(task_rule_id, scheduled_for)`の一意制約はNULL同士を重複とみなさないため、未解決Todoを1件に保つのは`status = 'pending'`の部分一意インデックスである(YDR-030と同じ)。

## ロールアウト

migrationは新Workerより先に適用される。追加は許可の拡張だけなので、適用直後の旧Workerはこれまでと同じ読み書きを続けられる。manualの行が現れるのは新Workerがproductionへ出た後だけである。

その後に旧Workerへ戻した場合、旧Workerはmanualを未知の`recurrence_basis`として扱い、Todo一覧の表示と完了で明示的に失敗する。0016で`'interval'`を追加したときと同じ扱いとし、誤った日付を黙って作らせないことを優先する。

この性質は承知のうえで受け入れる。判断の根拠は次のとおり。

- [データベースに影響する変更の手順](../references/database-change-playbook.md)が求めるexpand-firstは、migrationが適用時点で現行Workerと互換であることである。0027はCHECK制約の緩和とトリガー条件の拡張だけなので、これを満たす。新しい列挙値を旧Workerが読めることまでは求めていない。
- 影響を受けるのはmanualのTodoを作った家庭だけで、対象はTodo一覧の表示と完了に限られる。データは壊れず、新Workerへ戻せば復旧する。
- 0018の`completion_calendar_version`のようなロールアウトガードは、旧Workerが誤った日付を黙って作ることを防ぐためのものである。今回は旧Workerが黙って誤らず明示的に失敗するため、同じ形のガードは効かない。

先に互換Workerを出し、後続のreleaseで作成を有効にする二段階リリースは採らない。互換Workerにmanualの読み取りと完了を実装したうえで作成UIだけ伏せることになり、個人リポジトリの試作段階で踏む手順として重い。

## 結果

- 本体側が通知する作業を、無理な周期を設定せずに繰り返し管理できる。
- 完了のたびに次回分を手作業で作り直す必要がなくなり、実施履歴も1本の連なりとして残る。
- ホームは「いま対応すること」に絞られたままになる。manualのTodoの再発見は、予定日未定Todoと同じくTodo一覧の役割に依存する。
- 予定日未定Todoに二つの意味(日付が未決定 / 日付を決めない方式)が同居するため、画面ではバッジと補足で区別する必要がある。

## 見直す条件

- ホームやTodo一覧を開く習慣では足りず、manualのTodoが長期間放置される事例が家庭内で確認された場合。
- 過去の実施間隔から「そろそろ」を案内する必要が確認された場合。
- 予定日以外の待機理由(依存関係、外部からの合図など)を状態として区別する必要が確認された場合(YDR-030の見直し条件と同じ)。
