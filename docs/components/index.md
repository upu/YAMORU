# Components

変更したいことから、最初に読む実装・テスト・詳細文書へたどるための対応表。
仕様の全文はここに置かず、正本(コード、マイグレーション、YDR)へ案内する。

## Reading rules

- まずこの表で対象の行を選び、その行の実装・テストだけを読む。全関数一覧は持たない。
- 表の「最初に読む実装」は入口であり、網羅ではない。入口から先はコードのimportをたどる。
- 「詳細文書」は責務・不変条件・関連YDR・検証方法だけを短く書く。仕様の再要約はしない。
- 意思決定は各文書の`decision_status`を確認し、`Accepted`で置き換えられていないものだけを現在有効として扱う([Decision knowledge](../decisions/index.md))。
- データベースへ影響する変更は[データベースに影響する変更の手順](../references/database-change-playbook.md)に従う。
- コードを移動したときは、同じPRでこの表と該当の詳細文書も更新する。

## 対応表

| 変更したいこと | 最初に読む実装 | テスト | 詳細文書 |
|---|---|---|---|
| 本人の通知設定・スヌーズ・配信履歴 | `src/app/settings/notifications/`、`src/features/integration/notifications/` → `src/lib/d1/notification-settings.ts`、`notification-policy.ts`、`notification-deliveries.ts` | `tests/notification-*.test.*`、`src/lib/d1/notification-*.d1-test.ts`、`e2e/notification-settings.spec.ts` | [個人の通知](notifications.md) |
| 通知outbox・lease・永続走査の進捗 | `worker.ts` → `src/features/integration/notifications/scheduler.ts`、`src/lib/d1/notification-outbox.ts`、`notification-scheduler.ts` | `src/lib/d1/notification-outbox*.d1-test.ts`、`notification-scheduler.d1-test.ts`、`e2e/notification-scheduler.worker-e2e.ts` | [通知outbox・定期走査](notification-outbox.md) |
| 検査済みIPと元hostnameのTLS検証部品 | `packages/pinned-tls/src/lib.rs`、`generated/`、`scripts/pinned-tls-build.ts` | `tests/pinned-tls-engine.test.ts`、`scripts/pinned-tls-probe.ts` | [固定IPのTLS試験](../spikes/pinned-tls.md) |
| public DNS・固定IPのHTTP送信・Worker provider | `notifications/worker-transport.mjs`、`worker-events.ts` → `notifications/http/` | `tests/notification-{dns-resolver,http-response,pinned-connector,worker-events,http-evidence}.test.ts`、`scripts/pinned-http-probe.ts` | [通知outbox・定期走査](notification-outbox.md)、[YDR-069](../decisions/ydr-069-pinned-http-runtime.md) |
| 通知の宛先ごとの結果・再試行・購読世代 | `src/lib/d1/notification-event-dispatch.ts`、`notification-recipient-state.ts` | `notification-event-dispatch.d1-test.ts`、`notification-event-lifecycle.d1-test.ts`、`notification-event-recipients-migration.d1-test.ts` | [通知outbox・定期走査](notification-outbox.md) |
| 日次まとめの本文・全件の開始と保存・中断回復 | `src/lib/d1/notification-event-groups.ts` → `notifications/event-job.ts` | `notification-event-groups.d1-test.ts`、`notification-event-groups-migration.d1-test.ts` | [通知outbox・定期走査](notification-outbox.md) |
| 保存済み通知の定期送信・全親の一括確保・権限縮小後の回収 | `notifications/event-scheduler.ts` → `src/lib/d1/notification-event-work.ts`、`notification-policy.ts` | `notification-event-scheduler.d1-test.ts`、`notification-policy-frame.d1-test.ts` | [通知outbox・定期走査](notification-outbox.md) |
| 定期取得の候補確保・案内報告・期限切れ回収 | `commands/notification-poll.ts` → `src/lib/d1/notification-poll*.ts` | `notification-poll-commands.d1-test.ts`、`notification-poll-migration.d1-test.ts`、`integration-mcp.d1-test.ts` | [通知outbox・定期走査](notification-outbox.md) |
| 署名付きPOSTと宛先別の送信job | `src/features/integration/notifications/event-delivery.ts`、`event-job.ts` | `tests/notification-event-delivery.test.ts`、`src/lib/d1/notification-event-job.d1-test.ts` | [通知outbox・定期走査](notification-outbox.md) |
| Eventsの購読・callback検証・署名 | `src/features/integration/mcp/server-events.ts` → `notifications/event-subscriptions.ts`、`event-crypto.ts`、`webhook-transport.ts`、`src/lib/d1/notification-event-subscriptions.ts` | `tests/notification-event-*.test.ts`、`tests/notification-webhook-transport.test.ts`、`src/lib/d1/notification-event-subscriptions*.d1-test.ts` | [通知outbox・定期走査](notification-outbox.md) |
| 通知候補の理由・順序・差分取得 | `src/features/integration/attention/service.ts`、`projection.ts` → `src/lib/d1/attention.ts` | `tests/attention-projection.test.ts`、`src/lib/d1/attention*.d1-test.ts` | [通知候補](attention.md) |
| ホームに出す内容・並び・状態表示 | `src/app/page.tsx`、`src/app/home-hero.tsx`、`src/app/pending-todo.ts`、`src/lib/d1/home.ts` | `tests/home.test.tsx`、`tests/home-sections.test.ts`、`e2e/home-summary.spec.ts` | [ホーム](home.md) |
| Todoの登録 | `src/app/todos/new/actions.ts` → `src/lib/d1/todos/creation.ts` | `tests/todo-registration-actions.test.ts`、`tests/todo-registration-calendar-actions.test.ts` | [Todo](todos.md) |
| 繰り返し条件の入力解釈・制約値(登録・編集で共通) | `src/app/todos/calendar-schedule-input.ts`、`src/app/todos/todo-input-limits.ts` | `tests/todo-calendar-schedule-input.test.ts`、`tests/todo-recurrence-shared-input.test.ts` | [Todo](todos.md) |
| Todoの編集(1回だけ / 現在回 / 次回以降) | `src/app/todos/[id]/actions.ts` → `src/lib/d1/todos/edit.ts`、`src/lib/d1/todos/recurring-edit.ts` | `tests/todo-edit-actions.test.ts`、`src/lib/d1/recurring-todo-edit.d1-test.ts` | [Todo](todos.md) |
| 各回の必達日の設定・解除 | `src/features/todos/actions/hard-deadline.ts` → `src/lib/d1/todos/hard-deadline.ts`、`src/app/pending-todo.ts` | `tests/hard-deadline.test.ts`、`src/lib/d1/hard-deadline.d1-test.ts`、`e2e/hard-deadline.spec.ts` | [Todo](todos.md) |
| Todoの完了・完了取消・実施記録の訂正 | `src/features/todos/actions/completion.ts`、`src/features/todos/actions/correction.ts` → `src/lib/d1/todos/completion.ts`、`src/lib/d1/todos/corrections.ts` | `tests/complete-maintenance-task-actions.test.ts`、`tests/undo-maintenance-task-completion-actions.test.ts`、`tests/correct-completion-actions.test.ts`、`tests/todo-detail-actions.test.tsx` | [Todo](todos.md) |
| Todoの担当・延期・予定日の変更(画面共通の操作) | `src/features/todos/actions/assignee.ts`、`src/features/todos/actions/schedule.ts`、UIは`src/features/todos/components/` | `tests/task-occurrence-assignee-actions.test.ts`、`tests/postpone-task-occurrence-actions.test.ts`、`tests/schedule-task-occurrence-actions.test.ts`、`tests/assignee-panel.test.tsx`、`tests/todo-detail-actions.test.tsx` | [Todo](todos.md) |
| 繰り返し条件と次回予定の計算 | `src/lib/d1/calendar.ts`、`src/lib/d1/calendar-schedule-specs.ts` | `tests/d1-calendar.test.ts`、`src/lib/d1/interval-recurrence.d1-test.ts`、`src/lib/d1/monthly-weekday-calendar.d1-test.ts` | [Todo](todos.md) |
| 期限・推奨期間の表示状態(そろそろ等) | `src/features/todos/projection/task-schedule.ts`、`src/features/todos/projection/pending-todo.ts`（app側はre-export） | `tests/task-schedule.test.ts` | [ホーム](home.md) |
| 台帳(備品・サービス・契約)の登録・編集・分類 | `src/app/managed-items/actions.ts` → `src/lib/d1/managed-items.ts` | `tests/managed-item-actions.test.ts`、`src/lib/d1/managed-item-classification.d1-test.ts` | [台帳](managed-items.md) |
| 台帳のタグ(作成・付与・解除・表示) | `src/app/managed-items/tag-input.ts`、`src/app/managed-items/tag-fields.tsx` → `src/lib/d1/tags.ts` | `tests/managed-item-tags-ui.test.tsx`、`src/lib/d1/managed-item-tags.d1-test.ts` | [台帳](managed-items.md) |
| 詳しい種類のAI提案 | `src/app/managed-items/item-type-suggestion-actions.ts` → `src/lib/managed-items/item-type-suggestion.ts`、`src/lib/d1/item-type-suggestions.ts` | `tests/managed-item-type-suggestion-actions.test.ts`、`src/lib/d1/managed-item-type-suggestions.d1-test.ts` | [台帳](managed-items.md) |
| 消耗品の在庫状態 | `src/app/consumables/stock-actions.ts` → `src/lib/d1/consumables.ts`の`updateConsumableStockStatus` | `tests/consumable-stock-actions.test.ts`、`src/lib/d1/consumable-stock.d1-test.ts` | [消耗品](consumables.md) |
| 消耗品の観測・補充履歴と訂正 | `src/app/consumables/[id]/history/`、`src/features/integration/commands/stock.ts` → `src/lib/d1/consumable-stock-history.ts`、`consumable-stock-read.ts` | `tests/stock-history.test.ts`、`src/lib/d1/stock-history*.d1-test.ts`、`stock-commands.d1-test.ts`、`e2e/stock-history.spec.ts` | [消耗品](consumables.md) |
| 消耗品の登録・補充記録・関連・ピン留め | `src/app/consumables/actions.ts`、`src/app/consumables/refill-actions.ts`、`src/app/consumables/relation-actions.ts`、`src/app/consumables/pin-actions.ts` | `tests/consumable-actions.test.ts`、`tests/consumable-refill-actions.test.ts`、`src/lib/d1/consumable-pins.d1-test.ts` | [消耗品](consumables.md) |
| 会話向け候補検索・詳細・履歴・revision | `src/features/integration/read.ts` → `src/lib/d1/conversation-read.ts` | `src/lib/d1/conversation-read.d1-test.ts`、`tests/conversation-read.test.ts` | [会話読み取り](conversation-read.md) |
| 横断検索(下部ナビの「検索」) | `src/app/search/page.tsx` → `src/lib/d1/cross-search.ts` | `tests/search-ui.test.tsx`、`src/lib/d1/cross-search.d1-test.ts`、`e2e/cross-search.spec.ts` | [検索](search.md) |
| 画面内検索(Todo一覧・台帳の絞り込み) | `src/lib/d1/text-search.ts`、`src/lib/d1/home.ts`、`src/app/managed-items/search-href.ts` | `tests/managed-items-search-ui.test.tsx`、`src/lib/d1/todo-filters.d1-test.ts` | [検索](search.md) |
| ログイン・パスワード | `src/auth.ts`、`src/app/login/actions.ts`、`src/app/account/password-actions.ts` → `src/lib/d1/authentication.ts` | `tests/auth-actions.test.ts`、`tests/password-change-actions.test.ts`、`src/lib/d1/authentication.d1-test.ts` | [認証・家庭・招待](household-access.md) |
| 家庭の作成 | `src/app/household/actions.ts` → `src/lib/d1/households.ts` | `tests/household-actions.test.ts`、`tests/household-ui.test.tsx` | [認証・家庭・招待](household-access.md) |
| 招待の発行・取消・受諾 | `src/app/household/invitation-actions.ts`、`src/app/invitations/accept/` → `src/lib/d1/invitations.ts` | `tests/invitation-actions.test.ts`、`tests/invite-accept-actions.test.ts`、`e2e/family-sharing.spec.ts` | [認証・家庭・招待](household-access.md) |
| 一覧の追加導線・詳細の戻る導線(位置と文言の共通規約) | `src/app/list-add-link.tsx`、`src/app/floating-add-button.tsx`、`src/app/detail-back-nav.tsx` | `tests/floating-add-button.test.tsx`、`tests/detail-page-navigation.test.tsx`、`tests/todo-registration-ui.test.tsx`、`e2e/floating-add-button.spec.ts`、`e2e/detail-back-navigation.spec.ts` | [スタイル](styles.md) |
| 初回操作ヒント・ヘルプの使い方 | `src/app/first-run-hint.tsx`、`src/app/help/page.tsx` | `tests/consumable-pins-ui.test.tsx`、`tests/help-page.test.tsx` | [スタイル](styles.md) |
| 画面の見た目(CSS)の置き場所 | `src/app/globals.css`(全体基盤と共有ルール)、部品ごとの`*.module.css` | 変更した画面のテスト・E2E | [スタイル](styles.md) |
| 外部クライアントの認可(OAuth)・同意画面・接続管理 | `src/features/integration/oauth/`、`src/app/oauth/authorize/`、`src/app/settings/integrations/` → `src/lib/d1/oauth-connections.ts` | `tests/integration-oauth-request.test.ts`、`tests/integration-connections-ui.test.tsx`、`src/lib/d1/oauth-flow.d1-test.ts`、`src/lib/d1/oauth-connections-authorization.d1-test.ts` | [外部連携](integration.md) |
| 外部クライアントのaccess token検証(MCPなど外部入口の共通) | `src/features/integration/oauth/bearer.ts`、`src/features/integration/principal.ts` | `src/lib/d1/oauth-flow.d1-test.ts` | [外部連携](integration.md) |
| 認証付きMCP入口・Tool定義・接続確認 | `src/app/mcp/route.ts` → `src/features/integration/mcp/` | `tests/integration-mcp-http.test.ts`、`src/lib/d1/integration-mcp.d1-test.ts`、`e2e/mcp-integration.spec.ts`、`config/playwright.worker.config.ts` | [MCP](mcp.md) |
| 外部クライアントの変更操作(prepare/commit・受付記録。Todoの登録・完了・訂正・取消) | `src/features/integration/commands/service.ts` → `src/lib/d1/integration-operations.ts`、`src/lib/d1/todos/command-plans.ts` | `tests/integration-command-input.test.ts`、`src/lib/d1/integration-commands.d1-test.ts`、`src/lib/d1/integration-history-commands.d1-test.ts`、`src/lib/d1/integration-create-commands.d1-test.ts` | [外部連携](integration.md) |
| 家庭間分離(household_idの扱い) | `src/lib/d1/authorization.ts`、`src/lib/d1/context.ts` | `src/lib/d1/authorization.d1-test.ts`、`src/lib/d1/**/*-authorization.d1-test.ts` | [認証・家庭・招待](household-access.md) |

## まだ実装していない領域

会話向けの共通読み取り(#435)、通知候補生成(#440)、本人の設定と履歴(#441)、認可と接続管理(#436)、実装済みcommand(#437/#438)、認証付きMCP入口(#439)は上の表に入口を示す。許可するclient_idを設定するまで外部受付は無効である。実dotとの接続実証・追加の変更操作・実際の配信は[会話連携設計](../product/conversation-integration.md)に契約と合格条件を定義している。MCP入口の実装やローカルSDKの成功は、実dotとの接続や通知の到達を証明しない。

Documents(ファイル添付)、Payments、Replacementは[YDR-003](../decisions/ydr-003-defer-inventory-attachments-payments-replacement.md)により後続Phaseとし、現時点で対応する実装を持たない。同YDRで「独立したPhaseとして追加する」とした在庫は、消耗品として実装済みであり[消耗品](consumables.md)で扱う。
