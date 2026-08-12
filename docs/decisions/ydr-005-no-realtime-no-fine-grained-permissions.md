---
type: Decision
ydr_id: YDR-005
title: Realtimeと細かな権限区別をMVPで作らない
description: リアルタイム同期と、Owner/Memberなどの細かな権限区別をMVPでは実装しない
tags: [yamoru, decisions, ydr]
status: stable
decision_status: Accepted
decision_date: 2026-08-12
---

# YDR-005: Realtimeと細かな権限区別をMVPで作らない

- 状態: Accepted
- 決定日: 2026-08-12

## 背景

家庭内の更新頻度は低く、Realtimeの接続管理や競合処理に見合わない。自宅専用の初期版では、Owner / Memberなどの細かな権限も必要性が確認されていない。

## 決定

- アプリ表示時、フォーカス復帰時、明示的な再読み込みで最新データを取得する。
- 家庭メンバー全員が編集可能とする。
- household_idとRLSによる家庭間の分離は必須とする。

## 見直す条件

- 同時編集や即時反映が必要な具体的なユースケースが家庭内で発生する。
- 子どもや家庭外ユーザーなど、権限制御が必要な利用者を扱う。
