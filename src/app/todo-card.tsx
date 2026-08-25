import Link from "next/link";

import type { HouseholdMemberOption } from "../lib/d1/profiles";
import { AssigneePanel } from "./managed-items/[id]/assignee-panel";
import { CompleteTodoPanel } from "./managed-items/[id]/complete-todo-panel";
import { CorrectionPanel } from "./managed-items/[id]/correction-panel";
import { SchedulePanel } from "./managed-items/[id]/schedule-panel";
import type { TodoTone } from "./task-schedule";

// ホーム(app/page.tsx)とすべてのTodo一覧(app/todos/page.tsx)は、同じTodoを
// 同じ見た目・同じ操作で扱う(Issue #201)。カードの表示と操作はここに一つだけ
// 置き、画面側は「どのTodoを、どの順序で並べるか」だけを決める。
export type TodoCardItem = {
  // pending Todoにだけ設定する。未設定(誰でも可)はnull。
  assigneeUserId?: string | null;
  badge?: string;
  completedAt?: string;
  completedOccurrenceId?: string;
  // completed Todoにだけ設定する(#148の修正で実施者を選び直すための既定値)。
  completedPerformedByUserId?: string | null;
  detail: string;
  detailHref?: string;
  id: string;
  // Todoに関連する管理対象。家庭共通Todoではnull、完了・未完了のどちらにも設定する。
  managedItemId?: string | null;
  meta: string;
  // pending Todoにだけ設定し、担当・完了操作を有効にする。
  occurrenceId?: string;
  // 一回限りTodoにだけ設定する。nullは予定日未定、文字列は具体日あり。
  oneTimeScheduledFor?: string | null;
  title: string;
  tone: TodoTone;
};

const TONE_LABELS: Record<TodoTone, string> = {
  caution: "要確認",
  done: "完了",
  reminder: "そろそろ",
  today: "今日",
  upcoming: "予定",
  urgent: "要対応",
};

function TodoCardTitle({ item }: { item: TodoCardItem }) {
  return (
    <div className="task-title-row">
      <h3>
        {item.detailHref === undefined ? (
          item.title
        ) : (
          <Link href={item.detailHref}>{item.title}</Link>
        )}
      </h3>
      <span className={`tone-label tone-${item.tone}`}>
        {item.badge ?? TONE_LABELS[item.tone]}
      </span>
    </div>
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
        {item.oneTimeScheduledFor !== undefined ? (
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
  if (item.completedAt === undefined || item.completedOccurrenceId === undefined) {
    return null;
  }
  return (
    <CorrectionPanel
      currentUserId={currentUserId}
      managedItemId={item.managedItemId ?? null}
      members={members}
      occurredAt={item.completedAt}
      occurrenceId={item.completedOccurrenceId}
      performedByUserId={item.completedPerformedByUserId ?? null}
      taskTitle={item.title}
    />
  );
}

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
        <p className="item-detail">{item.detail}</p>
        <p className="item-meta">{item.meta}</p>
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
