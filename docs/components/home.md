---
type: Component Map
title: ホームの修正箇所マップ
description: ホーム画面の責務、最初に読む実装とテスト、守る不変条件、関連する有効なYDRへの入口
tags: [yamoru, components, home]
status: stable
---

# ホームの修正箇所マップ

## 責務

認証済み利用者の家庭について、いま対応する未完了Todo、直近の実施記録、買い物候補、ピン留めした消耗品を1画面へ集約する。Todoの登録・編集や消耗品の詳細操作は各機能側が持ち、ホームは表示と既存操作部品の呼び出しに限る。

## 主要入口

| 役割 | 実装 |
|---|---|
| 画面組み立てと表示区分 | `src/app/page.tsx`(`HomeContent`、`HomeSection`、`buildRecentItems`) |
| 未完了Todoの分類 | `src/app/pending-todo.ts` |
| 期限・推奨期間の表示状態と文言 | `src/app/task-schedule.ts`、`src/app/time-zone.ts` |
| Todoカードと完了操作 | `src/app/todo-card.tsx` → `src/features/todos/components/complete-todo-panel.tsx` |
| 消耗品の表示 | `src/app/pinned-consumables.tsx`、`src/app/shopping-candidates.tsx` |
| データ取得 | `src/lib/d1/home.ts`、`src/lib/d1/consumables.ts`、`src/lib/d1/consumable-pins.ts` |

## 重要な不変条件

- 未完了Todoの分類は`src/app/pending-todo.ts`の一箇所で行う。ホームは「いま対応すること」だけを出し、Todo一覧(`/todos`)は同じ分類結果を並べ替えて全件出す。ホーム専用の分類規則を増やさない。
- 予定日未定のOccurrenceはホームの要対応表示へ出さず、Todo一覧で扱う([YDR-031](../decisions/ydr-031-undated-todos-out-of-home.md))。
- メンテナンスTodoは推奨期間の進み具合に応じた4状態で表示する。しきい値は`src/app/task-schedule.ts`の`maintenanceReminderThresholdDays`が唯一の定義([YDR-034](../decisions/ydr-034-maintenance-home-progress-states.md))。
- 完了操作はホーム専用の保存処理を持たず、`CompleteTodoPanel`(→`src/features/todos/actions/completion.ts`)を共有する。同じ部品を台帳詳細と検索結果も使う。
- 通知機能を持たず、気づきの導線はホームへ集約する([YDR-009](../decisions/ydr-009-drop-notifications-consolidate-home.md))。

## 関連YDR

- 有効: [YDR-009](../decisions/ydr-009-drop-notifications-consolidate-home.md)、[YDR-031](../decisions/ydr-031-undated-todos-out-of-home.md)、[YDR-034](../decisions/ydr-034-maintenance-home-progress-states.md)、[YDR-012](../decisions/ydr-012-separate-occurred-recorded-scheduled-due.md)
- 過去の経緯として読む: [YDR-017](../decisions/ydr-017-strict-deadline-vs-maintenance-recommended-window.md)(推奨期間内の開始条件のみ[YDR-027](../decisions/ydr-027-maintenance-reminder-progress-ratio.md)が置き換え、さらにYDR-027全体をYDR-034が置き換えた)。厳密な期限と推奨期間を区別する枠組み自体はYDR-017の記述が現在の実装の背景である。

## 検証方法

```
npm test -- tests/home.test.tsx tests/home-sections.test.ts tests/task-schedule.test.ts
npm run lint
npm run typecheck
```

家庭間分離やクエリーを変える場合は[データベースに影響する変更の手順](../references/database-change-playbook.md)に従い、`npm run test:d1`も実行する。
