---
type: Decision
ydr_id: YDR-035
title: ManagedItemの大分類を備品、サービス、支払い・手続きの3択にする
description: assetの表示名を備品へ変更し、otherを通常の選択肢から外す。Consumableと詳しい種類の自由入力は別概念として維持する
tags: [yamoru, decisions, ydr, managed-item, classification]
status: stable
decision_status: Superseded
decision_date: 2026-08-31
supersedes: YDR-029
superseded_by: YDR-036
---

# YDR-035: ManagedItemの大分類を備品、サービス、支払い・手続きの3択にする

- 状態: Superseded by [YDR-036](ydr-036-merge-service-obligation-kinds.md)
- 決定日: 2026-08-31
- 置き換える決定: [YDR-029](ydr-029-managed-item-kind-labels.md)

## 背景

[Issue #291](https://github.com/upu/YAMORU/issues/291)でManagedItemとConsumableを台帳内の対等な入口として見せる言葉を検討した。「管理しているもの・こと」のような総称や造語では、利用者が一覧の内容を想像しにくい。一方、ManagedItemの大分類を見れば、家庭で長く管理する対象は物理的な対象、サービス、支払い・手続きへ具体的に分けられる。

[YDR-029](ydr-029-managed-item-kind-labels.md)の「モノ」は短く選びやすいが、台帳のカテゴリ名としては意味が広い。「備品」は家電、住宅設備、家具、ペット用品など、家庭で長く管理する物理的な対象をまとめて表し、使うと減るConsumableとはライフサイクルを分けて説明できる。

また「その他」は選択時の受け皿になる反面、どの大分類を選ぶべきか判断しなくても登録でき、分類の境界を曖昧にする。productionでは大分類`other`のManagedItemをまだ使用していないことを確認できたため、専用の再分類画面や推測による一括移行を作らず、通常の選択肢から外せる。

## 決定

- ManagedItemの有効な大分類と表示ラベルを次の3択にする。

  | code | ラベル |
  |---|---|
  | `asset` | 備品 |
  | `service` | サービス |
  | `obligation` | 支払い・手続き |

- `other`は新規登録・通常の編集で選べない非アクティブな大分類にする。旧データの読み取り互換性に使うマスタ行とcodeは、この変更では削除しない。
- `managed_items.kind = 'other'`は、自由入力の詳しい種類を持つ`asset`などでも旧版互換値として使われる。これを大分類`other`とみなして一括更新しない。現在の大分類は`managed_item_classifications.kind_code`を正本として判断する。
- プリセットにない詳しい種類を各大分類の中で入力する「その他（自由入力）」は維持する。大分類`other`とは別概念として扱う。
- Consumableは使うと減って補充する別ライフサイクルの情報であり、ManagedItemの大分類へ追加しない。
- `service`と`obligation`のcode、表示ラベル、意味、`item_type`との親子関係は変更しない。`asset`もcodeと分類の意味は変えず、表示ラベルだけを変更する。
- 適用済みmigrationは書き換えず、追加の連番migrationで`asset`のラベル更新と`other`の非アクティブ化を行う。preview / productionへの手動適用はこのIssueでは行わない。

## 結果

- 登録時の大分類は「備品」「サービス」「支払い・手続き」の3択になり、内容を想像できない「その他」を選ばずに済む。
- 家電や住宅設備と、交換フィルターや洗剤などのConsumableを、画面上の言葉とデータモデルの両方で区別できる。
- 珍しい対象も、適切な大分類を選んだうえで詳しい種類を自由入力できる。
- 旧互換列や非アクティブなマスタ行を残すため、過去の値を推測で別分類へ変換しない。

## 見直す条件

- 「備品」が消耗品を含む言葉として繰り返し誤解される、または住宅設備を含まないと受け取られる場合。
- 「備品」「サービス」「支払い・手続き」のどれにも無理なく属さない対象が家庭内利用で繰り返し現れた場合。
- 非アクティブな`other`を参照する実データがなく、旧互換処理とマスタ行を安全に削除できる段階になった場合。
