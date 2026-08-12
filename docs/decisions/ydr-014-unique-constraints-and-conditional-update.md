---
type: Decision
ydr_id: YDR-014
title: 二種類の一意制約と条件付き更新で重複完了を防ぐ
description: 一意制約と部分一意制約、pending状態への条件付き更新の組み合わせで重複完了を防ぐ
tags: [yamoru, decisions, ydr]
status: stable
decision_status: Accepted
decision_date: 2026-08-12
---

# YDR-014: 二種類の一意制約と条件付き更新で重複完了を防ぐ

- 状態: Accepted
- 決定日: 2026-08-12

## 背景

冪等性キーだけでは、家族二人が別の端末から同じTodoを同時に完了する競合を防げない。アプリの事前確認だけに頼ると、完了履歴や次回Todoが二重に作られる可能性がある。

## 決定

- 同じ予定枠の重複を、`(task_rule_id, scheduled_for)`の一意制約で防ぐ。
- 「1件を持ち越す」の未解決Todo重複を、`status = 'pending'`の行に対する`task_rule_id`の部分一意制約で防ぐ。
- 完了処理は`pending`状態のOccurrenceだけを条件付きで更新する。
- 条件付き更新に成功した要求だけが、完了ActivityLogと次回Occurrenceを同じトランザクションで作る。
- 同じクライアント要求の再送には、別途冪等性キーを使う。

## 結果

同じ要求の再送と、異なる端末からの同時完了の両方をデータベース側で防げる。

## 見直す条件

将来「回ごとに残す」方式を導入するときは、未解決Todoの部分一意制約を方式ごとに適用できる形へ変更する。
