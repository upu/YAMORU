import Link from "next/link";
import { notFound } from "next/navigation";

import { requireUser } from "../../../lib/auth/current-user";
import { getD1Context } from "../../../lib/d1/context";
import { loadTodoDetail } from "../../../lib/d1/todos";
import {
  FALLBACK_OTHER_MEMBER_NAME,
  type HouseholdMemberOption,
  loadActorName,
  loadHouseholdMembers,
} from "../../../lib/d1/profiles";
import { UNASSIGNED_LABEL } from "../../assignee";
import { CorrectionPanel } from "../../managed-items/[id]/correction-panel";
import {
  describeCalendarSchedule,
  toDeadlineKind,
  toRecurrenceBasis,
  type RecurrenceBasis,
} from "../../task-schedule";
import { formatTokyoDate } from "../../time-zone";

// 繰り返し方の表現は、Todo登録フォームの選択肢と同じ言い回しに揃える。
const RECURRENCE_LABELS: Record<RecurrenceBasis, string> = {
  calendar: "曜日・日付で繰り返す",
  completion: "完了した日から繰り返す",
  once: "繰り返しなし",
};

// Issue #205: 完了済みTodoでは、現在有効な実施記録(訂正済みなら訂正後、
// YDR-026)を表示し、そこから訂正・完了取消を行う。
export type TodoCompletionData = {
  occurredAt: string;
  performerName: string;
  performedByUserId: string | null;
};

export type TodoDetailData = {
  assigneeName: string | null;
  // recurrenceBasis='calendar'のときだけ非null(Issue #227 / YDR-032)。
  calendarScheduleLabel: string | null;
  completion: TodoCompletionData | null;
  dueAt: string | null;
  id: string;
  isCompleted: boolean;
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

function TodoCompletionRows({ completion }: { completion: TodoCompletionData | null }) {
  if (completion === null) return null;
  return (
    <>
      <div>
        <dt>実施日</dt>
        <dd>{formatTokyoDate(completion.occurredAt)}</dd>
      </div>
      <div>
        <dt>実施した人</dt>
        <dd>{completion.performerName}</dd>
      </div>
    </>
  );
}

function TodoDetailList({ todo }: { todo: TodoDetailData }) {
  return (
    <dl className="todo-detail-list">
      <div>
        <dt>状態</dt>
        <dd>{todo.isCompleted ? "完了" : "未完了"}</dd>
      </div>
      <TodoCompletionRows completion={todo.completion} />
      <div>
        <dt>繰り返し方</dt>
        <dd>{RECURRENCE_LABELS[todo.recurrenceBasis]}</dd>
      </div>
      {todo.calendarScheduleLabel === null ? null : (
        <div>
          <dt>定例日</dt>
          <dd>{todo.calendarScheduleLabel}</dd>
        </div>
      )}
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
      {todo.isCompleted ? null : (
        <div>
          <dt>担当</dt>
          <dd>{todo.assigneeName ?? UNASSIGNED_LABEL}</dd>
        </div>
      )}
      <TodoScheduleRows todo={todo} />
    </dl>
  );
}

// Issue #205: 実施記録の訂正と完了取消は、完了済みTodoの詳細へ集約する。
// 元のActivityLogは書き換えず、訂正イベントの追記として記録する(YDR-026)。
function TodoCompletionSection({
  currentUserId,
  members,
  todo,
}: {
  currentUserId: string;
  members: HouseholdMemberOption[];
  todo: TodoDetailData;
}) {
  const completion = todo.completion;
  if (completion === null) return null;
  return (
    <section aria-labelledby="todo-completion-title" className="detail-card">
      <p className="detail-kicker">CORRECT</p>
      <h2 id="todo-completion-title">実施記録を修正</h2>
      <p className="detail-note">
        実施日や実施した人の訂正、完了の取消ができます。元の記録は残したまま、訂正した内容を追記します。
      </p>
      <CorrectionPanel
        currentUserId={currentUserId}
        managedItemId={todo.managedItemId}
        members={members}
        occurredAt={completion.occurredAt}
        occurrenceId={todo.id}
        performedByUserId={completion.performedByUserId}
        taskTitle={todo.title}
      />
    </section>
  );
}

function TodoEditSection({ todo }: { todo: TodoDetailData }) {
  // 完了済みTodoの内容編集は#205の対象外。実施記録の修正だけを提供する。
  if (todo.isCompleted) return null;
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
        Todo名、関連する管理対象、担当、予定日を変更できます。予定日は具体日と未定を行き来できます。
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

export function TodoDetailContent({
  currentUserId,
  members,
  todo,
}: {
  currentUserId: string;
  members: HouseholdMemberOption[];
  todo: TodoDetailData;
}) {
  return (
    <main className="detail-page todo-detail-page">
      <nav aria-label="ページ移動" className="back-nav">
        <Link href="/todos">← Todo一覧へ戻る</Link>
      </nav>

      <header className="detail-hero">
        <p className="detail-kicker">TODO</p>
        <h1>{todo.title}</h1>
        <p>
          {todo.isCompleted
            ? "このTodoの内容と、記録された実施内容を確認できます。"
            : "このTodoの内容と、いまの予定・担当を確認できます。"}
        </p>
      </header>

      <div className="ledger-grid">
        <section aria-labelledby="todo-summary-title" className="detail-card">
          <p className="detail-kicker">SUMMARY</p>
          <h2 id="todo-summary-title">Todoの内容</h2>
          <TodoDetailList todo={todo} />
        </section>

        <TodoEditSection todo={todo} />
        <TodoCompletionSection
          currentUserId={currentUserId}
          members={members}
          todo={todo}
        />
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

  // 現在の家庭のOccurrenceだけを返す(src/lib/d1/todos.ts)。他家庭のTodoは
  // 存在しないものとして404にする。
  const row = await loadTodoDetail(db, session, id);
  if (row === null) notFound();

  const isCompleted = row.status === "completed";
  const [assigneeName, performerName, members] = await Promise.all([
    row.assignee_user_id === null
      ? Promise.resolve(null)
      : loadActorName(db, session, row.assignee_user_id, FALLBACK_OTHER_MEMBER_NAME),
    // performed_by_user_idはaction='completed'の行に必ず設定される(CHECK制約、
    // YDR-020)。型上のnull許容には、他画面と同じフォールバック名で備える。
    !isCompleted || row.performed_by_user_id === null
      ? Promise.resolve(FALLBACK_OTHER_MEMBER_NAME)
      : loadActorName(db, session, row.performed_by_user_id, FALLBACK_OTHER_MEMBER_NAME),
    // 実施者の訂正候補は同じ家庭のメンバーに限る(YDR-020)。
    loadHouseholdMembers(db, session),
  ]);

  return (
    <TodoDetailContent
      currentUserId={user.id}
      members={members}
      todo={{
        assigneeName,
        calendarScheduleLabel: toRecurrenceBasis(row.recurrence_basis) === "calendar"
          ? describeCalendarSchedule({
              scheduleDayOfMonth: row.schedule_day_of_month,
              scheduleDayOfWeek: row.schedule_day_of_week,
              scheduleKind: row.schedule_kind,
              scheduleMonth: row.schedule_month,
              scheduleMonthEnd: row.schedule_month_end === 1,
              scheduleWeekOfMonth: row.schedule_week_of_month,
            })
          : null,
        completion: isCompleted && row.occurred_at !== null
          ? {
              occurredAt: row.occurred_at,
              performedByUserId: row.performed_by_user_id,
              performerName,
            }
          : null,
        dueAt: row.due_at,
        id: row.id,
        isCompleted,
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
