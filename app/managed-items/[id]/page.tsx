import Link from "next/link";
import { notFound } from "next/navigation";

import { requireUser } from "../../../lib/auth/current-user";
import {
  FALLBACK_OTHER_MEMBER_NAME,
  FALLBACK_SELF_ACTOR_NAME,
  type HouseholdMemberOption,
  loadActorName,
  loadHouseholdMembers,
} from "../../../lib/d1/profiles";
import { getD1Context } from "../../../lib/d1/context";
import { loadManagedItemDetail } from "../../../lib/d1/managed-items";
import { selectActiveCompletionLogs } from "../../active-completion";
import {
  isSafeExternalUrl,
  MANAGED_ITEM_KIND_LABELS,
  type ManagedItemKind,
  toManagedItemKind,
} from "../model";
import { AssigneePanel } from "./assignee-panel";
import { CompleteTodoPanel } from "./complete-todo-panel";
import { CorrectionPanel } from "./correction-panel";
import { PostponePanel } from "./postpone-panel";
import {
  MAINTENANCE_DISPLAY_COPY,
  STRICT_DISPLAY_COPY,
  toDeadlineKind,
  toRecurrenceBasis,
  type RecurrenceBasis,
  type TodoTone,
} from "../../task-schedule";
import {
  describeMaintenanceWindowFromIso,
  describeStrictScheduleFromIso,
  formatTokyoDate,
  getMaintenanceDisplayStateFromIso,
  getStrictDisplayStateFromIso,
} from "../../time-zone";

type ExternalLinkData = { id: string; url: string };
type PendingTodoData = {
  assigneeUserId: string | null;
  badge: string;
  dueAt: string;
  id: string;
  meta: string;
  recurrenceBasis: RecurrenceBasis;
  scheduledFor: string;
  title: string;
  tone: TodoTone;
};
type RecentCompletionData = {
  id: string;
  occurredAt: string;
  performedByUserId: string | null;
  title: string;
};
type LastActivityData = { occurredAt: string; performerName: string };
const RECURRENCE_LABELS: Record<RecurrenceBasis, string> = {
  calendar: "曜日・日付で繰り返す",
  completion: "繰り返し",
  once: "繰り返しなし",
};

export type ManagedItemDetailData = {
  actorName: string;
  currentUserId: string;
  externalLinks: ExternalLinkData[];
  id: string;
  kind: ManagedItemKind;
  lastActivity: LastActivityData | null;
  members: HouseholdMemberOption[];
  name: string;
  pendingTodos: PendingTodoData[];
  recentCompletions: RecentCompletionData[];
};

type ActivityLogRow = {
  action: string;
  id: string;
  occurred_at: string;
  performed_by_user_id: string | null;
  recorded_at: string;
};
type TaskOccurrenceRow = {
  activity_logs: ActivityLogRow[];
  assignee_user_id: string | null;
  due_at: string;
  id: string;
  scheduled_for: string;
  status: string;
};
type TaskRuleRow = {
  deadline_kind: string;
  recurrence_basis: string;
  task_occurrences: TaskOccurrenceRow[];
  title: string;
};

// ホーム(app/page.tsx)のbuildReminderItemsと同じYDR-017の3状態分類を使い、
// home/detail間で期限分類・日時表示の結果をそろえる(Issue #36)。ホームは
// 急かさないため推奨期間前(before-window)を非表示にするが、詳細は台帳の
// 全体像を見る画面のため、推奨期間前も含めすべての未完了Todoを表示する。
function buildPendingTodos(
  taskRules: TaskRuleRow[],
  nowIso: string,
): PendingTodoData[] {
  return taskRules
    .flatMap((rule) => {
      const deadlineKind = toDeadlineKind(rule.deadline_kind);
      const recurrenceBasis = toRecurrenceBasis(rule.recurrence_basis);
      return rule.task_occurrences
        .filter((occurrence) => occurrence.status === "pending")
        .map((occurrence) => {
          if (recurrenceBasis !== "completion") {
            if (deadlineKind !== "strict") {
              throw new Error("厳密な期限Todoの期限方式が不正です。");
            }
            const state = getStrictDisplayStateFromIso(occurrence.due_at, nowIso);
            const copy = STRICT_DISPLAY_COPY[state];
            return {
              assigneeUserId: occurrence.assignee_user_id,
              badge: copy.badge,
              dueAt: occurrence.due_at,
              id: occurrence.id,
              meta: describeStrictScheduleFromIso(state, occurrence.due_at),
              recurrenceBasis,
              scheduledFor: occurrence.scheduled_for,
              title: rule.title,
              tone: copy.tone,
            };
          }

          if (deadlineKind !== "maintenance") {
            throw new Error("完了日基準Todoの期限方式が不正です。");
          }
          const window = { dueAt: occurrence.due_at, scheduledFor: occurrence.scheduled_for };
          const state = getMaintenanceDisplayStateFromIso(window, nowIso);
          const copy = MAINTENANCE_DISPLAY_COPY[state];
          return {
            assigneeUserId: occurrence.assignee_user_id,
            badge: copy.badge,
            dueAt: occurrence.due_at,
            id: occurrence.id,
            meta: describeMaintenanceWindowFromIso(state, window),
            recurrenceBasis,
            scheduledFor: occurrence.scheduled_for,
            title: rule.title,
            tone: copy.tone,
          };
        });
    })
    .sort((left, right) => left.scheduledFor.localeCompare(right.scheduledFor));
}

