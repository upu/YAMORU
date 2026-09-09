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
| ホームに出す内容・並び・状態表示 | `src/app/page.tsx`、`src/app/pending-todo.ts`、`src/lib/d1/home.ts` | `tests/home.test.tsx`、`tests/home-sections.test.ts` | [ホーム](home.md) |
| Todoの登録 | `src/app/todos/new/actions.ts` → `src/lib/d1/todos/creation.ts` | `tests/todo-registration-actions.test.ts`、`tests/todo-registration-calendar-actions.test.ts` | [Todo](todos.md) |
| 繰り返し条件の入力解釈・制約値(登録・編集で共通) | `src/app/todos/calendar-schedule-input.ts`、`src/app/todos/todo-input-limits.ts` | `tests/todo-calendar-schedule-input.test.ts`、`tests/todo-recurrence-shared-input.test.ts` | [Todo](todos.md) |
| Todoの編集(1回だけ / 現在回 / 次回以降) | `src/app/todos/[id]/actions.ts` → `src/lib/d1/todos/edit.ts`、`src/lib/d1/todos/recurring-edit.ts` | `tests/todo-edit-actions.test.ts`、`src/lib/d1/recurring-todo-edit.d1-test.ts` | [Todo](todos.md) |
| Todoの完了・完了取消・実施記録の訂正 | `src/app/managed-items/[id]/actions.ts` → `src/lib/d1/todos/completion.ts`、`src/lib/d1/todos/corrections.ts` | `tests/complete-maintenance-task-actions.test.ts`、`tests/undo-maintenance-task-completion-actions.test.ts`、`tests/correct-completion-actions.test.ts` | [Todo](todos.md) |
| 繰り返し条件と次回予定の計算 | `src/lib/d1/calendar.ts`、`src/lib/d1/calendar-schedule-specs.ts` | `tests/d1-calendar.test.ts`、`src/lib/d1/interval-recurrence.d1-test.ts`、`src/lib/d1/monthly-weekday-calendar.d1-test.ts` | [Todo](todos.md) |
| 期限・推奨期間の表示状態(そろそろ等) | `src/app/task-schedule.ts`、`src/app/pending-todo.ts` | `tests/task-schedule.test.ts` | [ホーム](home.md) |
| 台帳(備品・サービス・契約)の登録・編集・分類 | `src/app/managed-items/actions.ts` → `src/lib/d1/managed-items.ts` | `tests/managed-item-actions.test.ts`、`src/lib/d1/managed-item-classification.d1-test.ts` | [台帳](managed-items.md) |
| 詳しい種類のAI提案 | `src/app/managed-items/item-type-suggestion-actions.ts` → `src/lib/managed-items/item-type-suggestion.ts`、`src/lib/d1/item-type-suggestions.ts` | `tests/managed-item-type-suggestion-actions.test.ts`、`src/lib/d1/managed-item-type-suggestions.d1-test.ts` | [台帳](managed-items.md) |
| 消耗品の在庫状態 | `src/app/consumables/stock-actions.ts` → `src/lib/d1/consumables.ts`の`updateConsumableStockStatus` | `tests/consumable-stock-actions.test.ts`、`src/lib/d1/consumable-stock.d1-test.ts` | [消耗品](consumables.md) |
| 消耗品の登録・補充記録・関連・お気に入り | `src/app/consumables/actions.ts`、`src/app/consumables/refill-actions.ts`、`src/app/consumables/relation-actions.ts`、`src/app/consumables/favorite-actions.ts` | `tests/consumable-actions.test.ts`、`tests/consumable-refill-actions.test.ts`、`src/lib/d1/consumable-favorites.d1-test.ts` | [消耗品](consumables.md) |
| 横断検索(下部ナビの「検索」) | `src/app/search/page.tsx` → `src/lib/d1/cross-search.ts` | `tests/search-ui.test.tsx`、`src/lib/d1/cross-search.d1-test.ts`、`e2e/cross-search.spec.ts` | [検索](search.md) |
| 画面内検索(Todo一覧・台帳の絞り込み) | `src/lib/d1/text-search.ts`、`src/lib/d1/home.ts`、`src/app/managed-items/search-href.ts` | `tests/managed-items-search-ui.test.tsx`、`src/lib/d1/todo-filters.d1-test.ts` | [検索](search.md) |
| ログイン・パスワード | `src/auth.ts`、`src/app/login/actions.ts`、`src/app/account/password-actions.ts` → `src/lib/d1/authentication.ts` | `tests/auth-actions.test.ts`、`tests/password-change-actions.test.ts`、`src/lib/d1/authentication.d1-test.ts` | [認証・家庭・招待](household-access.md) |
| 家庭の作成 | `src/app/household/actions.ts` → `src/lib/d1/households.ts` | `tests/household-actions.test.ts`、`tests/household-ui.test.tsx` | [認証・家庭・招待](household-access.md) |
| 招待の発行・取消・受諾 | `src/app/household/invitation-actions.ts`、`src/app/invitations/accept/` → `src/lib/d1/invitations.ts` | `tests/invitation-actions.test.ts`、`tests/invite-accept-actions.test.ts`、`e2e/family-sharing.spec.ts` | [認証・家庭・招待](household-access.md) |
| 家庭間分離(household_idの扱い) | `src/lib/d1/authorization.ts`、`src/lib/d1/context.ts` | `src/lib/d1/authorization.d1-test.ts`、`src/lib/d1/**/*-authorization.d1-test.ts` | [認証・家庭・招待](household-access.md) |

## まだ実装していない領域

Documents(ファイル添付)、Payments、Replacementは[YDR-003](../decisions/ydr-003-defer-inventory-attachments-payments-replacement.md)により後続Phaseとし、現時点で対応する実装を持たない。同YDRで「独立したPhaseとして追加する」とした在庫は、消耗品として実装済みであり[消耗品](consumables.md)で扱う。
