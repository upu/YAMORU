---
type: Decision
ydr_id: YDR-033
title: ManagedItemの開始時期をstarted_onへ段階移行し、大分類ごとの言葉で表示する
description: purchased_onを書き換えず、新しい中立的な保存項目started_onへ既存値をコピーして段階移行する。大分類(kind)に応じてモノ「購入時期」、サービス「利用・契約を始めた時期」、支払い・手続きとその他「開始時期」を画面へ表示し、値そのものの意味は大分類によらず「対象との関係が始まった時期」で統一する
tags: [yamoru, decisions, ydr, managed-item, started-on]
status: stable
decision_status: Accepted
decision_date: 2026-08-28
---

# YDR-033: ManagedItemの開始時期をstarted_onへ段階移行し、大分類ごとの言葉で表示する

- 状態: Accepted
- 決定日: 2026-08-28

## 背景

[#42](https://github.com/upu/YAMORU/issues/42)は、家電などの商品を念頭に`managed_items.purchased_on`を追加し、年・年月・年月日の分かる精度だけを保存できるようにした。

v0.9.0の家庭内利用で、相談事業所（相談員）をManagedItemとして登録したところ、契約を始めた時期を記録する場所として「購入時期」を使うと、サービス・契約に対するラベルとして不自然だった。現在のManagedItemは「モノ」だけでなく、「サービス」「支払い・手続き」「その他」も同じ台帳で扱うため（[YDR-028](ydr-028-managed-item-kind-item-type-tags.md)、[YDR-029](ydr-029-managed-item-kind-labels.md)）、対象に合う自然な言葉で開始時期を記録できる必要がある（[#239](https://github.com/upu/YAMORU/issues/239)）。

## 決定

issue本文の設計メモにある4案のうち、案1（`purchased_on`を中立的な保存項目へ段階移行し、大分類に応じて画面ラベルを変える）を採用する。案2は保存名と意味がずれる、案3は大分類が増えるたびに属性が増える、案4はモノにとって「開始」の意味が伝わりにくいという理由でいずれも見送った。

- `managed_items`に新しい列`started_on`を追加する（型・精度・CHECK制約は`purchased_on`と同じ: `YYYY` / `YYYY-MM` / `YYYY-MM-DD`のいずれか、または`NULL`）。
- 追加と同じmigrationで、既存の`purchased_on`の値を`started_on`へ一度だけコピーする（`UPDATE ... SET started_on = purchased_on WHERE purchased_on IS NOT NULL`）。
- `purchased_on`列はロールバック時の参照や過去の経緯を追える互換列として残すが、アプリケーションコード（登録・編集・詳細の読み書き）は以後`started_on`だけを使う。`purchased_on`への新規の書き込みは行わない。
- 保存する値そのものの意味は大分類によらず「対象との関係が始まった時期」で統一する。大分類ごとに変えるのは画面上の見出し語だけとする。

  | `kind`のcode | 画面ラベル |
  |---|---|
  | `asset`（モノ） | 購入時期 |
  | `service`（サービス） | 利用・契約を始めた時期 |
  | `obligation`（支払い・手続き） | 開始時期 |
  | `other`（その他） | 開始時期 |

- ラベルはアプリケーションコード側の定数として持つ（`managed_item_kinds.label`とは別）。値の意味を変えない見出し語の切り替えであり、`managed_item_kinds`のマスタ管理対象にはしない。
- 大分類を変更しても`started_on`の値は再解釈・再計算しない。変わるのは表示上の見出し語だけで、保存された年月日（分かる精度）はそのまま維持する。
- 適用済みの`d1/migrations/0008_managed_item_optional_attributes.sql`は書き換えず、追加の連番migration(`0011_managed_item_started_on.sql`)で列追加と値のコピーだけを行う。

## 結果

- 相談事業所のようなサービス系の対象で、「契約・利用を始めた時期」を「購入」と表現せずに記録できる。
- 既存の`purchased_on`の値は失われず、`started_on`として同じ精度で読み戻せる。
- 大分類を変更しても、保存済みの開始時期の意味（対象との関係が始まった時期という一つの概念）は変わらない。見出し語だけが対象に合わせて切り替わる。
- `purchased_on`列を物理的に削除する判断は本決定の範囲に含めない。将来、互換目的の参照が不要になった時点で、別のexpand/contract migrationとして扱う。

## 見直す条件

- モノとサービスとで、開始時期が「関係が始まった時期」という単一の概念では表現できない別の意味（たとえば保証開始日のような、関係開始とは独立した日付）を必要とする事例が繰り返し現れた場合。
- `obligation`・`other`の「開始時期」という見出し語では、対象の性質が伝わらない事例が繰り返し現れた場合。
- `purchased_on`列を安全に削除できる条件が整った場合（別途migrationとして提案する）。
