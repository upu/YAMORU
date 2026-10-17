import Link from "next/link";

import type { HouseholdMemberOption } from "../lib/d1/profiles";
import { AssigneePanel } from "../features/todos/components/assignee-panel";
import { CompleteTodoPanel } from "../features/todos/components/complete-todo-panel";
import type { TodoTone } from "./task-schedule";

// ホーム(app/page.tsx)とTodo一覧(app/todos/page.tsx)は、同じTodoを
// 同じ見た目・同じ操作で扱う(Issue #201)。カードの表示と操作はここに一つだけ
// 置き、画面側は「どのTodoを、どの順序で並べるか」だけを決める。
export type { TodoCardItem } from "../features/todos/projection/types";
import type { TodoCardItem } from "../features/todos/projection/types";

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
  currentUserId,
  item,
  members,
}: {
  actorName: string;
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
      </>
    );
  }
  // Issue #206: 完了済みカードは確認専用。訂正・取消はTodo詳細で行う。
  return null;
}

// Issue #204/#267: 予定日の設定・未定化はホーム・Todo一覧どちらのカードにも
// 置かない。予定日を変えたい場合は、Todo名からTodo詳細を開き、編集画面
// (#203)で行う。担当変更と完了はどちらの画面でも維持する。
export function TodoCard({
  actorName,
  currentUserId,
  item,
  members,
}: {
  actorName: string;
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
        {item.meta === "" ? null : <p className="item-meta">{item.meta}</p>}
        <TodoCardActions
          actorName={actorName}
          currentUserId={currentUserId}
          item={item}
          members={members}
        />
      </div>
    </article>
  );
}
