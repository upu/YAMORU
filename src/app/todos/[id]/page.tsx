import Link from "next/link";
import { notFound } from "next/navigation";

import { requireUser } from "../../../lib/auth/current-user";
import { parseCalendarScheduleSpecs } from "../../../lib/d1/calendar";
import { getD1Context } from "../../../lib/d1/context";
import {
  listConsumablesForTaskRule,
  type ConsumableSummary,
} from "../../../lib/d1/consumables";
import { loadTodoDetail, type TodoDetailRow } from "../../../lib/d1/todos";
import {
  FALLBACK_OTHER_MEMBER_NAME,
  FALLBACK_SELF_ACTOR_NAME,
  type HouseholdMemberOption,
  loadActorName,
  loadHouseholdMembers,
} from "../../../lib/d1/profiles";
import { AssigneePanel } from "../../../features/todos/components/assignee-panel";
import { CompleteTodoPanel } from "../../../features/todos/components/complete-todo-panel";
import { CorrectionPanel } from "../../../features/todos/components/correction-panel";
import { DetailBackNav, TODO_DETAIL_BACK_NAV } from "../../detail-back-nav";
import { EditIcon } from "../../edit-icon";
import {
  describeCalendarSchedule,
  describeCompletionRecurrence,
  describeIntervalRecurrence,
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
  // Issue #392: 担当は読み取り専用の表示ではなく、その場で変更できる操作に
  // なった。担当予定者の名前はメンバー一覧(members)から解決するため、ここは
  // 選択中の値だけを持つ。担当未定(誰でも可)はnull。
  assigneeUserId: string | null;
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
  taskRuleId: string;
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
      {/* Issue #395: 関連付けがないTodoでは、ラベルと同じ内容を値として繰り返す
      「関連する管理対象なし」の行を置かない(管理対象の記録と同じく、残した
      項目だけを並べる)。 */}
      {todo.managedItemId === null || todo.managedItemName === null ? null : (
        <div>
          <dt>関連する管理対象</dt>
          <dd>
            <Link href={`/managed-items/${encodeURIComponent(todo.managedItemId)}`}>
              {todo.managedItemName}
            </Link>
          </dd>
        </div>
      )}
      <TodoScheduleRows todo={todo} />
    </dl>
  );
}

// Issue #392: 未完了Todoの詳細から、その場で担当と完了を行えるようにする。
// ホーム・Todoカード・横断検索・関連する備品詳細と同じ部品をそのまま使い、
// 権限・競合・エラーの扱いを一本化する(issue本文の設計メモ)。内容を確認する
// 前に見つけられるよう「Todoの内容」より先へ置き、見出しはタイトルや期日より
// 強くしない。担当の現在値はこのselectが示すため、「Todoの内容」側の読み取り
// 専用の担当行とは重ねて出さない。
function TodoPendingActionsSection({
  actorName,
  currentUserId,
  members,
  todo,
}: {
  actorName: string;
  currentUserId: string;
  members: HouseholdMemberOption[];
  todo: TodoDetailData;
}) {
  if (todo.isCompleted) return null;
  return (
    <section aria-labelledby="todo-actions-title" className="detail-card">
      <h2 id="todo-actions-title">担当と完了</h2>
      <AssigneePanel
        assigneeUserId={todo.assigneeUserId}
        managedItemId={todo.managedItemId}
        members={members}
        occurrenceId={todo.id}
        taskTitle={todo.title}
      />
      <CompleteTodoPanel
        actorName={actorName}
        currentUserId={currentUserId}
        managedItemId={todo.managedItemId}
        members={members}
        occurrenceId={todo.id}
        taskTitle={todo.title}
      />
    </section>
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
// Issue #265: 未完了なら繰り返し方式にかかわらず編集へ移動できる。完了済みは
// 追記型の実施記録訂正・完了取消だけを使うため編集導線を出さない。
function TodoContentSection({ todo }: { todo: TodoDetailData }) {
  const canEdit = !todo.isCompleted;
  return (
    <section aria-labelledby="todo-summary-title" className="detail-card">
      <div className="detail-section-heading">
        <h2 id="todo-summary-title">Todoの内容</h2>
        {canEdit ? (
          <Link
            aria-label="Todoを編集"
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

// Issue #264ではTodo一覧以外からも開くことを理由に戻る導線を置かなかったが、
// Issue #391で詳細画面の共通規約(detail-back-nav.tsx)へそろえ、備品・消耗品と
// 同じ位置・同じ表現でTodo一覧へ戻れるようにした。直前の画面へ戻る操作は、
// これまでどおりブラウザ/PWAの履歴に任せる。
export function TodoDetailContent({
  actorName,
  currentUserId,
  members,
  todo,
}: {
  actorName: string;
  currentUserId: string;
  members: HouseholdMemberOption[];
  todo: TodoDetailData;
}) {
  return (
    <main className="page-detail todo-page-detail">
      <DetailBackNav {...TODO_DETAIL_BACK_NAV} />
      <header className="detail-hero">
        <p className="detail-kicker">TODO</p>
        <h1>{todo.title}</h1>
      </header>

      {/* Issue #397: PC幅では、このTodoへの対応と内容(主要情報)と、関連する
      消耗品・完了の記録を横に並べる。2カラムにしない幅では包みが
      display: contentsで消え、これまでどおりこの並びのまま縦に積まれる。 */}
      <div className="ledger-grid detail-columns">
        <div className="detail-column-main">
          <TodoPendingActionsSection
            actorName={actorName}
            currentUserId={currentUserId}
            members={members}
            todo={todo}
          />
          <TodoContentSection todo={todo} />
        </div>

        <div className="detail-column-side">
          {/* 関連はTaskRule単位で、DBもメンテナンスTodoだけを許す。期限のある
              Todoへ形だけの編集入口を出して失敗させない。 */}
          <RelatedConsumablesSection
            consumables={todo.consumables}
            taskRuleId={todo.isMaintenance ? todo.taskRuleId : undefined}
          />
          <TodoCompletionSection
            currentUserId={currentUserId}
            members={members}
            todo={todo}
          />
        </div>
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
      row.recommended_start_value,
      row.recommended_until_value,
      row.recommended_unit,
    );
  }
  if (basis === "interval") {
    const intervalLabel = describeIntervalRecurrence({
      intervalAnchorOn: row.interval_anchor_on,
      intervalCount: row.interval_count,
      intervalUnit: row.interval_unit,
    });
    if (intervalLabel === null) {
      throw new Error("固定間隔Todoの繰り返し規則が不正です。");
    }
    return intervalLabel;
  }
  const calendarLabel = describeCalendarSchedule(
    parseCalendarScheduleSpecs(row.schedule_specs),
  );
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
  const [actorName, performerName, members, consumables] = await Promise.all([
    // Issue #392: 完了ダイアログが「誰が実施したか」の既定として示す、
    // 操作している本人の名前(他画面と同じ扱い)。担当予定者の名前は担当の
    // selectがmembersから解決するため、ここでは引かない。
    loadActorName(db, session, user.id, FALLBACK_SELF_ACTOR_NAME),
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
      actorName={actorName}
      currentUserId={user.id}
      members={members}
      todo={{
        assigneeUserId: row.assignee_user_id,
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
        taskRuleId: row.task_rule_id,
        title: row.title,
      }}
    />
  );
}