// 取消されていない直近の完了(occurred_at基準)を、全TaskRuleを横断して1件返す
// (YDR-012)。「誰が」は操作主体ではなく実施者(performed_by_user_id)を表示する
// (Issue #18, YDR-020)。
function findLatestCompletionLog(taskRules: TaskRuleRow[]): ActivityLogRow | null {
  const logs = selectActiveCompletionLogs(
    taskRules.flatMap((rule) => rule.task_occurrences),
  );
  if (logs.length === 0) return null;

  return logs.reduce((latest, log) =>
    log.occurred_at > latest.occurred_at ? log : latest,
  );
}

function buildRecentCompletions(
  taskRules: TaskRuleRow[],
): RecentCompletionData[] {
  return taskRules
    .flatMap((rule) => {
      const completions = rule.task_occurrences.flatMap((occurrence) =>
        selectActiveCompletionLogs([occurrence]).map((log) => ({
          id: occurrence.id,
          occurredAt: log.occurred_at,
          performedByUserId: log.performed_by_user_id,
          title: rule.title,
        })),
      );
      if (completions.length === 0) return [];
      // TaskRuleごとに最新の完了だけを「直近の完了」として表示する。
      return [
        completions.reduce((latest, completion) =>
          completion.occurredAt > latest.occurredAt ? completion : latest,
        ),
      ];
    })
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
}

