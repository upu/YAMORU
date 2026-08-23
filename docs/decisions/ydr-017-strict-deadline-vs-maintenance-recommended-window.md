---
type: Decision
ydr_id: YDR-017
title: 厳密な期限とメンテナンスの推奨期間を区別する
description: 税金・支払いなど厳密な期限は「期限切れ」のまま扱い、メンテナンスにはscheduled_for/due_atを使った推奨期間(開始・上限)を持たせて早期交換を急かさない
tags: [yamoru, decisions, ydr]
status: stable
decision_status: Superseded
decision_date: 2026-08-12
supersedes: YDR-010
superseded_by: YDR-027
---

# YDR-017: 厳密な期限とメンテナンスの推奨期間を区別する

- 状態: Superseded by [YDR-027](ydr-027-maintenance-reminder-progress-ratio.md)(「推奨期間内(`scheduled_for <= now <= due_at`)」という開始条件のみ置き換え。`deadline_kind`による`strict`/`maintenance`の区別、`strict`の期限切れ表示、`scheduled_for`/`due_at`の意味は[YDR-027](ydr-027-maintenance-reminder-progress-ratio.md)でも維持される)
- 決定日: 2026-08-12
- 置き換える決定: [YDR-010](ydr-010-single-pending-occurrence-per-task-rule.md)(「未完了なら期限切れのまま表示する」という一律の表示前提のみ。未解決Occurrenceを最大1件とする決定そのものは変更しない)

## 背景

猫の浄水器フィルターの実機確認で、交換推奨日を過ぎた直後から「期限切れ」と表示すると、利用者を必要以上に急かし、まだ使える消耗品を早めに交換する動機を作ってしまうことが分かった。

一方、税金や支払いには厳密な期限があり、メンテナンスでも推奨期間を大幅に超えた場合は強い案内が必要になる。[YDR-010](ydr-010-single-pending-occurrence-per-task-rule.md)は「未完了なら古いOccurrenceを期限切れのまま表示する」と一律に定めており、この表示前提のままでは両者を区別できない。TaskRuleごとの未解決Occurrenceを最大1件とする決定自体は変更が必要な理由がないため、表示前提だけを置き換える。

## 検討した案

- **案1(採用)**: [YDR-012](ydr-012-separate-occurred-recorded-scheduled-due.md)の`scheduled_for`を推奨期間の開始、`due_at`を推奨期間の上限として使う。TaskRuleに、完了から推奨開始までの期間と、推奨開始から上限までの幅を持たせる。厳密な期限を持つTodoでは`scheduled_for`と`due_at`を同日にする。
- 案2: `recommended_from`/`recommended_until`を明示的な別フィールドとして追加する。意味は明確だが、`scheduled_for`/`due_at`と役割が重なり、同じ「期間」を表すフィールドが二重に存在することになる。
- 案3: データは単一の期限のまま、UIだけで猶予期間を計算する。実装は小さいが、画面ごとに判定がずれる恐れがあり、正しさの基盤を画面実装に置いてしまう。

案1を採用する。既存の`scheduled_for`/`due_at`という2フィールド構成をそのまま再利用でき、厳密な期限は両者を同日にするだけで表現できるため、新しいフィールドを増やさずに済む。

## 決定

- TaskRuleに`deadline_kind`(`strict` / `maintenance`)を持たせる。
  - `strict`(税金・支払いなど): `scheduled_for`と`due_at`を同日とし、`due_at`を過ぎたら「期限切れ」として表示する。表示・強さは変更しない。
  - `maintenance`(掃除・消耗品交換など): `scheduled_for`を推奨期間の開始、`due_at`を推奨期間の上限として使う。
- `maintenance`のTaskRuleは、完了から推奨開始までの日数(`recommended_start_offset`)と、完了から推奨上限までの日数(`recommended_until_offset`)を持つ。
- 表示状態を3つに分ける。
  - 推奨期間前(`now < scheduled_for`): 交換を急かす表示をしない。
  - 推奨期間内(`scheduled_for <= now <= due_at`): 「そろそろ交換時期です」など中立的に案内する。
  - 推奨期間の上限超過(`due_at < now`): 「交換推奨期間を過ぎています」など、責めずに強い案内をする。
- 完了日基準では、実際の実施日(`occurred_at`)から次回の推奨期間を計算する。[YDR-012](ydr-012-separate-occurred-recorded-scheduled-due.md)の完了日基準の計算方法と同じ起点を使う。
- 例: 完了から4週間後(28日後)を推奨開始、8週間後(56日後)を推奨上限とする。
- [YDR-012](ydr-012-separate-occurred-recorded-scheduled-due.md)の`scheduled_for`/`due_at`分離、延期時に`due_at`だけを変更する扱いはそのまま有効とする。`maintenance`の推奨上限も「現在の期限」という位置づけで`due_at`に載るため、延期機能を追加する場合は推奨期間の上限を延ばす操作として自然に扱える。
- TaskRuleごとの未解決Occurrenceは`deadline_kind`によらず最大1件とする。この点は[YDR-010](ydr-010-single-pending-occurrence-per-task-rule.md)から変更しない。
- 固定日基準の次回予定枠計算([YDR-013](ydr-013-fixed-date-next-occurrence-calculation.md))は変更しない。

## 結果

- 消耗品や掃除のメンテナンスで、推奨期間に入った直後から利用者を急かさなくなる。
- 税金や支払いなど厳密な期限は、従来どおり「期限切れ」表示を維持できる。
- `scheduled_for`/`due_at`という既存の2フィールドを再利用でき、新しいフィールドを追加せずに済む。

## 見直す条件

- `maintenance`の延期機能を実装する際、推奨期間の上限を延ばす操作と、通常の延期操作を利用者が混同することが実運用から確認された。
- 推奨期間の開始・上限をTaskRuleごとに個別設定できるようにする機能を追加する。
