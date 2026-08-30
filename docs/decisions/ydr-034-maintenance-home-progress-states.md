---
type: Decision
ydr_id: YDR-034
title: メンテナンスTodoを推奨期間の進み具合に応じた4状態でホームへ表示する
description: 推奨開始日からホームへ表示し、80%以降と推奨上限超過を段階的に強く案内する。YDR-027の80%しきい値を維持しつつ3状態分類とホーム表示先を置き換える
tags: [yamoru, decisions, ydr, todo, maintenance]
status: stable
decision_status: Accepted
decision_date: 2026-08-30
supersedes: YDR-027
---

# YDR-034: メンテナンスTodoを推奨期間の進み具合に応じた4状態でホームへ表示する

- 状態: Accepted
- 決定日: 2026-08-30
- 置き換える決定: [YDR-027](ydr-027-maintenance-reminder-progress-ratio.md)(80%を「そろそろ」の開始とする規則は維持する。推奨開始日から80%未満を`before-window`としてホームから外していた3状態分類と、ホームの表示先だけを置き換える)

## 背景

[YDR-027](ydr-027-maintenance-reminder-progress-ratio.md)は、推奨期間に入った直後から利用者を急かさないため、推奨期間の80%を経過するまでを`before-window`、80%以上を`in-window`としていた。ホームは`before-window`を表示しないため、推奨期間の開始後でも80%未満のTodoを「いま対応すること」から確認できなかった。

家庭内利用では、8月28日から8月31日を推奨期間とする未完了Todoが、8月30日のホームに表示されなかった([Issue #281](https://github.com/upu/YAMORU/issues/281))。3暦日の80%しきい値は切り上げで3日となるため、表示開始が上限日の8月31日になる。推奨開始日から上限日までは実施してよい期間であり、開始後のTodoをホームで見つけられない挙動は利用者の期待と合わなかった。

一方、推奨期間の開始直後と終盤を同じ強さにすると、YDR-027が避けようとした早期の急かし表示へ戻る。ホームへの掲載時期と案内の強さを分け、開始日から控えめに表示し、80%以降だけ一段強く案内する。

## 決定

- メンテナンスTodoをAsia/Tokyoの暦日で次の4状態に分ける。
  - 推奨期間前(`before-window`): `today < scheduled_for`。ホームには表示せず、Todo一覧とManagedItem詳細では次回予定として確認できる。
  - 推奨期間(`in-window`): `scheduled_for <= today < reminder_start`。ホームへ表示し、「推奨期間」のバッジと控えめなトーンで案内する。
  - そろそろ(`reminder-window`): `reminder_start <= today <= due_at`。ホームへ表示し、「そろそろ」のバッジと一段強いトーンで案内する。
  - 推奨期間超過(`past-window`): `due_at < today`。ホームへ表示し続け、「推奨期間超過」のバッジと注意トーンで案内する。
- `reminder_start`はYDR-027の規則を維持し、`scheduled_for + ceil((due_at - scheduled_for) * 0.8)`とする。開始日と上限日が同日の場合はしきい値を0とし、当日から`reminder-window`とする。
- 推奨期間超過は厳密な期限の「期限切れ」と呼ばない。`deadline_kind = 'strict'`の期限切れと、`deadline_kind = 'maintenance'`の推奨上限超過を画面上でも区別する。
- ホームの区分名は、開始直後のTodoも含むため「そろそろ」から「メンテナンス」へ変更する。
- ホームのメンテナンス区分では、`past-window`、`reminder-window`、`in-window`の順に並べ、同じ状態では推奨上限日の早いものを先にする。
- 担当者未設定(誰でも可)は表示状態に影響させない。担当者設定済みと同じ日付規則を使う。
- HomeとManagedItem詳細は、同じ`getMaintenanceDisplayStateFromIso`を使う。画面ごとに境界やしきい値を複製しない。
- `scheduled_for`を推奨開始、`due_at`を推奨上限とする意味、`deadline_kind`、Asia/Tokyoの暦日判定、80%の固定しきい値は変更しない。

## YDR-027との関係

YDR-027が決めた「80%以降をそろそろと案内する」規則と、暦日差・切り上げ・同日範囲の計算は維持する。本決定が置き換えるのは、80%未満を推奨期間前と同じ`before-window`にまとめる3状態分類と、そのためホームに表示しない扱いである。

## 結果

- 推奨期間に入ったTodoは、80%未満でもホームから見つけて実施できる。
- 推奨期間の開始直後は控えめに、終盤は「そろそろ」、上限超過は「推奨期間超過」と、急かしすぎずに優先度を伝えられる。
- メンテナンスの推奨期間超過を、税金・支払いなどの厳密な期限切れと混同しない。
- HomeとManagedItem詳細の表示状態が同じTokyo暦日境界で一致する。

## 見直す条件

- 80%という固定しきい値を家庭またはTodoごとに調整したい実需要が確認された場合。
- 推奨期間超過からさらに長期間経過したTodoを、別の強さで案内する必要が確認された場合。
- ホームのメンテナンス区分が増え、状態ごとに区分を分ける必要が確認された場合。
