---
type: Decision
ydr_id: YDR-002
title: Phase 1に最小限の管理対象を残す
description: 名前・種類・外部リンクだけを持つ最小限のManagedItemをPhase 1に含める
tags: [yamoru, decisions, ydr]
status: stable
decision_status: Accepted
decision_date: 2026-08-12
---

# YDR-002: Phase 1に最小限の管理対象を残す

- 状態: Accepted
- 決定日: 2026-08-12

## 背景

Todoだけに絞ると短期間では作りやすいが、YAMORUが一般的な定期Todoアプリとどう違うかを検証できない。中核は、家電などの対象と、Todo、リンク、履歴がつながることにある。

## 決定

Phase 1にも、名前、種類、外部リンクだけを持つ最小限の`ManagedItem`を含める。PDF、写真、在庫などは含めない。

## 結果

- 猫の浄水器の詳細から、関連Todoと「最後にいつ、誰が」を確認できる。
- 台帳登録の心理的負担を最小限に保つ。
- AssetとObligationはMVPでは`ManagedItem.kind`で区別する。

## 見直す条件

- 物理的な家電と契約・税金で、異なる制約や画面が実運用上必要になった。
