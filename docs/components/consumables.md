---
type: Component Map
title: 消耗品(Consumable)の修正箇所マップ
description: 在庫状態、補充記録、関連付け、ピン留めについて、最初に読む実装とテスト、守る不変条件、関連する有効なYDRへの入口
tags: [yamoru, components, consumable, inventory]
status: stable
---

# 消耗品(Consumable)の修正箇所マップ

## 責務

家庭で使う消耗品の登録・編集、家庭共有の在庫状態、補充の履歴、管理対象やTodoとの関連付け、利用者ごとのピン留めを扱う。ConsumableはManagedItemとは別のテーブルであり、台帳画面では3つ目の入口として並べるだけである。

## 主要入口

| 変更したいこと | 画面・action | データアクセス |
|---|---|---|
| 在庫状態(ある / 少ない / ない) | `src/app/consumables/stock-actions.ts`(`updateConsumableStockStatus`)、UIは`src/app/consumables/stock-status-control.tsx` | `src/lib/d1/consumables.ts`の`updateConsumableStockStatus` |
| 登録・編集 | `src/app/consumables/actions.ts`、`src/app/consumables/consumable-form.tsx` | `src/lib/d1/consumables.ts`の`createConsumable`/`updateConsumable` |
| 補充の記録 | `src/app/consumables/refill-actions.ts`、`src/app/consumables/refill-control.tsx` | `src/lib/d1/consumables.ts`の`recordConsumableRefill` |
| 観測・補充の履歴と訂正 | `src/app/consumables/[id]/history/`、`history-actions.ts`、`stock-correction-form.tsx` | `src/lib/d1/consumable-stock-history.ts` → `consumable-stock-plans.ts`、`consumable-stock-correction-plans.ts`、`consumable-stock-read.ts` |
| 外部の在庫変更 | `src/features/integration/commands/stock.ts` | Webと同じstock planとbatch文。受付記録は共通command service |
| 管理対象・Todoとの関連 | `src/app/consumables/relation-actions.ts`、`src/app/consumables/relation-picker.tsx` | `src/lib/d1/consumables.ts`、`src/lib/d1/consumable-relations.ts` |
| ピン留め | `src/app/consumables/pin-actions.ts`、`src/app/consumables/pin-toggle.tsx`(初回ヒントは`src/app/first-run-hint.tsx`) | `src/lib/d1/consumable-pins.ts` |
| 買い物候補(ホーム) | `src/app/shopping-candidates.tsx` | `src/lib/d1/consumables.ts`の`listShoppingCandidates` |

スキーマは`d1/migrations/0012_consumables.sql`、`0013_consumable_stock_status.sql`、`0020_consumable_refills.sql`、`0025_user_consumable_favorites.sql`、`0026_user_consumable_pins.sql`、`0037_consumable_stock_history.sql`が正本。アプリケーションは`user_consumable_pins`だけを使い、`0025`の旧テーブルは新旧Workerの互換性を保つ同期対象として、後続のcontract migrationまで残す。0037では元の補充表を原記録として維持し、rename/dropは予定しない。

## 重要な不変条件

- 在庫状態は`available` / `low` / `out`の3値だけで、数量や消費予測を持たない。買い物候補は`low`と`out`から作る。
- 在庫状態とConsumable本体は家庭共有、ピン留めは利用者ごと(`user_consumable_pins`)。この境界を混ぜない。
- 補充は現在の在庫状態と別の追記型履歴として持ち、補充日(`refilled_on`)と記録時刻(`recorded_at`)を分ける([YDR-012](../decisions/ydr-012-separate-occurred-recorded-scheduled-due.md)と同じ考え方)。数量はこのテーブルへ持ち込まない。
- 更新系は`requireCurrentHouseholdId`でセッションから家庭を導出し、`id`と`household_id`の両方を条件にする。在庫記録はstock_revision・家庭所属・実施者をbatch内でも照合し、記録・現在状態・結果を全成功か全取消にする。
- 消耗品詳細のピン留めはアイコンだけのボタンで表し、説明文を常時併記しない。`.sr-only`の語と`aria-pressed`で操作名と状態を残し、初めての利用者には初回ヒントで補う([YDR-045](../decisions/ydr-045-compact-ui-with-first-run-hints.md))。
- 在庫変更のUI部品(`QuickStockStatusControl`)はホームのピン留め・検索結果・消耗品詳細で共有する。画面ごとの保存処理を増やさない([YDR-043](../decisions/ydr-043-cross-search-quick-actions.md))。

## 関連YDR

- 有効: [YDR-045](../decisions/ydr-045-compact-ui-with-first-run-hints.md)(コンパクト表示と初回ヒント)、[YDR-043](../decisions/ydr-043-cross-search-quick-actions.md)(検索結果からの在庫変更)、[YDR-003](../decisions/ydr-003-defer-inventory-attachments-payments-replacement.md)(在庫を独立したPhaseとして後から追加する方針。消耗品はこのPhaseに当たる)
- 在庫事実・現在状態・移行の規則は[YDR-057](../decisions/ydr-057-stock-observation-and-refill-history.md)を正本とする。旧補充表は原記録、新しい`consumable_stock_current`は訂正・取消を反映した有効な履歴である。

## 検証方法

```
npm test -- tests/consumable-stock-actions.test.ts tests/consumable-actions.test.ts tests/consumable-refill-actions.test.ts
npm test -- tests/consumable-pins-ui.test.tsx tests/help-page.test.tsx
npm run test:d1
npm run lint
npm run typecheck
```

保存や家庭間分離を変える場合は`src/lib/d1/stock-history*.d1-test.ts`、`stock-commands.d1-test.ts`と既存の消耗品テストを確認する。日付の精度・過去記録・曖昧な順序は`tests/stock-history.test.ts`、画面回帰は`e2e/stock-history.spec.ts`と`consumable-relations.spec.ts`で確認する。
