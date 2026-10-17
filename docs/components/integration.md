---
type: Component Map
title: 外部連携の修正箇所マップ
description: 会話エージェントなど外部クライアントへの委任(OAuth認可、同意画面、接続管理、access tokenの検証)と変更操作(prepare/commitと受付記録)について、最初に読む実装とテスト、守る不変条件、関連する有効なYDRへの入口
tags: [yamoru, components, integration, oauth]
status: stable
---

# 外部連携の修正箇所マップ

## 責務

利用者本人が、会話エージェントなどの外部クライアントへ家庭データへのアクセスを委任する仕組みを扱う([#436](https://github.com/upu/YAMORU/issues/436))。OAuth 2.1の認可サーバー(metadata、同意画面、token・revocation endpoint)、接続(grant)の保存と失効、外部入口でのaccess token検証、接続管理画面を含む。変更操作の共通基盤(command_prepare / command_commit / operation_getと受付記録、[#437](https://github.com/upu/YAMORU/issues/437))は、#437のcommandとしてTodoの登録・編集(`todo.update`)・完了・訂正・取消・延期(`todo.reschedule`)、管理対象の登録・編集、管理対象とTodoの同時登録の9つを持ち(本人の通知設定・スヌーズのcommandは[個人の通知](notifications.md))、競合は家庭の世代([YDR-053](../decisions/ydr-053-conversation-read-revisions.md))で検出する。追加確認(confirmation_url)はまだ無い。MCPのTool(#439)と通知(#440〜#442)もまだ無く、変更操作を外部へ公開する入口は存在しない。

## 主要入口

| 役割 | 実装 |
|---|---|
| scopeの定義と説明文 | `src/features/integration/scopes.ts` |
| 環境ごとの設定(受付の有効化、issuer、resource) | `src/features/integration/oauth/config.ts`、`src/features/integration/oauth/runtime.ts` |
| metadata(RFC 8414 / RFC 9728) | `src/features/integration/oauth/metadata.ts` → `src/app/.well-known/` |
| 認可要求の検証と応答URL | `src/features/integration/oauth/authorization-request.ts` |
| 同意画面と許可・拒否 | `src/app/oauth/authorize/` → `src/features/integration/oauth/authorize.ts` |
| CIMDの取得・検証 | `src/features/integration/oauth/client-metadata.ts` → `src/lib/d1/oauth-clients.ts` |
| token・revocation endpoint | `src/features/integration/oauth/token-endpoint.ts`、`revocation-endpoint.ts` → `src/app/oauth/token/`、`src/app/oauth/revoke/` |
| ライブラリ(`@node-oauth/oauth2-server`)とD1の接続 | `src/features/integration/oauth/model.ts`、`server.ts` |
| 接続・tokenの保存と失効 | `src/lib/d1/oauth-connections.ts`、`src/lib/d1/oauth-authorization-codes.ts` |
| access tokenの検証とPrincipal | `src/features/integration/oauth/bearer.ts`、`src/features/integration/principal.ts` |
| 接続管理画面 | `src/app/settings/integrations/` → `src/lib/d1/oauth-connection-list.ts` |
| 変更操作の入口(prepare/commit/operation_get) | `src/features/integration/commands/service.ts` |
| 変更操作の入力・エラー契約、command別の処理 | `src/features/integration/commands/contract.ts`、`input.ts`、`todo-complete.ts`、`todo-history.ts`、`todo-create.ts`・`todo-create-input.ts`、`managed-item-create.ts`・`managed-item-update.ts`・`managed-item-input.ts`、`todo-reschedule.ts`、`todo-update.ts`・`todo-update-input.ts` |
| 管理対象の入力規則(Webの登録と外部commandで共通) | `src/app/managed-items/form-input.ts`、`started-on.ts` → 保存の文は`src/lib/d1/managed-items.ts`の`managedItemInsertStatements`、commandの確認は`src/lib/d1/managed-item-commands.ts` |
| 繰り返し条件の入力規則(Webの登録と外部commandで共通) | `src/app/todos/recurrence-input.ts`、`src/app/todos/calendar-schedule-input.ts` → 保存形は`src/lib/d1/todos/creation.ts`の`*TaskInsert` |
| 受付記録の保存と、世代の確認・成功を確定させる文 | `src/lib/d1/integration-operations.ts` |
| 家庭の世代と`expected_revision`の照合 | `src/features/integration/commands/revision.ts` → `src/lib/d1/conversation-read.ts` |
| commandのpreview用の読み取りと業務更新の文 | `src/lib/d1/todos/command-plans.ts` → `completion.ts`、`corrections.ts`。延期・編集は`command-edits.ts` → `assignment.ts`、`recurring-edit.ts`、`edit.ts`、`hard-deadline.ts` |

## 重要な不変条件

- 受付は既定で無効。runtime変数`YAMORU_OAUTH_ALLOWED_CLIENT_IDS`に、実接続で検証したclient_id(CIMDのURL)を設定したときだけmetadata・同意画面・endpointが応答する([YDR-052](../decisions/ydr-052-oauth-authorization-server-on-d1.md))。CIMDは許可したclient_idだけを取得する。
- 外部入口は`authenticateBearerRequest` / `verifyAccessToken`を通し、そのPrincipalの`householdId`と`userId`だけを使う。要求本文の利用者IDや家庭IDで`getD1Context`を呼ばない([会話連携設計](../product/conversation-integration.md) 3節)。
- 検証のたびに、tokenの期限、issuer・resource、scope、接続の失効、接続時の家庭への現在の所属、パスワードの世代(`users.session_version`)を確かめる。所属を失った、またはパスワードが変わった接続は失効させ、別の家庭へ転用しない。
- 通知配信など、tokenを介さずに接続を使う処理(#442)は、送信直前に`isConnectionActive`で接続の有効性を確かめる。
- 生のcode・tokenはD1にもログにも残さない。保存はSHA-256だけ。ログは`logOAuthEvent`を通し、ID・理由コードだけを出す。
- 接続管理は本人の接続だけを扱う。同じ家庭の家族でも他人の接続を見たり解除したりできない。
- 変更操作は、業務の更新と受付記録の成功を同じD1 batchへ載せる。最初の`revisionGuardStatement`がpreview時の家庭の世代を、最後の`commitReceiptStatement`が条件(未確定・期限内・接続が有効・業務の記録が存在・取消/訂正の対象が最新の完了)を確かめ、満たさなければbatch全体を取り消す([YDR-054](../decisions/ydr-054-integration-command-receipts.md))。業務の更新はWeb操作と同じ条件付きSQL(`completionStatements`等)を使い、外部向けに判定を複製しない。
- 外部commandが書いた履歴(activity_logs・completion_corrections)は、idempotency_keyから受付記録を引いて接続元(`client_id`)を履歴の読み取りへ返す(`operationClientExpression`)。一つの操作が複数の履歴を書く場合は、`<business_key>:assignee`・`:due`・`:rule`・`:deadline`のように項目ごとのキーを使う。繰り返し条件・必達日の変更履歴(task_rule_changes・task_deadline_changes)のキー列は`d1/migrations/0038_integration_edit_history_keys.sql`で足した(追加だけのexpand migrationで、旧Workerの書き込みはNULLのまま通る。contract migrationは不要)。業務テーブルへ接続元の列は足していない。
- `todo.create`は、繰り返し条件の解釈と保存形(`*TaskInsert`・`taskInsertStatements`)をWebの登録と共有し、外部向けに別の暦計算や検証を持たない。完了日基準の初回は前回の実施日(`last_completed_on`)か最初の目安の始まり(`first_scheduled_on`)を必須とし、無ければ`missing_required`で聞き返す。定例日・固定間隔の初回はprepare時刻(`reference_at`)を基準に決める。
- `managed_item.create`は、名前・詳しい種類・外部リンク・メモ・商品情報・開始時期の規則(`form-input.ts`・`started-on.ts`)と保存の文をWebの登録と共有する。タグは既存タグのIDだけを受け付け、他の家庭のタグIDはbatchの前に`invalid_input`にする(Webは複合外部キー違反で取り消す)。
- `todo.reschedule`はWebの延期(`requirePostponable`・`postponeStatements`)と同じ判定・文を使い、今回の期限だけを動かす。延期の履歴にidempotency_keyを付け、受付記録の成功条件にする。必要時・予定日未定のTodoは拒否する。
- `todo.update`は対象の方式に合う`edit_scope`だけを受け付ける(暦を持つ方式は`current_occurrence`・`future_rule`、必要時は`manual_combined`、一回限りは`one_time_combined`)。指定した項目だけを現在の値へ重ね、Webの編集(`recurringOccurrenceStatements`・`recurringRuleStatements`・`oneTimeEditStatements`・`hardDeadlineStatements`)と同じ文で保存する。方式そのものは変えない。期限は変えたときだけ「今日より後・本来の予定日以降」を確かめ、名前だけの変更では繰り返し条件に触れない(`RuleBasicsUpdate`)。受付記録の成功は、変えた項目が変更後の値を持ち、現在回がpendingであることを条件にする。
- `managed_item.update`は指定した項目だけを現在の値へ重ね、Webの編集と同じ文(`managedItemUpdateStatements`)で保存する。分類(大分類・詳しい種類)のどれかを変えると、指定しなかった詳しい種類は未設定にする。更新は条件付きのため、batchの後に管理対象が編集後の値を持つこと(値を照合する証跡)を受付記録の成功条件にする。
- `managed_item_with_todo.create`は、管理対象とTodoの文を一つのbatchへ載せ、両方の行を受付記録の成功条件にする。Todo側の入力は`todo.create`と同じ解析を通し、関連先は作る管理対象に固定する(`managed_item_id`は受け付けない)。結果の`managed_item`・`todo`にもそれぞれのrevisionを付け、続く操作の`expected_revision`に使えるようにする。
- 「今」や「昨日」はprepare時に固定し、commitでは保存した正規化commandからpreviewを計算し直して、一致したときだけ実行する。同じ操作IDの再送は保存した結果を返す。
- 家庭の世代は保守的で、previewから実行までに家族が無関係なものを更新しても再確認(`stale_preview`)になる。

## 関連YDR

個人設定の読み取りと`notification.configure` / `notification.snooze`の入口・権限・配信との境界は[個人の通知](notifications.md)を参照する。

`stock.observe` / `stock.refill` / `stock.correct`の入口は`src/features/integration/commands/stock.ts`。Webと同じplanとbatch文を使う。観測と補充の区別・訂正・旧schemaとの互換性は[消耗品](consumables.md)と[YDR-057](../decisions/ydr-057-stock-observation-and-refill-history.md)、実D1検証は`stock-commands.d1-test.ts`を参照する。

- 有効: [YDR-049](../decisions/ydr-049-conversation-command-boundary.md)、[YDR-052](../decisions/ydr-052-oauth-authorization-server-on-d1.md)、[YDR-054](../decisions/ydr-054-integration-command-receipts.md)、[YDR-015](../decisions/ydr-015-occurrence-state-activitylog-history-safe-undo.md)、[YDR-026](../decisions/ydr-026-completion-correction-events.md)、[YDR-022](../decisions/ydr-022-cloudflare-workers-d1-migration.md)

## 検証方法

```
npm test -- tests/integration-oauth-request.test.ts tests/integration-connections-ui.test.tsx tests/auth-boundary.test.ts tests/integration-command-input.test.ts
npm run test:d1 -- src/lib/d1/oauth-flow.d1-test.ts src/lib/d1/oauth-connections-authorization.d1-test.ts src/lib/d1/oauth-clients.d1-test.ts src/lib/d1/oauth-connections-migration.d1-test.ts
npm run test:d1 -- src/lib/d1/integration-commands.d1-test.ts src/lib/d1/integration-history-commands.d1-test.ts src/lib/d1/integration-create-commands.d1-test.ts src/lib/d1/integration-managed-item-commands.d1-test.ts src/lib/d1/integration-edit-commands.d1-test.ts src/lib/d1/integration-update-commands.d1-test.ts src/lib/d1/integration-operations-migration.d1-test.ts src/lib/d1/integration-edit-history-keys-migration.d1-test.ts
```

D1テストは検証済みのOAuthクライアントライブラリ`oauth4webapi`をクライアント役にして流れ全体を確かめる。これは実際の接続先との接続確認(設計のE1)の代わりにはならない。変更操作のテストは、確認と実行の間に家族の更新や接続の解除を割り込ませ(`interruptBeforeBatch`)、業務データと受付記録が全成功か全取消になることを確かめる。
