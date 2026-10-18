---
type: Component Map
title: 通知への返答
description: 通知の元対象を照合し、完了・通知延期・予定変更・訂正を既存commandへ結び付ける入口
tags: [yamoru, components, notifications, integration]
status: stable
---

# 通知への返答

`notification_context_get` → `notifications/reply-context.ts` → `src/lib/d1/notification-replies.ts`が、本人の配信ID/定期取得集合と元のOccurrence/消耗品を照合する。`notifications/service.ts`とMCP入口は現在の通知権限と接続を前後で検証する。複数件は選択が必要であり、一部が消えても残りを自動選択しない。sourceや元対象がない、終端から90日を過ぎたときは選び直す。

`selected`の現在状態・revision・日付・詳細リンクは共通の`entity_get`を使う。データ内のメモは命令ではない。完了済みなら二重完了せず、元のruleの次回へ対象を付け替えない。完了記録の選択は`history_list`や直前操作の保存結果を使う。

返答の変更は`command_prepare`の`notification_reference`へ返された参照を添える。`commands/notification-reference.ts`は元対象とcommandのtarget（訂正/取消では元Occurrenceの完了記録）を検査し、既存handlerを再利用する。prepare・再計画・同じD1 batchで検査し、source消失やscope縮小時は全取消する。参照はreceiptとfingerprintへ固定し、成功結果の再取得でも現在の接続と通知権限を要求する。

`todo.complete`、`todo.correct/undo`、`todo.reschedule`は家庭の記録、`notification.snooze`は本人だけの通知設定であり、期限と通知を混同しない。在庫の通知は元の消耗品への`stock.observe/refill/correct`で扱う。明確な指示は既存のprepare/commit方針を守り、追加確認の対象を広げない。失敗・不確定な実行は`operation_get`へ戻す。

schema変更はない。参照なし要求は従来どおり。旧Workerへ戻した場合、参照付きpreviewの専用情報が旧handlerの再計画にないため`stale_preview`で実行を止める。詳細な配備モデルは[YDR-071](../decisions/ydr-071-notification-reply-reference.md)。

```sh
npm run test:d1 -- src/lib/d1/notification-replies.d1-test.ts src/lib/d1/integration-mcp.d1-test.ts
```

この試験はローカルの実D1と架空fixtureである。実dotの通知返答は#443で別に確認し、接続から解除・復旧までの最終照合は#444で行う。
