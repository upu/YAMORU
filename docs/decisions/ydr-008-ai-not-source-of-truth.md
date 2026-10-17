---
type: Decision
ydr_id: YDR-008
title: AIを正しさの基盤にしない
description: 周期計算・通知・権限・履歴などの基幹要素にAIを用いず、AIは人が確認できる補助機能に限定する
tags: [yamoru, decisions, ydr]
status: stable
decision_status: Superseded
decision_date: 2026-08-12
superseded_by: YDR-049
---

# YDR-008: AIを正しさの基盤にしない

- 状態: Superseded（AIの用途を候補抽出・検索等の補助へ限定する部分のみ）
- 決定日: 2026-08-12
- 置き換える決定: [YDR-049](ydr-049-conversation-command-boundary.md)。AIを正しさの基盤にしない原則、人が解釈結果を確認できる要件は引き継ぐ。以下は決定当時の記録である。

## 背景

周期計算、通知、権限、履歴は再現可能でなければならず、生成AIの不確実性と相性が悪い。

## 決定

AIは初期版の必須要素にしない。将来導入する場合も、説明書からの候補抽出、型番入力、検索補助など、人が確認できる補助機能に限定する。

## 見直す条件

AIの出力を人が確認する明確なフローと、誤りが基幹データへ直接影響しない設計がある。
