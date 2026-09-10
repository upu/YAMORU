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
| 右下の追加ボタン(一覧ではモバイル幅だけ) | `src/app/floating-add-button.module.css` |
| ホーム固有(操作リンク・対応状況・並び) | `src/app/home.module.css` |
| ホームのピン留め消耗品 | `src/app/pinned-consumables.module.css` |
| 記録・訂正・延期などのダイアログ | `src/app/dialog.module.css` |
| Todo一覧(ツールバー・リスト表示) | `src/app/todos/todo-list.module.css` |
| 台帳のカテゴリ切り替え | `src/app/ledger-category-navigation.module.css` |
| 横断検索の結果 | `src/app/search/search-results.module.css` |
| 消耗品の補充記録 | `src/app/consumables/refill-control.module.css` |
| 消耗品詳細のピン留めボタン | `src/app/consumables/pin-toggle.module.css` |
| 初回操作ヒント | `src/app/first-run-hint.module.css` |
| ヘルプの使い方・アイコン一覧 | `src/app/help/help.module.css` |
| 招待の一覧・発行結果 | `src/app/household/invitations.module.css` |

## 重要な不変条件

- 主要な操作(ボタン、タブ、切り替え、リンク、担当のselect)は、押せる領域を`--tap-target`(`globals.css`の`:root`、44px)以上に保つ([YDR-045](../decisions/ydr-045-compact-ui-with-first-run-hints.md)、[Issue #389](https://github.com/upu/YAMORU/issues/389))。大きさを直接書かず、この変数を参照する。
- 見た目の大きさと押せる領域は分けてよい。見た目を小さいまま保ちたい操作は、疑似要素(`globals.css`の`.stock-status-option-symbol`)か負のmargin(`first-run-hint.module.css`の`.dismiss`)で領域だけを広げる。はみ出した分だけ隣の操作との間隔を空け、誤タップを作らない。隣り合う選択肢(表示形式の2択など)は領域が重なるため、この方法を使わず押せる面そのものを広げる。
- 領域を広げた分は、外側の余白(リスト項目のpadding、パネルのmargin)を詰めて、1件あたりの高さを増やさない。
- アイコンだけの操作ボタンは、見た目を小さくしてもアクセシブルネームを`.sr-only`か`aria-label`で残す([YDR-045](../decisions/ydr-045-compact-ui-with-first-run-hints.md))。
- 一覧(Todo・備品・サービス・契約・消耗品)の追加導線は、同じ画面へ2つ出さない([Issue #391](https://github.com/upu/YAMORU/issues/391))。モバイル幅(480px以下)は右下のフローティングボタン、それより広い幅は一覧の操作行の先頭のリンク(`.list-add-link`)だけを出す。切り替えは`display: none`で行い、隠れている側は支援技術からも見えないようにする。文言と行き先は`ListAddAction`の同じ値を両方へ渡し、画面幅で名前が変わらないようにする。ホームは一覧ではないため、右下のボタンをどの幅でも出す。
- Todo一覧のツールバーは、絞り込み(状態・担当)と、それ以外の操作(追加・表示形式)を別のまとまりに分け、折り返しをまとまりの境目でだけ起こす([Issue #390](https://github.com/upu/YAMORU/issues/390))。画面内検索はどちらのまとまりにも入れず、開いたときにツールバーの全幅を使う。まとまりの並びは`order`で入れ替えず、狭い幅で表示される順(見出し・操作・検索・絞り込み)をDOMの順のまま保ち、キーボードの移動順と画面の並びを一致させる。単独の操作が次の行へ取り残されていないかと、移動順が画面の並びに沿うことは`e2e/todo-list-compact-layout.spec.ts`が390pxで確認する。
- Todo一覧のコンパクトなリスト表示は、通常の文字サイズで1件を1行に収める([Issue #390](https://github.com/upu/YAMORU/issues/390))。入り切らない分はTodo名を省略表示にし、日付/状態と状態ラベルを押し出さない。1行に収めるのは折り返しを禁止してではなく、Todo名の基準幅(`flex-basis`)を0にして日付/状態と状態ラベルが先に場所を取れるようにして行う。折り返し自体は許したままにし、文字サイズを大きくして本当に入り切らないときは、隠さずに次の行へ回す(一覧は角丸のため`overflow: hidden`で、はみ出した部分は読めない)。基準幅は行の最小幅にも効くため、`auto`のままだと一覧全体が長いTodo名の幅まで広がる。
- 家族名を表示する操作(Todo一覧の担当の絞り込み、Todoカードの担当select)は、上限の20文字(`src/app/account/actions.ts`の`NICKNAME_MAX_LENGTH`)でも320px幅で横スクロールを出さない([Issue #390](https://github.com/upu/YAMORU/issues/390))。名前の部分を縮められるようにし、入り切らない分は省略表示にする。
- 詳細画面(Todo・備品・消耗品)の戻る導線は`DetailBackNav`だけを使い、`main`直下の最初の要素として置く。編集導線は対象の内容を表すセクション見出しの右端に`.icon-link`の鉛筆アイコンで置く。
- 部品専用のルールはCSS Moduleへ置き、`globals.css`には全体基盤と、複数の部品から使う・複数の部品が配置を調整するルールだけを残す。
- 部品のmedia query、hover、focus-visible、状態属性の指定は、その部品のCSS Moduleへまとめる。`--mobile-nav-height`のように下部ナビゲーションとダイアログが共有する変数は`globals.css`の`:root`に置く。
- CSS Moduleから共有クラスの配置だけを調整するときは`:global(.クラス名)`で明示する(例: ピン留め一覧の中の在庫変更ボタン、検索結果の中の操作列)。
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

押せる領域は`e2e/tap-target-size.spec.ts`が390pxと320pxで確認する。要素の大きさだけでなく、中心から21px離れた点を押したときにその操作へ当たるかどうかで見るため、疑似要素で広げた領域も対象になる。
