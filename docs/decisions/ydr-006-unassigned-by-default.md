---
type: Decision
ydr_id: YDR-006
title: 担当者未設定を既定にする
description: 新しいTodoは担当者未設定を既定にし、担当は任意設定・履歴記録のみとする
tags: [yamoru, decisions, ydr]
status: stable
decision_status: Accepted
decision_date: 2026-08-12
---

# YDR-006: 担当者未設定を既定にする

- 状態: Accepted
- 決定日: 2026-08-12

## 背景

担当者の割り当てが、家事の催促や責任追及として受け取られる可能性がある。YAMORUの目的は家族の評価ではなく、記憶と引き継ぎを助けることである。

## 決定

- 新しいTodoは担当者未設定、つまり「誰でも可」を既定にする。
- 担当者を任意で設定できる。
- TaskRuleには既定担当者を持たせず、担当はTaskOccurrence単位の任意項目にする。
- 実際に完了した人は履歴へ記録する。

## 見直す条件

- 家庭内利用で、担当の不明確さが継続的な問題になる。
