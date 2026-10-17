import type { TodoListSchedule, TodoTone } from "./task-schedule";

export type TodoCardItem = {
  mustCompleteBy?: string;
  hardDeadlineToday?: boolean;
  // 必達日のバッジを優先しても、元の予定・推奨期間の状態を併記する。
  scheduleState?: string;
  // pending Todoにだけ設定する。未設定(誰でも可)はnull。
  assigneeUserId?: string | null;
  badge?: string;
  detail: string;
  detailHref?: string;
  id: string;
  // Issue #243: コンパクトなリスト表示(todo-list-row.tsx)専用。pending
  // Todoにだけ設定し、item.metaの文章は解析しない(設計メモ案1)。
  listSchedule?: TodoListSchedule;
  // Todoに関連する管理対象。家庭共通Todoではnull、完了・未完了のどちらにも設定する。
  managedItemId?: string | null;
  // Issue #267: 予定日未定カードは空文字にし、TodoCardは何も描画しない
  // (バッジの「未定」ですでに意味が伝わるため、文章を重ねない)。
  meta: string;
  // pending Todoにだけ設定し、担当・完了操作を有効にする。
  occurrenceId?: string;
  // Issue #243: 実施済みTodoにだけ設定する、コンパクトなリスト表示専用の
  // 実施時期・実施者(item.metaの文章は解析しない)。
  performedAt?: string;
  performedByName?: string;
  title: string;
  // pending Todoにだけ設定する、Todo詳細(/todos/:id)への導線(Issue #203)。
  todoHref?: string;
  tone: TodoTone;
};
