---
type: Decision
ydr_id: YDR-007
title: 通知を長期間実機検証し、結果だけでネイティブ化しない
description: PWA Pushなどの通知手段を家族の実機で長期間検証し、Push到達性の成否だけでネイティブ化を判断しない
tags: [yamoru, decisions, ydr]
status: stable
decision_status: Superseded
decision_date: 2026-08-12
superseded_by: YDR-009
---

# YDR-007: 通知を長期間実機検証し、結果だけでネイティブ化しない

- 状態: Superseded by [YDR-009](ydr-009-drop-notifications-consolidate-home.md)
- 決定日: 2026-08-12

## 背景

通知はYAMORUの価値に重要だが、PWA Pushの到達性は端末や利用状況の影響を受ける。短期間の送信成功だけでは、家庭内運用に耐えるか判断できない。一方、Pushの問題だけでネイティブアプリへ移ると開発規模が大きくなる。

## 決定

- 家族の実機で少なくとも4週間、できれば月次周期をまたぐ6〜8週間検証する。
- 再起動、OS更新、長期間未使用なども確認する。
- 検証はPhase 1の開発と並行し、完了まで全開発を止めない。
- PWA Push、メール、カレンダー連携、アプリ内表示を比較する。
- Push通知の成否だけでネイティブ化を決めない。

## 見直す条件

- 軽量な代替通知を含めても、家庭内で期限を忘れる問題を解決できない。
- ウィジェット、オフライン、OS統合など複数の理由でネイティブ化の価値が高くなった。

この決定は、通知自体を初期スコープから外す[YDR-009](ydr-009-drop-notifications-consolidate-home.md)によって置き換えられた。過去に検討した経緯を残すため、記録は削除しない。
