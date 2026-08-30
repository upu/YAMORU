import Link from "next/link";
import { notFound } from "next/navigation";

import { requireUser } from "../../../lib/auth/current-user";
import { getD1Context } from "../../../lib/d1/context";
import {
  listConsumablesForTaskRule,
  type ConsumableSummary,
} from "../../../lib/d1/consumables";
import { loadTodoDetail, type TodoDetailRow } from "../../../lib/d1/todos";
import {
  FALLBACK_OTHER_MEMBER_NAME,
  type HouseholdMemberOption,
  loadActorName,
  loadHouseholdMembers,
} from "../../../lib/d1/profiles";
import { UNASSIGNED_LABEL } from "../../assignee";
import { EditIcon } from "../../edit-icon";
import { CorrectionPanel } from "../../managed-items/[id]/correction-panel";
import {
  describeCalendarSchedule,
  describeCompletionRecurrence,
  toDeadlineKind,
  toRecurrenceBasis,
  type RecurrenceBasis,
} from "../../task-schedule";
import { formatTokyoDate } from "../../time-zone";
import { RelatedConsumablesSection } from "../../consumables/related-consumables";

// Issue #205: 完了済みTodoでは、現在有効な実施記録(訂正済みなら訂正後、
// YDR-026)を表示し、そこから訂正・完了取消を行う。
export type TodoCompletionData = {
  occurredAt: string;
  performerName: string;
  performedByUserId: string | null;
};

export type TodoDetailData = {
  assigneeName: string | null;
  completion: TodoCompletionData | null;
  consumables: ConsumableSummary[];
  dueAt: string | null;
  id: string;
  isCompleted: boolean;
  isMaintenance: boolean;
  managedItemId: string | null;
  managedItemName: string | null;
  recurrenceBasis: RecurrenceBasis;
  // Issue #244(設計メモ案A): 方式と具体条件を一つにまとめた表示文字列。
  // 「繰り返しなし」「完了から4〜8週間後」「毎週月曜日」など。
  recurrenceLabel: string;
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
        <dt>繰り返し</dt>
        <dd>{todo.recurrenceLabel}</dd>
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

// Issue #244: 「Todoの内容」の見出し横へ編集導線を集約する
// (ManagedItemRecordSectionと同じ方式、issue本文の設計メモの第一候補)。
// 編集できるのは繰り返しなし・未完了Todoだけ(#203の範囲)。繰り返しTodoや
// 完了済みTodoには、利用できない編集導線も理由だけのカードも出さない。
function TodoContentSection({ todo }: { todo: TodoDetailData }) {
  const canEdit = !todo.isCompleted && todo.recurrenceBasis === "once";
  return (
    <section aria-labelledby="todo-summary-title" className="detail-card">
      <div className="detail-section-heading">
        <div>
          <p className="detail-kicker">SUMMARY</p>
          <h2 id="todo-summary-title">Todoの内容</h2>
        </div>
        {canEdit ? (
          <Link
            aria-label="このTodoを編集"
            className="icon-link"
            href={`/todos/${encodeURIComponent(todo.id)}/edit`}
          >
            <EditIcon />
          </Link>
        ) : null}
      </div>
      <TodoDetailList todo={todo} />
    </section>
  );
}

// Issue #264: Todo詳細はTodo一覧以外からも開くため、Todo一覧へ固定で戻る
// back-navは置かない。代わりの戻り先も追加しない。モバイル下部ナビゲーション
// などの既存の共通導線と、ブラウザ/PWAの履歴操作に任せる。
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
      <header className="detail-hero">
        <p className="detail-kicker">TODO</p>
        <h1>{todo.title}</h1>
      </header>

      <div className="ledger-grid">
        <TodoContentSection todo={todo} />
        <RelatedConsumablesSection consumables={todo.consumables} />
        <TodoCompletionSection
          currentUserId={currentUserId}
          members={members}
          todo={todo}
        />
      </div>
    </main>
  );
}

// Issue #244(設計メモ案A): 「繰り返し」の一項目に、方式と具体条件をまとめた
// 一つの表示文字列を作る。未完了・完了済みのどちらも同じTaskRuleの行から
// 同じ関数で組み立てるため、表現が一致する。
function buildRecurrenceLabel(row: TodoDetailRow): string {
  const basis = toRecurrenceBasis(row.recurrence_basis);
  if (basis === "once") return "繰り返しなし";
  if (basis === "completion") {
    return describeCompletionRecurrence(
      row.recommended_start_offset,
      row.recommended_until_offset,
    );
  }
  const calendarLabel = describeCalendarSchedule({
    scheduleDayOfMonth: row.schedule_day_of_month,
    scheduleDayOfWeek: row.schedule_day_of_week,
    scheduleKind: row.schedule_kind,
    scheduleMonth: row.schedule_month,
    scheduleMonthEnd: row.schedule_month_end === 1,
    scheduleWeekOfMonth: row.schedule_week_of_month,
  });
  if (calendarLabel === null) {
    throw new Error("定例日基準Todoの繰り返しパターンが不正です。");
  }
  return calendarLabel;
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
  const [assigneeName, performerName, members, consumables] = await Promise.all([
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
    listConsumablesForTaskRule(db, session, row.task_rule_id),
  ]);

  return (
    <TodoDetailContent
      currentUserId={user.id}
      members={members}
      todo={{
        assigneeName,
        completion: isCompleted && row.occurred_at !== null
          ? {
              occurredAt: row.occurred_at,
              performedByUserId: row.performed_by_user_id,
              performerName,
            }
          : null,
        consumables,
        dueAt: row.due_at,
        id: row.id,
        isCompleted,
        isMaintenance: toDeadlineKind(row.deadline_kind) === "maintenance",
        managedItemId: row.managed_item_id,
        managedItemName: row.managed_item_name,
        recurrenceBasis: toRecurrenceBasis(row.recurrence_basis),
        recurrenceLabel: buildRecurrenceLabel(row),
        scheduledFor: row.scheduled_for,
        title: row.title,
      }}
    />
  );
}
