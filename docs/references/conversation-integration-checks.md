---
type: Playbook
title: 会話連携の実接続と回帰検証
description: 定期取得先行版の確認入口と、実dot・実HTTP・ローカルD1で検証した範囲を分ける
tags: [yamoru, integration, notifications, testing]
status: draft
---

# 会話連携の実接続と回帰検証

今回の範囲は[YDR-070](../decisions/ydr-070-free-polling-first.md)と[会話連携設計](../product/conversation-integration.md)のE1/E2/E4/E5/E6/E7/E8。E3とE6のEvents購読部分は後続#474であり、成功とは扱わない。本番公開・実家庭データ・物理端末の確認は含めない。

## 利用者と接続先の入口

- アカウント→外部サービスとの連携→「会話連携の始め方・通知が来ないとき」。`/settings/integrations/guide`で現在の環境のMCPアドレス、許可範囲、一度だけの確認、外部の定期タスク、返答と履歴、停止・再連携を案内する。新規受付が無効ならその旨を表示する。
- 通知設定には保存済みのON/OFF・休止・接続可否を示す。外部の定期タスクはYAMORUから作成・停止せず、稼働状況や次回予定を取得できない。設定の保存やAPIの対応をタスク稼働の証明にしない。
- `connection_get.capabilities.notification_polling`は`{supported:true,executor:"connected_client",external_task_status:"unknown",interval_hint_minutes:15,requires_scopes:["household.read","events.subscribe"]}`を返す。15分は提案であり起動・到達の保証ではない。`integration_guide_url`は同じ環境の導入・復旧画面を指す。従来の`events`と`notification_delivery:false`は維持し、外部の定期取得対応は新しい項目で明示する。
- 解除後は接続先からOAuthをやり直し、本人設定の通知先も選び直す。解除前の家庭記録は残す。結果不明の変更は同じ操作IDの`operation_get`へ戻し、別IDで再実行しない。

## 検証の種類を混ぜない

