---
type: Component Map
title: スタイルの修正箇所マップ
description: 画面の見た目をどのファイルで直すか。globals.cssに残す全体基盤・共有ルールと、部品ごとのCSS Moduleの境界
tags: [yamoru, components, styles, css]
status: stable
---

# スタイルの修正箇所マップ

## 責務

画面の見た目の指定を、「全体基盤と複数の部品で共有するルール」と「その部品だけが使うルール」に分けて置く。部品固有の見た目・画面幅別指定・状態別指定は、その部品の近くで読めるようにする([Issue #368](https://github.com/upu/YAMORU/issues/368))。

## 主要入口

| 直したいもの | ファイル |
|---|---|
| 変数(色・影)、リセット、`main`・見出し・段落の基本、`.sr-only` | `src/app/globals.css` |
| 複数の画面で共有する枠・部品(`.detail-page`、`.detail-card`、`.home-section`、`.section-heading`、`.card-list`、`.task-card`、`.tone-*`、`.auth-form`系、`.ledger-list`系、`.stock-status-*`、`.completion-trigger`) | `src/app/globals.css` |
| 共通ヘッダー・設定メニュー | `src/app/app-header.module.css` |
| 手動更新ボタンと更新結果の通知 | `src/app/refresh-coordinator.module.css` |
| 共通フッター | `src/app/app-footer.module.css` |
| 下部ナビゲーション | `src/app/mobile-bottom-navigation.module.css` |
| 右下の追加ボタン | `src/app/floating-add-button.module.css` |
| ホーム固有(操作リンク・対応状況・並び) | `src/app/home.module.css` |
| ホームのお気に入り消耗品 | `src/app/favorite-consumables.module.css` |
| 記録・訂正・延期などのダイアログ | `src/app/dialog.module.css` |
| Todo一覧(ツールバー・リスト表示) | `src/app/todos/todo-list.module.css` |
| 台帳のカテゴリ切り替え | `src/app/ledger-category-navigation.module.css` |
| 横断検索の結果 | `src/app/search/search-results.module.css` |
| 消耗品の補充記録 | `src/app/consumables/refill-control.module.css` |
| 招待の一覧・発行結果 | `src/app/household/invitations.module.css` |

## 重要な不変条件

- 部品専用のルールはCSS Moduleへ置き、`globals.css`には全体基盤と、複数の部品から使う・複数の部品が配置を調整するルールだけを残す。
- 部品のmedia query、hover、focus-visible、状態属性の指定は、その部品のCSS Moduleへまとめる。`--mobile-nav-height`のように下部ナビゲーションとダイアログが共有する変数は`globals.css`の`:root`に置く。
- CSS Moduleから共有クラスの配置だけを調整するときは`:global(.クラス名)`で明示する(例: お気に入り一覧の中の在庫変更ボタン、検索結果の中の操作列)。
- CSS Moduleは`globals.css`より後に読み込まれる。画面側の子孫セレクタ(`.detail-card h2`など)と詳細度が並ぶ場所では、部品側のセレクタを1段重ねて、部品の見た目が画面によって変わらないようにする(`src/app/dialog.module.css`の見出し・説明文)。
- テストやE2Eから見た目のクラス名を選択子に使わない。必要なときはrole・ラベル・本文で取るか、テスト側でもCSS Moduleをimportして同じクラス名を使う。

## 検証方法

```
npm run lint
npm run typecheck
npm test
npm run build
```

見た目を変えない整理をしたときは、モバイル相当(390px)とPC相当(1280px)で、ホーム・Todo一覧・台帳・消耗品詳細・検索・ダイアログを変更前後で見比べる。
