---
type: Decision
ydr_id: YDR-027
title: メンテナンス推奨期間の「そろそろ」表示を進捗率80%から開始する
description: 推奨期間内(そろそろ)の開始条件を、推奨開始日と同時ではなく、推奨開始日から推奨上限日までの経過が80%に達した暦日からにする。YDR-017の該当箇所を部分的に置き換える
tags: [yamoru, decisions, ydr, todo, maintenance]
status: stable
decision_status: Accepted
decision_date: 2026-08-23
supersedes: YDR-017
---

# YDR-027: メンテナンス推奨期間の「そろそろ」表示を進捗率80%から開始する

- 状態: Accepted
- 決定日: 2026-08-23
- 置き換える決定: [YDR-017](ydr-017-strict-deadline-vs-maintenance-recommended-window.md)(「推奨期間内(`scheduled_for <= now <= due_at`)」という開始条件のみ。`deadline_kind`による`strict`/`maintenance`の区別、`strict`の期限切れ表示、`scheduled_for`/`due_at`の意味は変更しない)

## 背景

[YDR-017](ydr-017-strict-deadline-vs-maintenance-recommended-window.md)は、メンテナンスTodoの表示を「推奨期間前」「推奨期間内(`scheduled_for <= now <= due_at`、そろそろ)」「推奨期間の上限超過」の3状態に分け、推奨期間に入った直後から利用者を急かさないようにした。

[Issue #52](https://github.com/upu/YAMORU/issues/52)は、この「推奨期間内」の開始条件自体をさらに緩め、推奨期間に入った初日からではなく、推奨開始日から推奨上限日までの進捗率が80%に達してから初めて「そろそろ」と案内するよう変更するものである。期限切れ・今日・近日といった固定区分だけでなく、Todo自身の推奨期間に対する進み具合を使うことで、家庭内で余裕をもって着手しやすくする。

## 決定

- YDR-017が定めた3状態(`before-window` / `in-window` / `past-window`)の名称・`deadline_kind`による`strict`/`maintenance`の区別・`scheduled_for`/`due_at`の意味は変更しない。
- 「推奨期間内(`in-window`)」の開始条件だけを、`now >= scheduled_for`から、`now >= scheduled_for`かつ経過日数が推奨期間全体の80%以上、へ置き換える。
- 進捗率は暦日単位で判定する。`totalDays = due_at - scheduled_for`(暦日数)、`elapsedDays = now - scheduled_for`(暦日数)とし、`elapsedDays >= ceil(totalDays * 0.8)`のとき`in-window`とする。切り上げにより、ちょうど80%に達する日を含める。
- `scheduled_for`と`due_at`が同日(`totalDays <= 0`)の場合はゼロ除算せず、しきい値を0とする。この場合、開始日(=上限日)の当日から即座に`in-window`になる。
- `due_at`を過ぎたら`past-window`とする条件(YDR-017の上限超過)は変更しない。`past-window`は`in-window`より優先して表示される(既存の状態遷移順序を維持)。
- 80%はまず固定のプロダクト規則とし、家庭やTaskRuleごとの設定化は実需要が確認されてから検討する。
- 実装は`app/task-schedule.ts`の`maintenanceReminderThresholdDays(totalDays)`(タイムゾーン非依存の日数計算)を正本とし、`app/time-zone.ts`の`getMaintenanceDisplayStateFromIso`(Asia/Tokyoの暦日でホーム・ManagedItem詳細の両方から呼ばれる、YDR-017が既に定めた「画面ごとに判定を複製しない」方針)がこれを呼び出す。ローカルDateを使うレガシーな`getMaintenanceDisplayState`(`app/task-schedule.ts`)も同じ関数を使い、実装がずれないようにする。

## 結果

- 推奨期間に入った直後(0%〜80%未満)は「予定」として表示され、急かさない。
- 推奨期間の終盤(80%〜100%)だけが「そろそろ」として中立的に案内される。
- ホームとManagedItem詳細は同じ`getMaintenanceDisplayStateFromIso`を呼ぶため、判定結果は常に一致する。
- YDR-017の「推奨期間内(`scheduled_for <= now <= due_at`)」という境界条件の記述は、本YDRにより置き換えられる。YDR-017のそれ以外の決定(`deadline_kind`の区別、`strict`の期限切れ表示、`scheduled_for`/`due_at`の意味)は変更されない。

## 見直す条件

- 80%という固定しきい値について、家庭ごと・TaskRuleごとに調整したいという実需要が確認された場合。
- 推奨期間の途中に「そろそろ」以外の新しい中間状態を追加する必要が確認された場合。
