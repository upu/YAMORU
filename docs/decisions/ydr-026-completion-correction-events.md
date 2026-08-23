---
type: Decision
ydr_id: YDR-026
title: 実施記録の訂正を追記型の訂正イベントとして記録し、有効値を読み取り時に解決する
description: completion_correctionsという別テーブルへ実施日時・実施者の訂正を追記し、元のactivity_logs(completed)行は書き換えない。有効な実施日時・実施者は読み取り時に相関サブクエリで解決する
tags: [yamoru, decisions, ydr, todo, history]
status: stable
decision_status: Accepted
decision_date: 2026-08-23
---

# YDR-026: 実施記録の訂正を追記型の訂正イベントとして記録し、有効値を読み取り時に解決する

- 状態: Accepted
- 決定日: 2026-08-23

## 背景

[Issue #148](https://github.com/upu/YAMORU/issues/148)は、完了記録の実施日時・実施者を後から訂正できるようにするものである。YAMORUは完了履歴を上書きしない原則を持ち、[YDR-015](ydr-015-occurrence-state-activitylog-history-safe-undo.md)は「ActivityLogは追記型履歴」「完了取消は次回Occurrenceが未変更の場合だけ許可する」ことを既に定めている。YDR-015の「見直す条件」は「複数段階の訂正や、任意の過去完了を取り消す必要が実運用で確認された場合」であり、本Issueはこれに該当する。ただし取消の仕組み自体(YDR-015)は変更しない。訂正は取消とは別の操作として追加する。

Issueの設計メモは「案1(推奨): 元の完了記録を参照する訂正イベントを追加し、有効な実施日時・実施者を読み取り時に解決する」を挙げていた。この方式自体は採用するが、訂正イベントをどこへ記録するかは検討が必要だった。

## 検討した案

- **案1(採用): `completion_corrections`という新しいテーブルへ、訂正イベントを追記する。** `activity_logs`の`action`列は`CHECK (action IN ('completed', 'completion_undone', 'postponed', 'skipped', 'assignee_changed'))`という列挙制約を持つ。SQLiteはALTER TABLEでCHECK制約を直接変更できず、変更にはテーブル再作成(新テーブル作成・データコピー・旧テーブル削除・索引再作成)が必要になる。`activity_logs`は家族の実施履歴を保持する中心テーブルであり、productionには家庭の実データが入っているため、この再作成に伴うリスクを避ける。純粋な`CREATE TABLE`は既存データ・制約に触れないため安全である。
- 案2: `activity_logs`へ新しいaction値(例: `completion_corrected`)を追加し、テーブルを再作成してCHECK制約を拡張する。データモデルは単純になるが、production上の`activity_logs`テーブルを再作成する必要があり、移行中の不整合・ロールバック困難のリスクが、本Issueの価値に見合わない。
- 案3: 元の`activity_logs(completed)`行自体を`UPDATE`で書き換える。YAMORUの「完了履歴を上書きしない」原則、[YDR-015](ydr-015-occurrence-state-activitylog-history-safe-undo.md)の「ActivityLogは追記型履歴」と直接矛盾するため不採用。

## 決定

### テーブルとデータモデル

- `completion_corrections`テーブルを追加する(`d1/migrations/0004_completion_corrections.sql`)。
- 1行が1回の訂正を表す。`completed_activity_log_id`で対象の完了記録(`activity_logs.action='completed'`の行)を参照し、`previous_occurred_at`/`new_occurred_at`(実施日時訂正)または`previous_performed_by_user_id`/`new_performed_by_user_id`(実施者訂正)のどちらか一方だけを設定する(CHECK制約`((new_occurred_at IS NOT NULL) + (new_performed_by_user_id IS NOT NULL)) = 1`で強制)。
- `new_performed_by_user_id`は`activity_logs.performed_by_user_id`と同じ複合外部キー(`household_id`込み)で、同じ家庭のメンバーだけを許可する([YDR-020](ydr-020-assignee-performer-actor.md))。
- 元の`activity_logs(completed)`行は一切`UPDATE`しない。訂正・取消のいずれも追記だけで表現する。

### 有効値の解決

- 「現在有効な実施日時・実施者」は、対象の`completed_activity_log_id`に対する最新の訂正(`corrected_at DESC, id DESC`)を、日時訂正・実施者訂正それぞれ独立に相関サブクエリで引き、なければ元の`activity_logs`の値へフォールバックして求める。
- この解決は読み取りのたびに行う(専用のキャッシュ列は持たない)。ホーム(`lib/d1/home.ts`)・管理対象詳細(`lib/d1/managed-items.ts`)・訂正自体の書き込み(`lib/d1/todos.ts`の`resolveEffectiveCompletion`)の3箇所で同じ考え方の相関サブクエリを使う。

### 次回Occurrenceの再計算

- 実施日時の訂正は、完了日基準・定例日基準で自動生成された次回Occurrenceが**一度も操作されていない**場合だけ、訂正と同じトランザクションで`scheduled_for`/`due_at`を再計算する。判定条件はYDR-015の完了取消と同じ「次回Occurrenceにactivity_logsが一件もない」を使う。
- 次回Occurrenceに延期・担当変更・完了などの操作が一件でもあれば、訂正自体を拒否し、元のデータを一切変更しない。「暗黙に上書きしない」というIssueの前提を、取消と同じ安全側の判定で満たす。
- 実施者の訂正はスケジューリングに影響しないため、次回Occurrenceの再計算は行わない。

### 冪等性・家庭境界

- `completion_corrections`は`activity_logs`と同じ`UNIQUE (household_id, idempotency_key)`パターンを持つ。同じ冪等性キーの再送は同一Occurrenceに対してだけ黙って成功し、別Occurrenceへの使い回しは拒否する(既存の完了・取消と同じ契約)。
- すべてのデータアクセスはセッションから導出した`household_id`で絞り込む(既存の`loadOccurrence`・`requireHouseholdUser`をそのまま再利用する)。

## 結果

- `activity_logs`テーブルのスキーマ・制約・既存データは変更しない。
- `lib/d1/todos.ts`に`correctCompletionOccurredAt`・`correctCompletionPerformer`を追加する。両者とも`undoTaskCompletion`と同じ「条件をすべて最初のINSERTのWHERE句へ埋め込む」原子性パターンを踏襲する。
- ホーム・管理対象詳細の「最近の実施」「直近の完了」「最終実施」表示は、有効な(訂正済みなら訂正後の)実施日時・実施者を表示する。
- 「最近の実施」の操作は「取消」から「修正」(実施日時の訂正・実施者の訂正・完了の取消を選べる)へ変わる。取消自体の処理は変更しない。

## 見直す条件

- 日時・実施者以外の項目(Todo名、繰り返しルールなど)を訂正する必要が生じた場合。本YDRは実施日時・実施者だけを対象とする。
- 訂正履歴を監査・一覧表示する画面が必要になった場合。本Issueは「管理者だけが履歴を監査する画面」を明示的に対象外としている。
- 複数の訂正をまとめて行う一括編集が必要になった場合。
