---
type: Component Map
title: 台帳(ManagedItem)の修正箇所マップ
description: 備品・サービス/契約の登録と分類、詳しい種類のAI提案について、最初に読む実装とテスト、守る不変条件、関連する有効なYDRへの入口
tags: [yamoru, components, managed-item, ledger]
status: stable
---

# 台帳(ManagedItem)の修正箇所マップ

## 責務

家庭が管理する対象(ManagedItem)の登録・編集・分類・一覧絞り込みと、その詳細画面からのTodo操作の呼び出しを扱う。Todoの計算・保存そのものは[Todo](todos.md)、消耗品は[消耗品](consumables.md)が持つ。

## 主要入口

| 役割 | 実装 |
|---|---|
| 一覧・絞り込み | `src/app/managed-items/page.tsx`、`src/app/managed-items/search-href.ts`、`src/app/ledger-category-navigation.tsx`、`src/app/ledger-page-shell.tsx` |
| 登録・編集 | `src/app/managed-items/actions.ts`(`createManagedItem`、`updateManagedItem`)、入力は`src/app/managed-items/managed-item-form.tsx`、`classification-fields.tsx`、`optional-attribute-fields.tsx` |
| 入力値の判定 | `src/app/managed-items/model.ts`(外部リンクの安全判定など)、`src/app/managed-items/started-on.ts` |
| 詳しい種類のAI提案 | `src/app/managed-items/item-type-suggestion-actions.ts` → `src/lib/managed-items/item-type-suggestion.ts`、`src/lib/ai/text-generation.ts`、記録は`src/lib/d1/item-type-suggestions.ts` |
| データアクセス | `src/lib/d1/managed-items.ts`、詳細画面用は`src/lib/d1/managed-item-detail.ts` |

台帳の入口は「備品」「サービス・契約」「消耗品」の3つだが、ConsumableはManagedItemとは別のテーブルであり、画面上だけ対等に並べる。

## 重要な不変条件

- 大分類は備品とサービス・契約の2択([YDR-036](../decisions/ydr-036-merge-service-obligation-kinds.md))。大分類・詳しい種類・タグは役割が異なり、混ぜない([YDR-028](../decisions/ydr-028-managed-item-kind-item-type-tags.md)の役割分離)。
- 絞り込み条件は分類候補のコード値と一致するものだけを使い、利用者向けラベルをデータ条件にしない。自由入力の詳しい種類は家庭内の実表記で比較する。
- 開始時期は`started_on`に持ち、大分類によらず同じ意味とする。変わるのは画面ラベルだけ([YDR-033](../decisions/ydr-033-managed-item-started-on.md))。
- AI提案は明示操作の入力補助に限る。提案と採用結果は家庭内へ記録し、AIの出力を正しさの根拠にしない([YDR-041](../decisions/ydr-041-ai-item-type-suggestion.md)、[YDR-008](../decisions/ydr-008-ai-not-source-of-truth.md))。
- 一覧・詳細のすべてのクエリーは`household_id`で先に絞る([家庭間分離](household-access.md))。

## 関連YDR

- 有効: [YDR-002](../decisions/ydr-002-minimal-managed-item.md)、[YDR-008](../decisions/ydr-008-ai-not-source-of-truth.md)、[YDR-033](../decisions/ydr-033-managed-item-started-on.md)、[YDR-036](../decisions/ydr-036-merge-service-obligation-kinds.md)、[YDR-041](../decisions/ydr-041-ai-item-type-suggestion.md)
- 部分的に置き換えられている(範囲に注意): [YDR-028](../decisions/ydr-028-managed-item-kind-item-type-tags.md)は初期の表示ラベルの部分だけを[YDR-029](../decisions/ydr-029-managed-item-kind-labels.md)が置き換えた。大分類・詳しい種類・タグの役割分離はYDR-028が継続する。ラベルと選択肢そのものはYDR-029→[YDR-035](../decisions/ydr-035-retire-other-managed-item-kind.md)→YDR-036と置き換えられており、現在有効なのはYDR-036だけである。

## 検証方法

```
npm test -- tests/managed-item-actions.test.ts tests/managed-item-model.test.ts tests/managed-items-ui.test.tsx
npm run test:d1
npm run lint
npm run typecheck
```

分類やスキーマを変える場合は`src/lib/d1/managed-item-classification.d1-test.ts`と`src/lib/d1/managed-items-authorization.d1-test.ts`、画面回帰は`e2e/managed-items-filters.spec.ts`、`e2e/managed-item-classification-badges.spec.ts`で確認する。
