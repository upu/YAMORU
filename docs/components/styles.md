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
| Todo登録の完了通知 | `src/app/todos/new/registration-notice.module.css` |
| 共通フッター | `src/app/app-footer.module.css` |
| 下部ナビゲーション(モバイル幅) | `src/app/mobile-bottom-navigation.module.css` |
| サイドバーナビゲーション(モバイル幅より広い画面) | `src/app/sidebar-navigation.module.css` |
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

- 主要ナビゲーションは画面幅で見た目だけを変え、項目・行き先・現在地の意味は`src/app/primary-navigation.tsx`の一つの値から両方へ渡す([Issue #219](https://github.com/upu/YAMORU/issues/219))。モバイル幅(480px以下)は下部ナビゲーション、それより広い幅はサイドバー。切り替えは`display: none`で行い、隠れている側は支援技術からも見えないようにする(追加導線 #391 と同じ方法)。境界を下部ナビゲーションが消える幅とそろえ、主要ナビゲーションが無い幅を作らない。
- サイドバーは481〜899pxでアイコンの下に語を置いて折りたたみ、900px以上で語を横へ並べて展開する([Issue #219](https://github.com/upu/YAMORU/issues/219))。折りたたんでも語は消さない(記号だけにすると行き先が読み取れない)。利用者が開閉する状態は持たないため、保存する開閉状態もない。
- サイドバーの幅は`--sidebar-width`(`globals.css`の`:root`、モバイル幅では`0px`)に持つ([Issue #219](https://github.com/upu/YAMORU/issues/219))。サイドバー自身の幅、`app-shell.module.css`の左padding(ヘッダー・本文・フッターを右へ寄せる)、画面上部へ固定する通知の中心(`left: calc(50% + var(--sidebar-width) / 2)`)と幅(`calc(100vw - var(--sidebar-width) - 余白)`)が同じ値を参照する。画面いっぱいを基準にすると、中間幅で通知の左端がサイドバーに隠れ、右端が画面の外へ出る。右下の追加ボタンは画面の反対側に固定するため、サイドバーとは重ならない。
- サイドバーはダイアログの覆い(`dialog.module.css`の`.backdrop`、`z-index: 10`)より後ろへ置く([Issue #219](https://github.com/upu/YAMORU/issues/219))。モーダルを開いている間はサイドバーも覆われ、移動先を押せない。本文は`AppShell`がサイドバーの幅だけ右へ寄せるためサイドバーの下へ潜らず、手前へ出す必要がない(下部ナビゲーションは本文がその下を流れるため`z-index: 20`を持つ)。
- 本文を右へ寄せるのは、サイドバーを出す画面だけにする([Issue #219](https://github.com/upu/YAMORU/issues/219))。`body`へ一律に余白を置くと、サイドバーを描画しない公開画面・認証画面(`isPublicPath`)まで左側が空く。条件はサイドバーと同じ`isPublicPath`で判定し、`AppShell`がクラスを付け外しする。
- 主要な操作(ボタン、タブ、切り替え、リンク、担当のselect)は、押せる領域を`--tap-target`(`globals.css`の`:root`、44px)以上に保つ([YDR-045](../decisions/ydr-045-compact-ui-with-first-run-hints.md)、[Issue #389](https://github.com/upu/YAMORU/issues/389))。大きさを直接書かず、この変数を参照する。
- 見た目の大きさと押せる領域は分けてよい。見た目を小さいまま保ちたい操作は、疑似要素(`globals.css`の`.stock-status-option-symbol`)か負のmargin(`first-run-hint.module.css`の`.dismiss`)で領域だけを広げる。はみ出した分だけ隣の操作との間隔を空け、誤タップを作らない。隣り合う選択肢(表示形式の2択など)は領域が重なるため、この方法を使わず押せる面そのものを広げる。
- 領域を広げた分は、外側の余白(リスト項目のpadding、パネルのmargin)を詰めて、1件あたりの高さを増やさない。
- アイコンだけの操作ボタンは、見た目を小さくしてもアクセシブルネームを`.sr-only`か`aria-label`で残す([YDR-045](../decisions/ydr-045-compact-ui-with-first-run-hints.md))。
- 一覧(Todo・備品・サービス・契約・消耗品)の追加導線は、同じ画面へ2つ出さない([Issue #391](https://github.com/upu/YAMORU/issues/391))。モバイル幅(480px以下)は右下のフローティングボタン、それより広い幅は一覧の操作行の先頭のリンク(`.list-add-link`)だけを出す。切り替えは`display: none`で行い、隠れている側は支援技術からも見えないようにする。文言と行き先は`ListAddAction`の同じ値を両方へ渡し、画面幅で名前が変わらないようにする。ホームは一覧ではないため、右下のボタンをどの幅でも出す。
- Todo一覧のツールバーは、絞り込み(状態・担当)と、それ以外の操作(追加・表示形式)を別のまとまりに分け、折り返しをまとまりの境目でだけ起こす([Issue #390](https://github.com/upu/YAMORU/issues/390))。画面内検索はどちらのまとまりにも入れず、開いたときにツールバーの全幅を使う。まとまりの並びは`order`で入れ替えず、狭い幅で表示される順(見出し・操作・検索・絞り込み)をDOMの順のまま保ち、キーボードの移動順と画面の並びを一致させる。単独の操作が次の行へ取り残されていないかと、移動順が画面の並びに沿うことは`e2e/todo-list-compact-layout.spec.ts`が390pxで確認する。
- Todo一覧のコンパクトなリスト表示は、通常の文字サイズで1件を1行に収める([Issue #390](https://github.com/upu/YAMORU/issues/390))。入り切らない分はTodo名を省略表示にし、日付/状態と状態ラベルを押し出さない。1行に収めるのは折り返しを禁止してではなく、Todo名の基準幅(`flex-basis`)を0にして日付/状態と状態ラベルが先に場所を取れるようにして行う。日付/状態にも上限を置く。日付は推奨期間の範囲表示になり、家族名は最大20文字まで登録できるため、上限がないとこの2つだけで行の幅を使い切り、状態ラベルが2行目へ落ちる。上限は「行の半分」と「いちばん長い状態ラベル(`推奨期間超過`)とタイトルの最小幅を引いた残り」の小さい方とする。折り返し自体は許したままにし、文字サイズを大きくして本当に入り切らないときは、隠さずに次の行へ回す(一覧は角丸のため`overflow: hidden`で、はみ出した部分は読めない)。基準幅は行の最小幅にも効くため、`auto`のままだと一覧全体が長いTodo名の幅まで広がる。
- 家族名を表示する操作(Todo一覧の担当の絞り込み、Todoカードの担当select)は、上限の20文字(`src/app/account/actions.ts`の`NICKNAME_MAX_LENGTH`)でも320px幅で横スクロールを出さない([Issue #390](https://github.com/upu/YAMORU/issues/390))。名前の部分を縮められるようにし、入り切らない分は省略表示にする。
- 登録の完了通知は、押した位置に依らず見えるよう画面上部へ固定する([Issue #326](https://github.com/upu/YAMORU/issues/326))。位置は更新結果の通知(`refresh-coordinator.module.css`)と同じ`--top-notice-top`(`globals.css`の`:root`)を使い、更新結果の通知が出ている間は`--top-notice-stack`だけ下へ積んで場所を分ける(自動では消えない登録の通知が、更新の失敗と「再試行」を覆わないようにする)。重なり順は共通ヘッダー(`z-index: 20`)より後ろに置き、位置の見積もりが外れて重なったときでも更新結果の通知が読めるようにする。幅は`calc(100vw - 24px)`までに抑えてスマホの画面を覆わない。覆いも焦点の閉じ込めも置かず、通知が出ている間もフォームを操作できるようにする。短時間で消さず、閉じる操作で消す。入力をやり直すための失敗の理由は、直す入力欄の近く(登録ボタンのそば)に残し、上部へ動かさない。
- Todo追加画面の上部はページ見出し一つに収め、キッカー・説明文・「登録内容」のように役割の重なる見出しを並べない([Issue #327](https://github.com/upu/YAMORU/issues/327))。見出しは詳細画面の`detail-hero`ではなく`.form-page-title`(Todo一覧のツールバーと同じ大きさ)を使う。この画面固有の戻る導線は管理対象から来たときだけ`DetailBackNav`で置き、戻り先は`/managed-items/{id}`に固定する(履歴に依らず、直接URLを開いても再読み込みしても変わらない)。ホームへは共通ヘッダーと下部タブから移動する。
- 備品・消耗品の登録画面も同じく、上部はページ見出し一つ(`.form-page-title`)に収め、キッカー・大見出し・「登録内容」を重ねない([Issue #393](https://github.com/upu/YAMORU/issues/393))。「登録内容」は`.sr-only`で残し、入力領域の意味だけを支援技術へ伝える。台帳の登録では、どの家庭へ入るかだけを`.detail-note`で残す。
- 入力欄の補足文(`<p>`)には、ラベル・placeholder・選択肢から読み取れることを書かない([Issue #393](https://github.com/upu/YAMORU/issues/393))。残すのは、その欄を見ただけでは分からない判断材料(名前欄に書かなくてよいもの、正確な型番でなくてよいこと、年だけでも登録できること、編集画面で空にすると未設定へ戻ること)だけとする。例だけを伝えたい欄はplaceholderへ移し、補足文と`aria-describedby`ごと外す。
- 件数を示すlegend(消耗品の「関連する管理対象（0件・任意）」)がある場所へ、同じ意味の空状態の行や「任意です」の説明文を重ねない([Issue #393](https://github.com/upu/YAMORU/issues/393))。件数の変化は`aria-live`の`.sr-only`で伝える。
- 横断検索の結果は、分類ごとに外側のカードを作らない([Issue #396](https://github.com/upu/YAMORU/issues/396))。分類は小さな見出しと件数だけで示し、枠・背景・余白を持つのは結果行(`.ledger-list > li`)の側だけにする。結果行の操作は、名前が長いときに次の行へ落ちないよう、名前側の基準幅(`flex-basis`)を0にして名前だけを折り返す。
- 詳細画面(Todo・備品・消耗品)のカード見出しは`h2`一つとし、その上に英字のキッカー(`RECORD`、`TODO`など)を重ねない([Issue #395](https://github.com/upu/YAMORU/issues/395))。ページ最上部の`detail-hero`のキッカーは、その画面が何の詳細かを示すため残す。
- 詳細画面の空状態は、そのカードから内容を増やせるかどうかで決める([Issue #395](https://github.com/upu/YAMORU/issues/395))。追加・記録の導線を持つカード(記録、関連する管理対象・Todo・消耗品、補充)は、空でも見出しと導線を残し、「ありません」の行は置かない。件数は`aria-live`の`.sr-only`で伝える。導線を持たない確認専用のカード(直近の完了、期限のあるTodoの関連する消耗品)は、内容がないときカードごと出さない。同じ部品でも、渡された導線の有無で読み取り専用かどうかが変わる場合は、その状態で判断する。
- 名称と値の対(`.managed-item-record-list`、`.todo-detail-list`)は、名称と値を1行へ並べる([Issue #395](https://github.com/upu/YAMORU/issues/395))。名称の列は`minmax(0, max-content)`で一覧全体に一つだけ作り、各行は`subgrid`でその列をそのまま使う(行ごとに列を作ると、名称の長さで値の始まる位置がばらつく)。幅が足りないときは縮む。メモや外部リンクのように行の残り幅では読みにくい値は`.detail-record-block`を付けて全幅の縦積みに戻す。値のないものは行ごと出さない(「関連する管理対象なし」のように、名称と同じ内容を値として繰り返さない)。
- 消耗品詳細の在庫と補充は1枚のカード(「在庫と補充」)にまとめる([Issue #395](https://github.com/upu/YAMORU/issues/395))。補充は在庫を「ある」へ戻す操作であり、別カードにすると同じ関心が2枚へ割れて最初の画面から押し出される。
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

備品・消耗品の登録画面が縦に詰まっていることと、320px・390pxで横スクロールを出さないことは`e2e/ledger-registration-compact.spec.ts`が確認する。

Todo・備品・消耗品の詳細が、空・少量・多量のどの状態でも縦に詰まっていることと、重要な状態と操作が最初の画面へ収まることは`e2e/detail-compact-layout.spec.ts`が確認する。

Todo登録の完了通知が、フォーム下部で登録しても画面の中に見えることと、画面を覆わず操作を妨げないことは`e2e/todo-registration-notice.spec.ts`が確認する。

主要ナビゲーションが画面幅で入れ替わること、サイドバーが本文を覆わないこと、キーボードと文字サイズ2倍で使えること、公開画面に出ないことは`e2e/sidebar-navigation.spec.ts`が390px・768px・1280pxで確認する。

押せる領域は`e2e/tap-target-size.spec.ts`が390pxと320pxで確認する。要素の大きさだけでなく、中心から21px離れた点を押したときにその操作へ当たるかどうかで見るため、疑似要素で広げた領域も対象になる。