function PendingTodoSection({
  actorName,
  currentUserId,
  managedItemId,
  members,
  todos,
}: {
  actorName: string;
  currentUserId: string;
  managedItemId: string;
  members: HouseholdMemberOption[];
  todos: PendingTodoData[];
}) {
  return (
    <section aria-labelledby="current-todos-title" className="detail-card">
      <p className="detail-kicker">CURRENT TODO</p>
      <h2 id="current-todos-title">現在のTodo</h2>
      {todos.length === 0 ? (
        <p className="ledger-empty">現在の未完了Todoはありません。</p>
      ) : (
        <ul className="maintenance-todo-list">
          {todos.map((todo) => (
            <li key={todo.id}>
              <div className="task-title-row">
                <strong>{todo.title}</strong>
                <span className={`tone-label tone-${todo.tone}`}>{todo.badge}</span>
              </div>
              <span className="input-help">
                {RECURRENCE_LABELS[todo.recurrenceBasis]}
              </span>
              <span>{todo.meta}</span>
              <AssigneePanel
                assigneeUserId={todo.assigneeUserId}
                managedItemId={managedItemId}
                members={members}
                occurrenceId={todo.id}
                taskTitle={todo.title}
              />
              <CompleteTodoPanel
                actorName={actorName}
                currentUserId={currentUserId}
                managedItemId={managedItemId}
                members={members}
                occurrenceId={todo.id}
                taskTitle={todo.title}
              />
              <PostponePanel
                managedItemId={managedItemId}
                occurrenceId={todo.id}
                taskTitle={todo.title}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RecentCompletionSection({
  completions,
  currentUserId,
  managedItemId,
  members,
}: {
  completions: RecentCompletionData[];
  currentUserId: string;
  managedItemId: string;
  members: HouseholdMemberOption[];
}) {
  return (
    <section aria-labelledby="recent-completions-title" className="detail-card">
      <p className="detail-kicker">RECENT ACTIVITY</p>
      <h2 id="recent-completions-title">直近の完了</h2>
      {completions.length === 0 ? (
        <p className="ledger-empty">まだ完了の記録はありません。</p>
      ) : (
        <ul className="maintenance-todo-list">
          {completions.map((completion) => (
            <li key={completion.id}>
              <strong>{completion.title}</strong>
              <span>{formatTokyoDate(completion.occurredAt)}に完了</span>
              <CorrectionPanel
                currentUserId={currentUserId}
                managedItemId={managedItemId}
                members={members}
                occurredAt={completion.occurredAt}
                occurrenceId={completion.id}
                performedByUserId={completion.performedByUserId}
                taskTitle={completion.title}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LastActivitySummary({ lastActivity }: { lastActivity: LastActivityData | null }) {
  return (
    <section aria-labelledby="last-activity-title" className="last-activity">
      <p className="detail-kicker">LAST ACTIVITY</p>
      <h2 id="last-activity-title">最後にいつ・誰が</h2>
      {lastActivity === null ? (
        <p>まだ完了の記録はありません。</p>
      ) : (
        <div className="last-activity-values">
          <div>
            <span>いつ</span>
            <strong>{formatTokyoDate(lastActivity.occurredAt)}</strong>
          </div>
          <div>
            <span>誰が</span>
            <strong>{lastActivity.performerName}</strong>
          </div>
        </div>
      )}
    </section>
  );
}

function ExternalLinksSection({ links }: { links: ExternalLinkData[] }) {
  return (
    <section aria-labelledby="external-links-title" className="detail-card">
      <p className="detail-kicker">REFERENCES</p>
      <h2 id="external-links-title">外部リンク</h2>
      {links.length === 0 ? (
        <p className="ledger-empty">外部リンクは登録されていません。</p>
      ) : (
        <ul className="external-link-list">
          {links.map((link) => (
            <li key={link.id}>
              <a href={link.url} rel="noopener noreferrer" target="_blank">
                外部リンクを開く: {link.url}
                <span aria-hidden="true"> ↗</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ManagedItemDetailContent({
  item,
}: {
  item: ManagedItemDetailData;
}) {
  const safeLinks = item.externalLinks.filter((link) =>
    isSafeExternalUrl(link.url),
  );

  return (
    <main className="detail-page">
      <nav aria-label="ページ移動" className="back-nav">
        <Link href="/managed-items">← 家の台帳へ戻る</Link>
      </nav>

      <header className="detail-hero">
        <p className="detail-kicker">MANAGED ITEM</p>
        <div className="detail-title-row">
          <h1>{item.name}</h1>
          <span className="kind-badge">
            {MANAGED_ITEM_KIND_LABELS[item.kind]}
          </span>
        </div>
        <p>登録した管理対象と、現在のTodoを確認できます。</p>
      </header>

      <LastActivitySummary lastActivity={item.lastActivity} />

      <div className="ledger-grid managed-item-detail-grid">
        <PendingTodoSection
          actorName={item.actorName}
          currentUserId={item.currentUserId}
          managedItemId={item.id}
          members={item.members}
          todos={item.pendingTodos}
        />

        <section aria-labelledby="register-todo-title" className="detail-card">
          <p className="detail-kicker">ADD TODO</p>
          <h2 id="register-todo-title">関連するTodoを追加</h2>
          <p className="detail-note">
            専用の登録ページで、この管理対象を選んだ状態から追加できます。
          </p>
          <Link
            className="ledger-primary-link"
            href={`/todos/new?managedItemId=${encodeURIComponent(item.id)}`}
          >
            Todoを追加
          </Link>
        </section>

        <RecentCompletionSection
          completions={item.recentCompletions}
          currentUserId={item.currentUserId}
          managedItemId={item.id}
          members={item.members}
        />

        <ExternalLinksSection links={safeLinks} />
      </div>
    </main>
  );
}

export default async function RegisteredManagedItemDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const { db, session } = await getD1Context(user);
  const nowIso = new Date().toISOString();
  const [data, actorName] = await Promise.all([
    loadManagedItemDetail(db, session, id),
    loadActorName(db, session, user.id, FALLBACK_SELF_ACTOR_NAME),
  ]);

  if (data === null) notFound();

  const pendingTodos = buildPendingTodos(data.task_rules, nowIso);
  const recentCompletions = buildRecentCompletions(data.task_rules);
  const latestCompletionLog = findLatestCompletionLog(data.task_rules);
  const [lastActivityPerformerName, members] = await Promise.all([
    // performed_by_user_idはaction='completed'の行にのみ設定される
    // (CHECK制約、YDR-020)。findLatestCompletionLogはcompletedの行だけを
    // 対象にするため、ここでは常に非nullのはずだが、万一nullの場合も
    // 「完了の記録がない」扱いにはせず、ホーム(app/page.tsx)と同じ
    // フォールバック名で表示する(表示方針を画面間でそろえる)。
    latestCompletionLog === null
      ? Promise.resolve(null)
      : latestCompletionLog.performed_by_user_id === null
        ? Promise.resolve(FALLBACK_OTHER_MEMBER_NAME)
        : loadActorName(
            db,
            session,
            latestCompletionLog.performed_by_user_id,
            FALLBACK_OTHER_MEMBER_NAME,
          ),
    // Issue #72: 担当者選択の候補は同じ家庭のメンバーに限る。実施者選択(Issue #18)も同じ候補を使う。
    loadHouseholdMembers(db, session),
  ]);
  const lastActivity =
    latestCompletionLog === null || lastActivityPerformerName === null
      ? null
      : { occurredAt: latestCompletionLog.occurred_at, performerName: lastActivityPerformerName };

  return (
    <ManagedItemDetailContent
      item={{
        actorName,
        currentUserId: user.id,
        externalLinks: data.external_links,
        id: data.id,
        kind: toManagedItemKind(data.kind),
        lastActivity,
        members,
        name: data.name,
        pendingTodos,
        recentCompletions,
      }}
    />
  );
}
