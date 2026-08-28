import Link from "next/link";

import type { HouseholdMemberOption } from "../lib/d1/profiles";
import { AssigneePanel } from "./managed-items/[id]/assignee-panel";
import { CompleteTodoPanel } from "./managed-items/[id]/complete-todo-panel";
import { SchedulePanel } from "./managed-items/[id]/schedule-panel";
import type { TodoListSchedule, TodoTone } from "./task-schedule";

// ホーム(app/page.tsx)とTodo一覧(app/todos/page.tsx)は、同じTodoを
// 同じ見た目・同じ操作で扱う(Issue #201)。カードの表示と操作はここに一つだけ
// 置き、画面側は「どのTodoを、どの順序で並べるか」だけを決める。
export type TodoCardItem = {
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
  meta: string;
  // pending Todoにだけ設定し、担当・完了操作を有効にする。
  occurrenceId?: string;
  // 一回限りTodoにだけ設定する。nullは予定日未定、文字列は具体日あり。
  oneTimeScheduledFor?: string | null;
  // Issue #243: 実施済みTodoにだけ設定する、コンパクトなリスト表示専用の
  // 実施時期・実施者(item.metaの文章は解析しない)。
  performedAt?: string;
  performedByName?: string;
  title: string;
  // pending Todoにだけ設定する、Todo詳細(/todos/:id)への導線(Issue #203)。
  todoHref?: string;
  tone: TodoTone;
};

// Issue #224: コンパクトなリスト表示(todo-list-row.tsx)でも同じ既定ラベルを
// 使うため、ここでexportして単一の定義を共有する。
export const TONE_LABELS: Record<TodoTone, string> = {
  caution: "要確認",
  done: "完了",
  reminder: "そろそろ",
  today: "今日",
  upcoming: "予定",
  urgent: "要対応",
};

// Issue #203・#206: 未完了・完了済みのどちらもTodo名からTodo詳細へ移動し、
// 管理対象名から管理対象の詳細へ移動する。
function TodoCardTitle({ item }: { item: TodoCardItem }) {
  const titleHref = item.todoHref ?? item.detailHref;
  return (
    <div className="task-title-row">
      <h3>
        {titleHref === undefined ? (
          item.title
        ) : (
          <Link href={titleHref}>{item.title}</Link>
        )}
      </h3>
      <span className={`tone-label tone-${item.tone}`}>
        {item.badge ?? TONE_LABELS[item.tone]}
      </span>
    </div>
  );
}

function TodoCardDetail({ item }: { item: TodoCardItem }) {
  const detailHref = item.todoHref === undefined ? undefined : item.detailHref;
  return (
    <p className="item-detail">
      {detailHref === undefined ? (
        item.detail
      ) : (
        <Link href={detailHref}>{item.detail}</Link>
      )}
    </p>
  );
}

function TodoCardActions({
  actorName,
  canChangeSchedule,
  currentUserId,
  item,
  members,
}: {
  actorName: string;
  canChangeSchedule: boolean;
  currentUserId: string;
  item: TodoCardItem;
  members: HouseholdMemberOption[];
}) {
  const pendingOccurrenceId = item.occurrenceId;
  if (pendingOccurrenceId !== undefined) {
    return (
      <>
        <AssigneePanel
          assigneeUserId={item.assigneeUserId ?? null}
          managedItemId={item.managedItemId ?? null}
          members={members}
          occurrenceId={pendingOccurrenceId}
          taskTitle={item.title}
        />
        <CompleteTodoPanel
          actorName={actorName}
          currentUserId={currentUserId}
          managedItemId={item.managedItemId ?? null}
          members={members}
          occurrenceId={pendingOccurrenceId}
          taskTitle={item.title}
        />
        {canChangeSchedule && item.oneTimeScheduledFor !== undefined ? (
          <SchedulePanel
            managedItemId={item.managedItemId ?? null}
            occurrenceId={pendingOccurrenceId}
            scheduledFor={item.oneTimeScheduledFor}
            taskTitle={item.title}
          />
        ) : null}
      </>
    );
  }
  // Issue #206: 完了済みカードは確認専用。訂正・取消はTodo詳細で行う。
  return null;
}

// canChangeSchedule: 予定日の設定・未定化をカード内で提供するか(Issue #204)。
// ホームは「いま対応すること」を確認して完了する画面に絞るためfalse、
// Todo一覧は予定日未定Todoの再発見と予定日設定の場(#201, #202)の
// ためtrueにする。どちらの画面でも、予定日はTodo詳細の編集からも変更できる。
export function TodoCard({
  actorName,
  canChangeSchedule,
  currentUserId,
  item,
  members,
}: {
  actorName: string;
  canChangeSchedule: boolean;
  currentUserId: string;
  item: TodoCardItem;
  members: HouseholdMemberOption[];
}) {
  return (
    <article className="task-card">
      <div className={`status-mark status-${item.tone}`} aria-hidden="true" />
      <div className="task-copy">
        <TodoCardTitle item={item} />
        <TodoCardDetail item={item} />
        <p className="item-meta">{item.meta}</p>
        <TodoCardActions
          actorName={actorName}
          canChangeSchedule={canChangeSchedule}
          currentUserId={currentUserId}
          item={item}
          members={members}
        />
      </div>
    </article>
  );
}
