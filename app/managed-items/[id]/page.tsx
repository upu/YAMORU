import Link from "next/link";
import { notFound } from "next/navigation";

import { requireUser } from "../../../lib/auth/current-user";
import {
  FALLBACK_OTHER_MEMBER_NAME,
  FALLBACK_SELF_ACTOR_NAME,
  type HouseholdMemberOption,
  loadActorName,
  loadHouseholdMembers,
} from "../../../lib/supabase/profile";
import { createClient } from "../../../lib/supabase/server";
import {
  isSafeExternalUrl,
  MANAGED_ITEM_KIND_LABELS,
  type ManagedItemKind,
  toManagedItemKind,
} from "../model";
import { AssigneePanel } from "./assignee-panel";
import { CompleteTodoPanel } from "./complete-todo-panel";
import { MaintenanceTodoForm } from "./maintenance-todo-form";
import { UndoCompletionPanel } from "./undo-completion-panel";
import { MAINTENANCE_DISPLAY_COPY, toDeadlineKind, type TodoTone } from "../../task-schedule";
import {
  describeMaintenanceWindowFromIso,
  formatTokyoDate,
  getMaintenanceDisplayStateFromIso,
} from "../../time-zone";

type ExternalLinkData = { id: string; url: string };
type PendingTodoData = {
  assigneeUserId: string | null;
  badge: string;
  dueAt: string;
  id: string;
  meta: string;
  scheduledFor: string;
  title: string;
  tone: TodoTone;
};
type RecentCompletionData = {
  id: string;
  occurredAt: string;
  title: string;
};
type LastActivityData = { actorName: string; occurredAt: string };

export type ManagedItemDetailData = {
  actorName: string;
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
  actor_user_id: string;
  occurred_at: string;
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
      toDeadlineKind(rule.deadline_kind);
      return rule.task_occurrences
        .filter((occurrence) => occurrence.status === "pending")
        .map((occurrence) => {
          const window = {
            dueAt: occurrence.due_at,
            scheduledFor: occurrence.scheduled_for,
          };
          const state = getMaintenanceDisplayStateFromIso(window, nowIso);
          const copy = MAINTENANCE_DISPLAY_COPY[state];
          return {
            assigneeUserId: occurrence.assignee_user_id,
            badge: copy.badge,
            dueAt: occurrence.due_at,
            id: occurrence.id,
            meta: describeMaintenanceWindowFromIso(state, window),
            scheduledFor: occurrence.scheduled_for,
            title: rule.title,
            tone: copy.tone,
          };
        });
    })
    .sort((left, right) => left.scheduledFor.localeCompare(right.scheduledFor));
}

// 取消されていない直近の完了(occurred_at基準)を、全TaskRuleを横断して1件返す
// (YDR-012)。「誰が」は#30の表示名を使い、操作主体と実施者の分離に備える(Issue #36)。
function findLatestCompletionLog(taskRules: TaskRuleRow[]): ActivityLogRow | null {
  const logs = taskRules.flatMap((rule) =>
    rule.task_occurrences
      .filter((occurrence) => occurrence.status === "completed")
      .flatMap((occurrence) =>
        occurrence.activity_logs.filter((log) => log.action === "completed"),
      ),
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
      const completions = rule.task_occurrences
        .filter((occurrence) => occurrence.status === "completed")
        .flatMap((occurrence) =>
          occurrence.activity_logs
            .filter((log) => log.action === "completed")
            .map((log) => ({
              id: occurrence.id,
              occurredAt: log.occurred_at,
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
  managedItemId,
  members,
  todos,
}: {
  actorName: string;
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
  managedItemId,
}: {
  completions: RecentCompletionData[];
  managedItemId: string;
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
              <UndoCompletionPanel
                managedItemId={managedItemId}
                occurredAt={completion.occurredAt}
                occurrenceId={completion.id}
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
            <strong>{lastActivity.actorName}</strong>
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
        <p>登録した管理対象と、現在のメンテナンスTodoを確認できます。</p>
      </header>

      <LastActivitySummary lastActivity={item.lastActivity} />

      <div className="ledger-grid managed-item-detail-grid">
        <PendingTodoSection
          actorName={item.actorName}
          managedItemId={item.id}
          members={item.members}
          todos={item.pendingTodos}
        />

        <section aria-labelledby="register-todo-title" className="detail-card">
          <p className="detail-kicker">ADD TODO</p>
          <h2 id="register-todo-title">メンテナンスTodoを登録</h2>
          <p className="detail-note">
            完了した日から次回の目安を計算するTodoを登録します。
          </p>
          <MaintenanceTodoForm managedItemId={item.id} />
        </section>

        <RecentCompletionSection
          completions={item.recentCompletions}
          managedItemId={item.id}
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
  const supabase = await createClient();
  const nowIso = new Date().toISOString();
  const [{ data, error }, actorName] = await Promise.all([
    supabase
      .from("managed_items")
      .select(
        "id, name, kind, household_id, external_links(id, url), task_rules(id, title, deadline_kind, task_occurrences(id, status, scheduled_for, due_at, assignee_user_id, activity_logs!activity_logs_occurrence_household_fkey(action, occurred_at, actor_user_id)))",
      )
      .eq("id", id)
      .maybeSingle(),
    loadActorName(supabase, user.id, FALLBACK_SELF_ACTOR_NAME),
  ]);

  if (error !== null) {
    throw new Error("管理対象を取得できませんでした。");
  }

  if (data === null) notFound();

  const pendingTodos = buildPendingTodos(data.task_rules, nowIso);
  const recentCompletions = buildRecentCompletions(data.task_rules);
  const latestCompletionLog = findLatestCompletionLog(data.task_rules);
  const [lastActivityActorName, members] = await Promise.all([
    latestCompletionLog === null
      ? Promise.resolve(null)
      : loadActorName(
          supabase,
          latestCompletionLog.actor_user_id,
          FALLBACK_OTHER_MEMBER_NAME,
        ),
    // Issue #72: 担当者選択の候補は同じ家庭のメンバーに限る。
    loadHouseholdMembers(supabase, data.household_id),
  ]);
  const lastActivity =
    latestCompletionLog === null || lastActivityActorName === null
      ? null
      : { actorName: lastActivityActorName, occurredAt: latestCompletionLog.occurred_at };

  return (
    <ManagedItemDetailContent
      item={{
        actorName,
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
