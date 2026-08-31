---
type: Decision
ydr_id: YDR-036
title: ManagedItemの大分類を備品、サービス・契約の2択にする
description: serviceへobligationの役割と既存分類を統合し、家庭向けの大分類を備品とサービス・契約の2択にする
tags: [yamoru, decisions, ydr, managed-item, classification]
status: stable
decision_status: Accepted
decision_date: 2026-08-31
supersedes: YDR-035
---

# YDR-036: ManagedItemの大分類を備品、サービス・契約の2択にする

- 状態: Accepted
- 決定日: 2026-08-31
- 置き換える決定: [YDR-035](ydr-035-retire-other-managed-item-kind.md)

## 背景

[YDR-035](ydr-035-retire-other-managed-item-kind.md)は、大分類`other`を通常の選択肢から外し、ManagedItemを「備品」「サービス」「支払い・手続き」の3択にした。その後の家庭内での分類検討では、税金を家庭が継続して管理する契約関係の一つ、更新手続きを何らかのサービス・契約に伴うTodoや履歴として扱えると整理した。

「サービス」と「支払い・手続き」を分けると、固定資産税、保険、公共料金などを登録するたびに両者の境界を判断する必要がある。大分類は管理上の入口として2択へまとめ、税金や習い事などの具体性は詳しい種類で表す方が家庭向けに分かりやすい。

## 決定

- ManagedItemの有効な大分類と表示ラベルを次の2択にする。

  | code | ラベル |
  |---|---|
  | `asset` | 備品 |
  | `service` | サービス・契約 |

- `service`は、サービス提供、契約、税金や公的支払いなど、家庭が継続して管理する物理的な対象以外の関係を表す大分類へ意味を広げる。
- `obligation`は新規登録・通常の編集で選べない非アクティブな大分類にする。旧Workerや履歴の読み取り互換性に使うマスタ行とcodeは削除しない。
- 詳しい種類`property_tax`（固定資産税）を`obligation`から`service`配下へ移す。既存の`obligation`分類は、プリセットと自由入力のどちらも`service`へ移す。
- ManagedItem本体のIDは変えず、外部リンク、Todo、Occurrence、履歴、関連するConsumableをそのまま保持する。
- `managed_items.kind`は段階移行中の互換列であり、`other`が備品の自由入力にも使われるため、この列だけを根拠に一括更新しない。分類の正本`managed_item_classifications.kind_code`を使う。
- 複合外部キーで結ばれたプリセットと分類を同じmigrationで移すため、D1がmigration向けに提供する[`PRAGMA defer_foreign_keys`](https://developers.cloudflare.com/d1/sql-api/foreign-keys/#defer-foreign-key-constraints)を使い、migration終了時に外部キーが整合するようにする。
- 大分類`other`、詳しい種類の「その他（自由入力）」、別ライフサイクルのConsumableに関するYDR-035の判断は維持する。
- 適用済みmigrationは書き換えず、追加の連番migrationを使う。preview / productionへの手動適用はこのIssueでは行わない。

## 結果

- 登録・編集時の大分類は「備品」「サービス・契約」の2択になり、サービスと支払い・手続きの境界を判断せずに済む。
- 固定資産税は「サービス・契約」の詳しい種類として登録・編集できる。
- 更新手続きは、対象となるサービス・契約に関連するTodoや履歴として記録できる。
- 既存の`obligation`分類を持つManagedItemと関連データを失わず、新しい2分類へ揃えられる。

## 見直す条件

- 「サービス・契約」へ税金や公的支払いを含めることが、家庭内利用で繰り返し理解されない場合。
- 物理的な対象以外を一つにまとめることで、開始時期や一覧表示などに異なる操作が必要になる場合。
- 非アクティブな`obligation`を参照する互換処理を安全に削除できる段階になった場合。
