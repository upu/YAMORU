import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { requireUser } from "../../../../lib/auth/current-user";
import { getD1Context } from "../../../../lib/d1/context";
import { listManagedItems } from "../../../../lib/d1/managed-items";
import { loadHouseholdMembers } from "../../../../lib/d1/profiles";
import { loadTodoDetail } from "../../../../lib/d1/todos";
import { formatTokyoDateInput } from "../../../time-zone";
import { TodoEditForm } from "./todo-edit-form";

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
  // 繰り返しのあるTodoの内容変更(#203)と、完了済みTodoの内容変更(#205)は
  // どちらも対象外。詳細画面には編集導線を出していないため、URLを直接開いた
  // 場合も詳細へ戻す。
  if (todo.recurrence_basis !== "once" || todo.status !== "pending") {
    redirect(`/todos/${encodeURIComponent(id)}`);
  }

  const [managedItems, members] = await Promise.all([
    listManagedItems(db, session),
    loadHouseholdMembers(db, session),
  ]);

  return (
    <main className="detail-page">
      <nav aria-label="ページ移動" className="back-nav">
        <Link href={`/todos/${encodeURIComponent(id)}`}>← Todoの詳細へ戻る</Link>
      </nav>

      <header className="detail-hero">
        <p className="detail-kicker">EDIT TODO</p>
        <h1>{todo.title}を編集</h1>
        <p>Todo名、予定日、担当、関連する管理対象を変更できます。</p>
      </header>

      {/* 見出しのidは、フォームの入力欄のid(todo-edit-title等)と衝突させない。
          重複するidはlabelの関連付けを壊す。 */}
      <section aria-labelledby="todo-edit-section-title" className="detail-card">
        <h2 id="todo-edit-section-title">Todoを編集</h2>
        <TodoEditForm
          assigneeUserId={todo.assignee_user_id}
          id={id}
          managedItemId={todo.managed_item_id}
          managedItems={[...managedItems].sort((left, right) =>
            left.name.localeCompare(right.name)
          )}
          members={members}
          plannedDate={
            todo.scheduled_for === null ? "" : formatTokyoDateInput(todo.scheduled_for)
          }
          title={todo.title}
        />
      </section>
    </main>
  );
}
