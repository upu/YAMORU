---
type: Component Map
title: 消耗品(Consumable)の修正箇所マップ
description: 在庫状態、補充記録、関連付け、お気に入りについて、最初に読む実装とテスト、守る不変条件、関連する有効なYDRへの入口
tags: [yamoru, components, consumable, inventory]
status: stable
---

# 消耗品(Consumable)の修正箇所マップ

## 責務

家庭で使う消耗品の登録・編集、家庭共有の在庫状態、補充の履歴、管理対象やTodoとの関連付け、利用者ごとのお気に入りを扱う。ConsumableはManagedItemとは別のテーブルであり、台帳画面では3つ目の入口として並べるだけである。

## 主要入口

| 変更したいこと | 画面・action | データアクセス |
|---|---|---|
| 在庫状態(ある / 少ない / ない) | `src/app/consumables/stock-actions.ts`(`updateConsumableStockStatus`)、UIは`src/app/consumables/stock-status-control.tsx` | `src/lib/d1/consumables.ts`の`updateConsumableStockStatus` |
| 登録・編集 | `src/app/consumables/actions.ts`、`src/app/consumables/consumable-form.tsx` | `src/lib/d1/consumables.ts`の`createConsumable`/`updateConsumable` |
| 補充の記録 | `src/app/consumables/refill-actions.ts`、`src/app/consumables/refill-control.tsx` | `src/lib/d1/consumables.ts`の`recordConsumableRefill` |
| 管理対象・Todoとの関連 | `src/app/consumables/relation-actions.ts`、`src/app/consumables/relation-picker.tsx` | `src/lib/d1/consumables.ts`、`src/lib/d1/consumable-relations.ts` |
| お気に入り | `src/app/consumables/favorite-actions.ts`、`src/app/consumables/favorite-toggle.tsx` | `src/lib/d1/consumable-favorites.ts` |
| 買い物候補(ホーム) | `src/app/shopping-candidates.tsx` | `src/lib/d1/consumables.ts`の`listShoppingCandidates` |

スキーマは`d1/migrations/0012_consumables.sql`、`0013_consumable_stock_status.sql`、`0020_consumable_refills.sql`、`0025_user_consumable_favorites.sql`が正本。

## 重要な不変条件

- 在庫状態は`available` / `low` / `out`の3値だけで、数量や消費予測を持たない。買い物候補は`low`と`out`から作る。
- 在庫状態とConsumable本体は家庭共有、お気に入りは利用者ごと(`user_consumable_favorites`)。この境界を混ぜない。
- 補充は現在の在庫状態と別の追記型履歴として持ち、補充日(`refilled_on`)と記録時刻(`recorded_at`)を分ける([YDR-012](../decisions/ydr-012-separate-occurred-recorded-scheduled-due.md)と同じ考え方)。数量はこのテーブルへ持ち込まない。
- 更新系は`requireCurrentHouseholdId`でセッションから家庭を導出し、`id`と`household_id`の両方を条件にする。変更行数が1でなければNot Foundとして失敗させる。
- 在庫変更のUI部品(`QuickStockStatusControl`)はホームのお気に入り・検索結果・消耗品詳細で共有する。画面ごとの保存処理を増やさない([YDR-043](../decisions/ydr-043-cross-search-quick-actions.md))。

## 関連YDR

- 有効: [YDR-043](../decisions/ydr-043-cross-search-quick-actions.md)(検索結果からの在庫変更)、[YDR-003](../decisions/ydr-003-defer-inventory-attachments-payments-replacement.md)(在庫を独立したPhaseとして後から追加する方針。消耗品はこのPhaseに当たる)
- 在庫状態そのものの仕様を定めたYDRはない。現在の仕様は`d1/migrations/`と`src/lib/d1/consumables.ts`が正本であり、恒久的な規則を追加・変更する場合は新しいYDRを起票する。

## 検証方法

```
npm test -- tests/consumable-stock-actions.test.ts tests/consumable-actions.test.ts tests/consumable-refill-actions.test.ts
npm run test:d1
npm run lint
npm run typecheck
```

保存や家庭間分離を変える場合は`src/lib/d1/consumable-stock.d1-test.ts`、`src/lib/d1/consumables-authorization.d1-test.ts`、`src/lib/d1/consumable-favorites.d1-test.ts`を確認する。画面回帰は`e2e/consumable-relations.spec.ts`で確認する。
