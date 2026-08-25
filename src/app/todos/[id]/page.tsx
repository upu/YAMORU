import Link from "next/link";
import { notFound } from "next/navigation";

import { requireUser } from "../../../lib/auth/current-user";
import { getD1Context } from "../../../lib/d1/context";
import { loadPendingTodoDetail } from "../../../lib/d1/todos";
import {
  FALLBACK_OTHER_MEMBER_NAME,
  loadActorName,
} from "../../../lib/d1/profiles";
import { UNASSIGNED_LABEL } from "../../assignee";
import { toDeadlineKind, toRecurrenceBasis, type RecurrenceBasis } from "../../task-schedule";
import { formatTokyoDate } from "../../time-zone";

// 繰り返し方の表現は、Todo登録フォームの選択肢と同じ言い回しに揃える。
const RECURRENCE_LABELS: Record<RecurrenceBasis, string> = {
  calendar: "曜日・日付で繰り返す",
  completion: "完了した日から繰り返す",
  once: "繰り返しなし",
};

export type TodoDetailData = {
  assigneeName: string | null;
  dueAt: string | null;
  id: string;
  isMaintenance: boolean;
  managedItemId: string | null;
  managedItemName: string | null;
  recurrenceBasis: RecurrenceBasis;
  scheduledFor: string | null;
  title: string;
};

function TodoScheduleRows({ todo }: { todo: TodoDetailData }) {
  // 予定日と期限が同じTodoでは、同じ日付を二度並べない。延期(YDR-012)や
  // 完了日基準の推奨期間(YDR-017)で二つがずれているときだけ、期限側も見せる。
  const showDueAt = todo.dueAt !== null && todo.dueAt !== todo.scheduledFor;
  return (
    <>
      <div>
        <dt>予定日</dt>
        <dd>
          {todo.scheduledFor === null ? "未定" : formatTokyoDate(todo.scheduledFor)}
        </dd>
      </div>
      {showDueAt && todo.dueAt !== null ? (
        <div>
          <dt>{todo.isMaintenance ? "推奨期間の上限" : "現在の期限"}</dt>
          <dd>{formatTokyoDate(todo.dueAt)}</dd>
        </div>
      ) : null}
    </>
  );
}

function TodoDetailList({ todo }: { todo: TodoDetailData }) {
  return (
    <dl className="todo-detail-list">
      <div>
        <dt>繰り返し方</dt>
        <dd>{RECURRENCE_LABELS[todo.recurrenceBasis]}</dd>
      </div>
      <div>
        <dt>関連する管理対象</dt>
        <dd>
          {todo.managedItemId === null || todo.managedItemName === null ? (
            "関連する管理対象なし"
          ) : (
            <Link href={`/managed-items/${encodeURIComponent(todo.managedItemId)}`}>
              {todo.managedItemName}
            </Link>
          )}
        </dd>
      </div>
      <div>
        <dt>担当</dt>
        <dd>{todo.assigneeName ?? UNASSIGNED_LABEL}</dd>
      </div>
      <TodoScheduleRows todo={todo} />
    </dl>
  );
}

function TodoEditSection({ todo }: { todo: TodoDetailData }) {
  // 繰り返し方や繰り返し規則の変更は#203の対象外。繰り返しTodoでは、
  // 編集導線の代わりに変更できない理由を示す。
  if (todo.recurrenceBasis !== "once") {
    return (
      <section aria-labelledby="todo-edit-title" className="detail-card">
        <p className="detail-kicker">EDIT</p>
        <h2 id="todo-edit-title">内容の変更</h2>
        <p className="detail-note">
          繰り返しのあるTodoの内容は、この画面からは変更できません。担当や予定日の変更は、ホームやTodo一覧の操作から行えます。
        </p>
      </section>
    );
  }
  return (
    <section aria-labelledby="todo-edit-title" className="detail-card">
      <p className="detail-kicker">EDIT</p>
      <h2 id="todo-edit-title">内容の変更</h2>
      <p className="detail-note">
        Todo名、関連する管理対象、担当、予定日を変更できます。
      </p>
      <Link
        className="ledger-primary-link"
        href={`/todos/${encodeURIComponent(todo.id)}/edit`}
      >
        編集
      </Link>
    </section>
  );
}

export function TodoDetailContent({ todo }: { todo: TodoDetailData }) {
  return (
    <main className="detail-page todo-detail-page">
      <nav aria-label="ページ移動" className="back-nav">
        <Link href="/todos">← すべてのTodoへ戻る</Link>
      </nav>

      <header className="detail-hero">
        <p className="detail-kicker">TODO</p>
        <h1>{todo.title}</h1>
        <p>このTodoの内容と、いまの予定・担当を確認できます。</p>
      </header>

      <div className="ledger-grid">
        <section aria-labelledby="todo-summary-title" className="detail-card">
          <p className="detail-kicker">SUMMARY</p>
          <h2 id="todo-summary-title">Todoの内容</h2>
          <TodoDetailList todo={todo} />
        </section>

        <TodoEditSection todo={todo} />
      </div>
    </main>
  );
}

export default async function TodoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const { db, session } = await getD1Context(user);

  // 現在の家庭のpending Occurrenceだけを返す(src/lib/d1/todos.ts)。他家庭の
  // Todoや完了済みTodoは、存在しないものとして404にする。
  const row = await loadPendingTodoDetail(db, session, id);
  if (row === null) notFound();

  const assigneeName = row.assignee_user_id === null
    ? null
    : await loadActorName(db, session, row.assignee_user_id, FALLBACK_OTHER_MEMBER_NAME);

  return (
    <TodoDetailContent
      todo={{
        assigneeName,
        dueAt: row.due_at,
        id: row.id,
        isMaintenance: toDeadlineKind(row.deadline_kind) === "maintenance",
        managedItemId: row.managed_item_id,
        managedItemName: row.managed_item_name,
        recurrenceBasis: toRecurrenceBasis(row.recurrence_basis),
        scheduledFor: row.scheduled_for,
        title: row.title,
      }}
    />
  );
}
