---
type: Component Map
title: 会話連携の読み取り
description: 家庭内候補検索、詳細、履歴、共通の日付状態とrevision
tags: [yamoru, integration, d1]
status: stable
---

# 会話連携の読み取り

## 変更モデルと配備

#435では照会だけを提供する。利用者の予定や履歴は変更しない。名称・メモは利用者作成データとして返す。別名は家庭共有の補助情報で、既存対象との家庭一致を複合FKで保証し、対象削除時にcascadeする。別名編集の公開操作/UIは含めない。

前提として[#450](https://github.com/upu/YAMORU/issues/450)の互換Workerを先に配備する。D1のmeta.changesはtriggerの副作用も含むため、従来の`=== 1`判定のWorkerへ0032を適用してはいけない。以下の「旧Worker」は#450適用済みWorkerを指す。

既存の行、ID、timestamp、履歴は保持する。家庭ごとの単調増加世代を追加し、旧WorkerのINSERT/UPDATE/DELETEもtriggerで捕捉する。revisionは対象種別・IDと家庭世代を含むため、無関係な家庭内更新でも失効する保守的な方式。#437はcommitの原子的条件へこの世代を含める。更新時刻だけを競合検出に使わない。

| 状態 | 読み書きと互換性 |
|---|---|
| 現Worker + 現schema | 既存Webの読み書き |
| 0032適用後 + 旧Worker | 既存SQLのまま動作。triggerが世代を更新。既存timestampは変更しない |
| 0032適用後 + 新Worker | 共通読み取りと別名・revisionを利用。外部認証は#436、MCP公開は#439で接続 |
| contract | 不要。追加表とtriggerは恒久的な構造であり撤去しない |

Workerだけ旧版へ戻せる。既存データの変換・削除がないため、contract Issueは不要。preview/productionへの手動適用は行わない。0031は並行する#449用に予約し、0032は0031へ依存しない。

## 入口と引き継ぎ

- `src/features/integration/read.ts`: `createHouseholdReader({ db, authorize, cursorSecret, now? })`の`entitySearch`、`entityGet`、`historyList`。要求はunknownから検証し、公開wire名は`entity_search/entity_get/history_list`。HTTP/MCP endpointは#439が接続する。
- `authorize`は要求本文からPrincipalを作らず、#436の検証済みtokenまたはWebの検証済みセッションを使う。毎回、読み取り前後に呼び、grantの期限・失効を再検証する。家庭所属と`household.read`は共通層でも検証する。#449の`IntegrationPrincipal`と構造的に互換で、OAuthコードを複製しない。
- `cursorSecret`は32バイト以上のサーバー専用のランダム鍵を#439で環境から供給する。コードに秘密を固定しない。鍵交換時のcursorは再取得する。
- `src/lib/d1/conversation-read.ts`: 家庭に限定したSELECT。履歴は追記訂正と元ログを別行で返す。元の補充履歴にないactor/client/performerはnull。補充の暦日はdate_precision: day、入力精度を保存していない旧完了日時はunknownとし、日時から入力精度を推測しない。次回予定を新規算出せず、保存されたOccurrenceを返す。
- `src/features/todos/projection/`: 画面と共通の日付・期限分類。旧`src/app/`のimport入口はre-exportで保つ。ホームの名前・関連先も現在RuleではなくOccurrence snapshotを優先する。

## 検索とページング

履歴は記録日時の新しい順に返し、cursorで古い記録へ進む。同じ記録日時は種別・IDを含むキーで順序を固定する。実施日のバックデートとは区別し、実施日順ではない。

名称・登録別名・Todoのsnapshotにある関連する管理対象名をNFKC、英小文字、かな統一、空白除去で比較し、一致フィールドと元の値を返す。外部の類義語サービスや意味推測は使わず、複数候補を一件へ決定しない。通常Web検索の対象拡張(#351)は含めない。別名は一対象10件まで。別名の登録/編集UIや公開commandはこの読み取りIssueには含めない。

候補は既定20・最大50件、DBから一回に読む候補行は継続判定用を含め201件まで。日本語の正規化を正確に行い、旧Workerの変更を古い検索索引で見落とさないため、安定したkind/id順に上限付きで走査する。**空ページでもnext_cursorがある場合は続きを取得する。** search_complete=trueになるまで検索完了や候補一意を断定しない。

cursorはHMAC-SHA256、15分有効。本人・家庭・client・接続・正規化した条件・limit・家庭世代に束縛する。データ更新/改ざん/条件変更ではinvalid_cursor、期限切れはcursor_expiredとなる。いずれもcursorを外して最初から取得する。アダプタは`ReadError.code`と`recovery`をエラー応答へ写す。read_conflictは読み取り中の更新なので、cursorを外して同じ条件の先頭から再取得する。古いcursorは更新前の世代に束縛されているため再利用しない。読み取りは副作用を持たない。

revisionは家庭単位の保守的な世代。updated_atはその世代のchanged_atであり、`updated_at_scope: household_revision`を必ず返す。過去に記録していない「個別対象の最終編集日時」を生成しない。対象のcreated_atは既存値のまま保持する。

予定日・現在期限・必達日・推奨期間（recommended_windowのstart/end/state）は別フィールドで返し、Asia/Tokyoの暦日へ投影する。Occurrenceに現在Ruleの予定条件を上書きせず、Rule照会はcurrent_rule、Occurrence照会はoccurrence_ruleを返す。関連IDは最大50件とhas_moreだけを返し、関連の全件展開はしない。既存Webに詳細画面がないskipped回のdetail_urlはnullとし、404のリンクを作らない。完了/取消の可否をread権限から推定せず、変更commandは#437/#438が追加する。

## 検証

- 会話向け候補検索・詳細・履歴・revision: `src/lib/d1/conversation-read.d1-test.ts`

消耗品の`last_refilled_on`は有効な補充から導出し、観測や取消済み補充を含めない。在庫の履歴は原記録・訂正・取消をそれぞれ返し、`details.record_id`と`record_revision`で訂正対象を識別する。原記録には現在有効な日付・状態・版・取消状態も返す。日付不明の保存状態はWeb履歴へ残し、会話の実施履歴には混ぜない([YDR-057](../decisions/ydr-057-stock-observation-and-refill-history.md))。

`conversation-read.d1-test.ts`（家庭、scope、候補、ページング、snapshot、状態分類、履歴、読取り中の変更）、`conversation-read-migration.d1-test.ts`（旧SQL、rollback、複合FK、別名上限、cascade）、`tests/conversation-read.test.ts`（入力・署名・主体束縛・期限）。全unit/D1/E2Eとschema照合を実行する。実OAuth/MCP接続の成功を意味しない。
