---
type: Decision
ydr_id: YDR-048
title: ManagedItemのタグを家庭単位のマスタと多対多の関連として保存する
description: 横断的な文脈のタグを家庭ごとのtagsとmanaged_item_tagsで持ち、同名は英字の大文字小文字を区別せず一つにまとめ、登録・編集フォームの中で作成・付与・解除する
tags: [yamoru, decisions, ydr, managed-item, tags]
status: stable
decision_status: Accepted
decision_date: 2026-10-17
---

# YDR-048: ManagedItemのタグを家庭単位のマスタと多対多の関連として保存する

- 状態: Accepted
- 決定日: 2026-10-17
- 関連する決定: [YDR-028](ydr-028-managed-item-kind-item-type-tags.md)(大分類・詳しい種類・タグの役割分離。この部分は現在も有効)、[YDR-036](ydr-036-merge-service-obligation-kinds.md)

## 背景

[YDR-028](ydr-028-managed-item-kind-item-type-tags.md)は、大分類(`kind`)と詳しい種類(`item_type`)とは別に、「ペット」「住まい」「子ども」のような横断的な文脈をタグとして一つのManagedItemへ複数付ける方針を決め、保存形式とUIは実需要を確認して別Issueで設計するとしていた。

実利用で、同じ子どもに関係する複数のManagedItem(2か所の放課後等デイサービス、装具など)を「この子に関係するもの」としてまとめたい需要が確認された([Issue #226](https://github.com/upu/YAMORU/issues/226))。これを大分類や詳しい種類へ混ぜると分類軸が再び曖昧になる。

## 決定

- タグは家庭単位のマスタ`tags`(`id`、`household_id`、`name`)として持ち、ManagedItemとの多対多の関連を`managed_item_tags`(`household_id`、`managed_item_id`、`tag_id`)で表す。タグは人物に限らない汎用の目印とし、`tags`に対象の種類を持たせない。将来TodoやConsumableへ広げる場合は、`tags`をそのまま使い対象ごとの関連テーブルを足す。
- 家庭境界はDBでも守る。`managed_item_tags`はManagedItemとタグの両方へ`(id, household_id)`の複合外部キーを張り、家庭Aのタグを家庭BのManagedItemへ関連付ける行を拒否する。データアクセスはセッションから家庭を導出し、フォームから家庭IDを受け取らない([YDR-022](ydr-022-cloudflare-workers-d1-migration.md))。
- タグ名は前後の空白を落とした1〜30文字とする。同じ家庭内では英字の大文字小文字だけが違う名前を同じタグとみなす(`COLLATE NOCASE`の一意制約)。全角・半角、ひらがな・カタカナなどの正規化は行わず、入力どおりの表記を保存する。
- タグの作成は専用の管理画面を作らず、ManagedItemの登録・編集フォームの中で行う。既存タグはチェックボックスで付け外しし、新しいタグは名前を書いて作る(「、」やカンマで区切ると複数)。同じ家庭に同名のタグがあれば、新しく作らずにそのタグを付ける。
- 一つのManagedItemへ付けられるタグは10個までとする。新しいタグの名前は既存タグ(選択済みのものを含む)へまとまるため、上限はD1層で既存タグと突き合わせた後の数で判定する。
- 付け替えはManagedItemの登録・編集と同じ`db.batch()`で行い、既存の関連を消してから指定どおりに付け直す。途中で失敗した場合(他家庭のタグIDなど)は、名前や分類の更新も含めて全体を取り消す。
- 表示はManagedItem一覧と詳細で行う。分類のバッジ(緑)とは別の一覧として、色に加えて「#」の印と支援技術向けの「タグ: 」で見分けられるようにする。
- タグを外しても、タグそのものは家庭内に残り、次の登録・編集で選べる。

## 今回決めないこと

- タグによる検索・絞り込み、タグごとの一覧画面([Issue #218](https://github.com/upu/YAMORU/issues/218)の延長として別Issueで扱う)。
- タグの名前変更・削除、未使用タグの整理UI。今回は削除を提供しないため、使用中のタグを削除したときの扱いも決めない(DB上は関連がcascadeで消える構造にしてある)。
- TodoやConsumable、ActivityLogへのタグ付け。
- 階層タグ、色、アイコン、並び順のカスタマイズ、AIによる自動タグ付け。
- 「子ども」を人物台帳として管理すること、ログインアカウントを持たない家族メンバーの人物モデル。

## ロールアウト

`d1/migrations/0029_managed_item_tags.sql`はテーブルと索引を足すだけの後方互換なexpand migrationである。

| 状態 | 読み書き | 互換性 |
|---|---|---|
| 現在のWorker + 現在のschema | タグなし | - |
| migration適用直後 + 現在のWorker | 旧Workerは新テーブルに触れず、ManagedItemの登録・編集はこれまでどおり | 問題なし |
| migration適用後 + 新Worker | タグの作成・付与・解除・表示 | 問題なし |
| 新Workerから旧Workerへ戻した場合 | 付与済みタグが表示されなくなるだけ。旧WorkerはManagedItemを編集しても`managed_item_tags`へ触れないため、タグは消えない | 問題なし |

削除すべき旧構造・同期処理・暫定制約を残さないため、後続のcontract migrationはない。

## 結果

- 分類軸を変えずに、「子どもA」のような横断的な文脈で複数のManagedItemを結び付けられる。
- タグの作成は登録・編集の流れの中で完結し、別画面へ移動しなくてよい。
- 削除・名前変更を持たないため、誤って作ったタグは選択肢に残り続ける。

## 見直す条件

- 誤作成や表記揺れのタグが増え、整理(名前変更・統合・削除)が必要だと確認された場合。
- 全角・半角などの表記揺れで同じ意味のタグが重複する問題が確認された場合。
- タグの数が増え、チェックボックスの一覧では選びにくくなった場合。
- タグによる検索・絞り込みが日常利用で繰り返し必要になった場合(YDR-028の見直す条件と同じ)。
