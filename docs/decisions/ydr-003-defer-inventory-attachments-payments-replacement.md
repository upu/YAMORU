---
type: Decision
ydr_id: YDR-003
title: MVPから在庫・添付・支払い・買い替えを外す
description: 在庫、ファイル添付、支払い、買い替えを初期の家庭共有MVPから外し、後続のPhaseで順番に追加する
tags: [yamoru, decisions, ydr]
status: stable
decision_status: Accepted
decision_date: 2026-08-12
---

# YDR-003: MVPから在庫・添付・支払い・買い替えを外す

- 状態: Accepted
- 決定日: 2026-08-12

## 背景

これらはYAMORUの将来像には必要だが、最初の価値である「いつ、誰が行ったか」と定期Todoの検証に必須ではない。初期MVPへ含めると、複数のデータモデル、Storage、トランザクション、追加UIが必要になる。

## 決定

最初の家庭共有MVPから外し、中核体験の継続利用が確認された後に順番に追加する。

## 結果

- 外部リンクは残すが、ファイルアップロードは後回しにする。
- 在庫は独立したPhaseとして追加する。
- 支払いと買い替えはさらに後のPhaseとする。

## 見直す条件

- 家庭内運用で、対象機能がないために同じ問題が繰り返し発生する。
