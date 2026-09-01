import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { requireUser } from "../../../../lib/auth/current-user";
import { getD1Context } from "../../../../lib/d1/context";
import { listManagedItems } from "../../../../lib/d1/managed-items";
import { loadHouseholdMembers } from "../../../../lib/d1/profiles";
import { loadTodoDetail, type TodoDetailRow } from "../../../../lib/d1/todos";
import { type AssigneeOption } from "../../../assignee";
import { formatTokyoDateInput } from "../../../time-zone";
import { type TodoManagedItemOption } from "../../managed-item-search";
import {
  RecurringTodoEditForms,
} from "./recurring-todo-edit-form";
import { recurringRuleValues } from "./recurring-todo-edit-values";
import { TodoEditForm } from "./todo-edit-form";

function TodoEditSections({ id, managedItems, members, todo }: {
  id: string;
  managedItems: TodoManagedItemOption[];
  members: AssigneeOption[];
  todo: TodoDetailRow;
}) {
  return (
    <main className="detail-page">
      <nav aria-label="ページ移動" className="back-nav">
        <Link href={`/todos/${encodeURIComponent(id)}`}>← Todoの詳細へ戻る</Link>
      </nav>
      <header className="detail-hero">
        <p className="detail-kicker">EDIT TODO</p>
        <h1>{todo.title}を編集</h1>
        <p>{todo.recurrence_basis === "once"
          ? "Todo名、予定日、担当、関連する管理対象を変更できます。"
          : "今回の担当・期限と、今後の繰り返しを分けて変更できます。"}</p>
      </header>
      {todo.recurrence_basis === "once" ? (
        <section aria-labelledby="todo-edit-section-title" className="detail-card">
          <h2 id="todo-edit-section-title">Todoを編集</h2>
          <TodoEditForm
            assigneeUserId={todo.assignee_user_id}
            id={id}
            managedItemId={todo.managed_item_id}
            managedItems={managedItems}
            members={members}
            plannedDate={todo.scheduled_for === null ? "" : formatTokyoDateInput(todo.scheduled_for)}
            title={todo.title}
          />
        </section>
      ) : todo.scheduled_for !== null && todo.due_at !== null ? (
        <RecurringTodoEditForms
          id={id}
          managedItems={managedItems}
          members={members}
          occurrence={{
            assigneeUserId: todo.assignee_user_id,
            dueDate: formatTokyoDateInput(todo.due_at),
            scheduledDate: formatTokyoDateInput(todo.scheduled_for),
          }}
          rule={recurringRuleValues(todo)}
        />
      ) : null}
    </main>
  );
}

// Issue #203: 繰り返しなしTodoの内容を編集する専用画面。閲覧(Todo詳細)と編集を
// 分ける方針は、ManagedItemの詳細・編集と同じにする(#40)。
export default async function TodoEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const { db, session } = await getD1Context(user);

  const todo = await loadTodoDetail(db, session, id);
  if (todo === null) notFound();
  // 完了済みTodoの内容は変更せず、追記型の実施記録訂正・完了取消を使う。
  if (todo.status !== "pending") {
    redirect(`/todos/${encodeURIComponent(id)}`);
  }

  const [managedItems, members] = await Promise.all([
    listManagedItems(db, session),
    loadHouseholdMembers(db, session),
  ]);
  const sortedItems = [...managedItems].sort((left, right) => left.name.localeCompare(right.name));
  return <TodoEditSections id={id} managedItems={sortedItems} members={members} todo={todo} />;
}
