---
type: Decision
ydr_id: YDR-047
title: Todoのメモを実施ごとの記録ではなくTaskRuleの手順として持つ
description: 手順・注意点のメモをOccurrenceではなくTaskRuleへ1列で持ち、プレーンテキストに限り、詳細画面だけで表示する
tags: [yamoru, decisions, ydr, todo]
status: stable
decision_status: Accepted
decision_date: 2026-09-12
---

# YDR-047: Todoのメモを実施ごとの記録ではなくTaskRuleの手順として持つ

- 状態: Accepted
- 決定日: 2026-09-12

## 背景

Todo名だけでは、実施時の手順や注意点、補足情報を残しづらい([Issue #329](https://github.com/upu/YAMORU/issues/329))。コーヒーマシーンの石灰除去手順、作業前に電源を切るといった注意点、使用する消耗品の量やすすぎ回数、申請時の持ち物などが例になる。

特に繰り返しTodoでは毎回同じ作業を行うため、実施するときに確認できる「簡単な説明書」が要る。この情報は「今回の実施で起きたこと」ではなく「このTodoを実施するときに毎回参照すること」である。

一方、YAMORUはOccurrenceを状態、ActivityLogを履歴として分けており([YDR-015](ydr-015-occurrence-state-activitylog-history-safe-undo.md))、Occurrenceを履歴の置き場にしない方針をとっている。

## 決定

- メモはTaskRuleが持つ。`task_rules`へ`note`列(TEXT、NULL可)を1つ追加する。Occurrenceごとのメモは持たない。
- 繰り返しTodoでは、次のOccurrenceも同じTaskRuleを参照するため、メモを引き継ぐためのコピーを行わない。ルールを編集すればその後の実施すべてに反映される。
- メモは`rule_snapshot`([YDR-039](ydr-039-safe-recurring-todo-edit.md))へ含めない。snapshotは「その回が発生した時点の繰り返し条件」を固定して過去回の表示を守るためのもので、メモは過去の記録ではなく現在の手順だからである。完了済みTodoの詳細でも、その時点の文面ではなく現在のメモを表示する。
- メモは複数行のプレーンテキストだけを扱う。Markdown、リッチテキスト、チェックリスト、添付ファイルは追加しない。
- 前後の空白を落とし、空欄・空白だけは「メモ未設定」(NULL)として保存する。空文字はDBのCHECK制約でも拒否し、「未設定」と「空のメモ」を区別しない。
- 上限は1000文字とし、DBのCHECK制約とアプリの入力規則(`src/app/todos/todo-input-limits.ts`)で同じ値を持つ。
- textareaが送るCRLFはLFへそろえてから保存する。文字数の数え方と表示を、入力欄で見えていたものと一致させるため。
- メモはTodo登録画面と編集画面で入力する。繰り返しTodoでは「今後の繰り返し」側で編集する(現在回だけのメモという概念を作らない)。
- 表示はTodo詳細だけとする。ホーム、Todo一覧、管理対象詳細、横断検索には出さない。詳細では他の一行項目と同じdt/ddへ押し込めず、改行を保ったまま読める独立した節に置く。メモ未設定のTodoには節自体を出さない。
- メモはTodoの検索対象にしない。画面内検索・横断検索の対象は引き続きTodo名だけとする([YDR-042](ydr-042-cross-cutting-search.md))。

## 今回決めないこと

- Occurrenceごとの作業メモ・実施記録、ActivityLogへの自由記述。
- Markdown / リッチテキスト、メモ内のチェックリスト、添付ファイル・画像。
- ホームやTodo一覧でのメモ全文表示。

## ロールアウト

`d1/migrations/0028_task_rule_note.sql`は列の追加だけの後方互換なexpand migrationである。migrationは新Workerより先に適用されるが、旧Workerはこの列を読まず、INSERTでも指定しないためNULLのまま挿入でき、これまでと同じ読み書きを続けられる。新Workerを出した後に旧Workerへ戻しても、保存済みのメモが読まれなくなるだけで他の操作は壊れない。削除すべき旧構造・同期処理・暫定制約を残さないため、後続のcontract migrationはない。

## 結果

- 繰り返しTodoに「簡単な説明書」を1か所だけ持たせられ、実施のたびに同じ内容を参照できる。
- メモを直せば以後の実施すべてに反映される。逆に、実施ごとに違う内容を残したい要求はこの仕組みでは満たせない。
- 過去に完了したTodoの詳細も現在のメモを示すため、「当時の手順」を後から読み返すことはできない。

## 見直す条件

- 実施ごとに異なる作業メモ・実施記録を残す必要が確認された場合(Occurrence側へ別の概念として追加する)。
- 当時の手順を後から読み返す必要が確認された場合(`rule_snapshot`へ含めるか、変更履歴を残す)。
- プレーンテキストでは手順を書ききれず、チェックリストや画像が必要だと確認された場合。
