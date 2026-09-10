---
type: Component Map
title: 検索の修正箇所マップ
description: 横断検索と画面内検索の役割分担、最初に読む実装とテスト、守る不変条件、関連する有効なYDRへの入口
tags: [yamoru, components, search]
status: stable
---

# 検索の修正箇所マップ

## 責務

検索には役割の異なる2つがある。

- 横断検索(`/search`): 画面を先に選ばず、名前から対象へ到達する。下部ナビゲーションの4項目目。
- 画面内検索: いま開いている一覧(Todo一覧・台帳)を絞り込む。担当・状態・大分類などの条件を持つ。

新しい絞り込み条件は画面内検索側へ足し、横断検索へ足さない。

## 主要入口

| 役割 | 実装 |
|---|---|
| 横断検索の画面 | `src/app/search/page.tsx`、`src/app/search/search-form.tsx`、`src/app/search/results.tsx` |
| 横断検索の取得 | `src/lib/d1/cross-search.ts` |
| 検索語のLIKE組み立て(共通) | `src/lib/d1/text-search.ts` |
| Todo一覧の絞り込み | `src/app/todos/list-params.ts`、`src/app/todos/list-toolbar.tsx` → `src/lib/d1/home.ts` |
| 台帳の絞り込み | `src/app/managed-items/managed-items-search-form.tsx`、`src/app/managed-items/search-href.ts` → `src/lib/d1/managed-items.ts` |

## 重要な不変条件

- 横断検索が一致するのは、利用者が画面で見る名前だけ(Todo・ManagedItem・Consumable)。関連する管理対象名・詳しい種類・メモ・型番は対象にしない。
- 種類ごとに20件の上限を持ち、総件数を数えない。上限より1件多く取得して「まだ結果がある」を判定する(`CROSS_SEARCH_LIMIT`)。
- Todoは未完了のOccurrenceだけを対象にする。`rule_snapshot`があるTodoは、一覧・詳細と同じ式で表示名を解決してから一致を判定する。
- 検索語のエスケープは`likeSearchPattern`に集約する。`%`と`_`はワイルドカードではなく文字として扱う。
- すべてのクエリーは認証済み利用者の家庭を先に確定し、最初の条件を`household_id`にする。
- 検索結果へ置く操作は在庫変更とTodo完了の2つだけで、いずれも既存部品(`QuickStockStatusControl`、`CompleteTodoPanel`)を再利用する。検索専用の保存処理を作らない([YDR-043](../decisions/ydr-043-cross-search-quick-actions.md))。在庫変更は記号表示(`appearance="symbol"`)を使い、結果行を1行に収める([Issue #396](https://github.com/upu/YAMORU/issues/396))。
- 分類のまとまりは外側のカード(`detail-card`)を持たない([Issue #396](https://github.com/upu/YAMORU/issues/396))。分類は小さな見出しと件数だけで示し、枠・余白・背景を持つのは結果行の側だけにする(二重の囲いを作らない)。一致が0件の分類は見出しごと出さない。

## 関連YDR

- 有効: [YDR-043](../decisions/ydr-043-cross-search-quick-actions.md)
- 部分的に置き換えられている(範囲に注意): [YDR-042](../decisions/ydr-042-cross-cutting-search.md)はYDR-043に置き換えられているが、置き換わったのは「結果の続きの操作は詳細画面への移動だけ」という部分である。下部ナビゲーションの入口、URLクエリー、検索対象の3種類と名前一致の規則、種類別表示と補助情報、種類ごと20件の上限、家庭単位の認可、画面内検索との役割分担はYDR-042の記述が継続する(YDR-043の「YDR-042との関係」節)。

## 検証方法

```
npm test -- tests/search-ui.test.tsx tests/managed-items-search-ui.test.tsx
npm run test:d1
npm run lint
npm run typecheck
```

取得条件を変える場合は`src/lib/d1/cross-search.d1-test.ts`と`src/lib/d1/todo-filters.d1-test.ts`、画面回帰は`e2e/cross-search.spec.ts`で確認する。結果が縦に詰まっていることと、320px・390pxで長い名前でも崩れないことは`e2e/cross-search-compact-layout.spec.ts`が確認する。