| 条件 | ローカルの実HTTP・SDK・D1 | previewの実dotで確認済みの範囲 |
|---|---|---|
| E1 接続・家庭境界 | `e2e/mcp-integration.spec.ts`で同意・PKCE・実token endpoint・Tool発見・他家庭の照会/変更拒否・未所属の同意拒否 | #439の接続・本人照会・権限不足と再連携。別家庭・未所属のpreview実接続は#444で最終確認する |
| E2 登録・過去日完了・次回・訂正/取消 | 同HTTP E2E、command/replyのD1試験。同ID再送と保存結果も照合 | #439の登録→取得→完了→次回確認、#443の過去日完了・訂正・安全な取消 |
| E4 再送・中断・lease・回復 | 公式SDKでcommit応答喪失を注入。poll/outboxのD1試験で再起動・期限・順序・原子性・unknownを確認 | #442で重複抑止、#443で同じ取消結果を再取得。実dotにネットワーク故障を注入したとは扱わない |
| E5 家族の先行完了・snooze・静かな時間 | HTTPで別家族principalの同時完了。通知policy/frame/scheduleとreplyのD1 fixture。タイムゾーン・DSTを純粋計算で確認 | #443の本人snoozeと共有期限の不変。家族の先行完了は#444で最終確認する |
| E6 停止・失効・解除 | HTTPの解除後401。OAuth/notification/replyのD1試験で期限・所属・scope・batch直前の失効を確認 | #439の解除/再連携、#442/#443の通知OFF・一時タスク停止・次回予定なし。最終版の解除/再接続を#444で照合する |
| E7 定期取得 | poll claim/ack・重複・回復をD1と実HTTPで検証 | [#442の実測](https://github.com/upu/YAMORU/issues/442#issuecomment-6248489269)：保存済み15分周期、実際の2回の起動、1回の案内、2回目の重複なし、停止。周期と実測遅延を区別する |
| E8 通知への返答 | 元の回・複数選択・保持期限・次回誤操作拒否・原子性をD1で確認 | [#443の実測](https://github.com/upu/YAMORU/issues/443#issuecomment-6249193835)：選択確認、完了・通知延期・期限変更・訂正・取消・結果再取得。3件まとめは手動一回で、新しい周期実証ではない |

ローカルHTTP E2Eは架空client・架空家庭を使い、通常のNextとビルド済みWorkerへ同じテストを通す。第二家族の同意はfixtureで用意するがtoken交換とMCP操作はHTTPで行う。preview実dotや実家庭をその成功だけで代替しない。#444の未確認欄と最終gateを照合してから、#444と親#189を閉じる。

## ローカルD1のbookmark障害

Next devとE2E fixtureは同じSQLiteを別接続で使う。Wrangler 4.129.1のMiniflareでは、SELECT後のsession bookmark保存がwrite lockで失敗すると`D1_ERROR: Failed to parse body as JSON, got: Error: internal error`へ逃げていた。`tests/local-d1-bookmark.test.ts`で一時DBの別SQLite接続に`BEGIN IMMEDIATE`を持たせ、同じ`queryExecute`のスタックを再現した。

[upstream #14921](https://github.com/cloudflare/workers-sdk/pull/14921)の修正を含む最初のWrangler 4.148.0（Miniflare 5.20261006.0-alpha）へ更新する。bookmark失敗時の単独write/batchのrollbackと再試行一回分だけの保存を同じ一時DBで確認する。schemaや配備済みD1の手動変更はない。

更新後も短い競合はcatch可能な`Failed to get session commit token`になる。台帳詳細の本体・関連項目・家族名の読み取り全体だけを`retryLocalD1Read`で最大4回、合計250ms待ちで回復する。既知の接頭辞だけが対象で、旧来の曖昧なJSONエラー、任意のSQLエラー、変更処理を再送しない。解消しなければ通常のエラーとして残す。ログは`yamoru.local_d1_read_retry`とattemptだけで、SQL・家庭データ・秘密を出さない。RSC切断など別の失敗まで解決済みとはしない。

## E2Eの保存完了と画面遷移

通常E2Eで、登録POSTの35.6ms後に一覧へ移動し、担当変更POSTの15.6ms後にreloadしていた。登録前の`/managed-items/new`も従来の詳細URL判定に一致し、担当selectも保存より先に値だけ変わるため、どちらも保存完了の証拠になっていなかった。担当変更時のRSC `The destination stream closed early`も、この応答途中のreloadに伴っていた。

該当テストは送信前からPOST応答を待ち、`response.finished()`後に登録後固有の見出しや再読込後の永続値を確認する。登録と担当変更には200msのテスト通信遅延を入れ、修正前の両失敗と修正後の成功を照合する。本体の変更処理を再送したり、切断ログ全般を隠したりしない。

同一ブラウザーでの家族の切り替えは`e2e/account-switch.spec.ts`で、ログアウト後の保護画面拒否、別家族のメールとニックネーム、reload、ログイン画面からの再認証を確認する。[#477](https://github.com/upu/YAMORU/issues/477)ではmiddlewareのCookie自動更新が以前の本人を復活させる問題を再現し、別タブの読み取り応答をログアウト後に到着させる回帰条件も追加した。previewでの本人のメール・名前は、最終版の配備後に実ブラウザーで別途照合する。

## 公式SDKのエラー応答

公式SDKは`isError:true`でも`structuredContent`があれば公開outputSchemaで検証する。成功形だけでは正しい越境拒否もschemaエラーへ変わる。公開schemaは従来の成功形と`{error:{code,message,...}}`のunionをobject rootで示す。SDK server内部の成功時検証は従来のobject schemaを維持する（serverはroot unionを正規化できず、エラー時は検証を省略するため）。2026入口と旧入口は同じ公開schemaを使う。実HTTPと公式SDKの越境拒否を回帰条件に含める。
