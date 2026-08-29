import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { requireUser } from "../../../lib/auth/current-user";
import {
  FALLBACK_OTHER_MEMBER_NAME,
  FALLBACK_SELF_ACTOR_NAME,
  type HouseholdMemberOption,
  loadActorName,
  loadHouseholdMembers,
  loadProfileNames,
} from "../../../lib/d1/profiles";
import { getD1Context } from "../../../lib/d1/context";
import { loadManagedItemDetail } from "../../../lib/d1/managed-items";
import { selectActiveCompletionLogs } from "../../active-completion";
import { ClassificationBadges } from "../classification-badges";
import { EditIcon } from "../../edit-icon";
import {
  isSafeExternalUrl,
  startedOnLabel,
} from "../model";
import { formatStartedOn } from "../started-on";
import { AssigneePanel } from "./assignee-panel";
import { CompleteTodoPanel } from "./complete-todo-panel";
import { PostponePanel } from "./postpone-panel";
import { SchedulePanel } from "./schedule-panel";
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
  dueAt: string | null;
  id: string;
  meta: string;
  recurrenceBasis: RecurrenceBasis;
  scheduledFor: string | null;
  title: string;
  tone: TodoTone;
};
// Issue #240: 独立したLAST ACTIVITYを廃止し、「直近の完了」の各行から
// 「いつ・誰が」を確認できるようにする(YDR-020の実施者表示は維持)。
type RecentCompletionData = {
  id: string;
  occurredAt: string;
  performerName: string;
  title: string;
};
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
  itemTypeLabel: string | null;
  kindCode: string;
  kindLabel: string;
  members: HouseholdMemberOption[];
  name: string;
  note: string | null;
  pendingTodos: PendingTodoData[];
  productInfo: string | null;
  recentCompletions: RecentCompletionData[];
  startedOn: string | null;
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
  due_at: string | null;
  id: string;
  scheduled_for: string | null;
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
function buildDatedPendingTodo(
  rule: TaskRuleRow,
  occurrence: TaskOccurrenceRow,
  scheduledFor: string,
  dueAt: string,
  nowIso: string,
): PendingTodoData {
  const deadlineKind = toDeadlineKind(rule.deadline_kind);
  const recurrenceBasis = toRecurrenceBasis(rule.recurrence_basis);
  if (recurrenceBasis !== "completion") {
    if (deadlineKind !== "strict") {
      throw new Error("厳密な期限Todoの期限方式が不正です。");
    }
    const state = getStrictDisplayStateFromIso(dueAt, nowIso);
    const copy = STRICT_DISPLAY_COPY[state];
    return {
      assigneeUserId: occurrence.assignee_user_id,
      badge: copy.badge,
      dueAt,
      id: occurrence.id,
      meta: describeStrictScheduleFromIso(state, dueAt),
      recurrenceBasis,
      scheduledFor,
      title: rule.title,
      tone: copy.tone,
    };
  }
  if (deadlineKind !== "maintenance") {
    throw new Error("完了日基準Todoの期限方式が不正です。");
  }
  const window = { dueAt, scheduledFor };
  const state = getMaintenanceDisplayStateFromIso(window, nowIso);
  const copy = MAINTENANCE_DISPLAY_COPY[state];
  return {
    assigneeUserId: occurrence.assignee_user_id,
    badge: copy.badge,
    dueAt,
    id: occurrence.id,
    meta: describeMaintenanceWindowFromIso(state, window),
    recurrenceBasis,
    scheduledFor,
    title: rule.title,
    tone: copy.tone,
  };
}

function buildPendingTodo(
  rule: TaskRuleRow,
  occurrence: TaskOccurrenceRow,
  nowIso: string,
): PendingTodoData {
  const scheduledFor = occurrence.scheduled_for;
  const dueAt = occurrence.due_at;
  if ((scheduledFor === null) !== (dueAt === null)) {
    throw new Error("Todoの予定日と期限の組み合わせが不正です。");
  }
  if (scheduledFor !== null && dueAt !== null) {
    return buildDatedPendingTodo(rule, occurrence, scheduledFor, dueAt, nowIso);
  }
  const deadlineKind = toDeadlineKind(rule.deadline_kind);
  const recurrenceBasis = toRecurrenceBasis(rule.recurrence_basis);
  if (recurrenceBasis !== "once" || deadlineKind !== "strict") {
    throw new Error("予定日未定を利用できないTodoです。");
  }
  return {
    assigneeUserId: occurrence.assignee_user_id,
    badge: "未定",
    dueAt: null,
    id: occurrence.id,
    meta: "予定日: 未定",
    recurrenceBasis,
    scheduledFor: null,
    title: rule.title,
    tone: "upcoming",
  };
}

function buildPendingTodos(taskRules: TaskRuleRow[], nowIso: string): PendingTodoData[] {
  return taskRules
    .flatMap((rule) => rule.task_occurrences
      .filter((occurrence) => occurrence.status === "pending")
      .map((occurrence) => buildPendingTodo(rule, occurrence, nowIso)))
    .sort((left, right) =>
      (left.scheduledFor ?? "").localeCompare(right.scheduledFor ?? "")
    );
}

// Issue #240: 「直近の完了」の各行に実施者を表示するため、TaskRuleごとの
// 最新完了(occurred_at基準、YDR-012)に実施者ID(performed_by_user_id、
// YDR-020)を残したまま返す。実施者名への解決は呼び出し側(D1アクセスが
// 必要)に任せる。
type RecentCompletionDraft = {
  id: string;
  occurredAt: string;
  performedByUserId: string | null;
  title: string;
};

function buildRecentCompletions(
  taskRules: TaskRuleRow[],
): RecentCompletionDraft[] {
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

function PendingTodoActions({
  actorName,
  currentUserId,
  managedItemId,
  members,
  todo,
}: {
  actorName: string;
  currentUserId: string;
  managedItemId: string;
  members: HouseholdMemberOption[];
  todo: PendingTodoData;
}) {
  return (
    <>
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
      {todo.recurrenceBasis === "once" ? (
        <SchedulePanel
          managedItemId={managedItemId}
          occurrenceId={todo.id}
          scheduledFor={todo.scheduledFor}
          taskTitle={todo.title}
        />
      ) : null}
      {todo.scheduledFor === null ? null : (
        <PostponePanel
          managedItemId={managedItemId}
          occurrenceId={todo.id}
          taskTitle={todo.title}
        />
      )}
    </>
  );
}

// Issue #240: 「現在のTodo」(確認)と「関連するTodoを追加」(追加)を一つの
// 領域へ整理する(issue本文の設計メモの案1)。確認対象と追加対象の関係が
// 同じ領域から分かるようにし、専用の登録ページへ管理対象を引き継ぐ導線は
// 維持する。
function RelatedTodoSection({
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
    <section aria-labelledby="related-todos-title" className="detail-card">
      <div className="detail-section-heading">
        <div>
          <p className="detail-kicker">TODO</p>
          <h2 id="related-todos-title">関連するTodo</h2>
        </div>
        <Link
          className="ledger-primary-link"
          href={`/todos/new?managedItemId=${encodeURIComponent(managedItemId)}`}
        >
          Todoを追加
        </Link>
      </div>
      {todos.length === 0 ? (
        <p className="ledger-empty">現在の未完了Todoはありません。</p>
      ) : (
        <ul className="maintenance-todo-list">
          {todos.map((todo) => (
            <li key={todo.id}>
              <div className="task-title-row">
                <strong>
                  <Link href={`/todos/${encodeURIComponent(todo.id)}`}>{todo.title}</Link>
                </strong>
                <span className={`tone-label tone-${todo.tone}`}>{todo.badge}</span>
              </div>
              <span className="input-help">
                {RECURRENCE_LABELS[todo.recurrenceBasis]}
              </span>
              <span>{todo.meta}</span>
              <PendingTodoActions
                actorName={actorName}
                currentUserId={currentUserId}
                managedItemId={managedItemId}
                members={members}
                todo={todo}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Issue #240: 独立したLAST ACTIVITYを廃止した代わりに、最新行(先頭)から
// 「いつ・誰が」を確認できるようにする。訂正済みの実施日時・実施者
// (YDR-026)、完了取消済みを除く現在有効な完了(selectActiveCompletionLogs)
// は、既にbuildRecentCompletionsが解決済みの値を使う。
function RecentCompletionSection({
  completions,
}: {
  completions: RecentCompletionData[];
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
              {/* Issue #206: 一覧は確認専用とし、Todo名から完了済み詳細へ移動する。 */}
              <strong>
                <Link href={`/todos/${completion.id}`}>{completion.title}</Link>
              </strong>
              <span>
                {formatTokyoDate(completion.occurredAt)}に完了・{completion.performerName}が実施
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ExternalLinksValue({ links }: { links: ExternalLinkData[] }) {
  return (
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
  );
}

// Issue #42, #239: 任意の記録は、残した項目だけを名称と値の対として表示する。
// Issue #240: 外部リンクもこの一覧の一項目として統合し(安全なURLだけを
// 受け取る)、記録が一つもなくても見出しと編集導線(鉛筆アイコン)は常に
// 表示する。「管理対象を編集」は名前・分類の変更もできるため、読み上げ名を
// 「記録を編集」に限定しない。
function ManagedItemRecordSection({
  kindCode,
  managedItemId,
  note,
  productInfo,
  safeLinks,
  startedOn,
}: {
  kindCode: string;
  managedItemId: string;
  note: string | null;
  productInfo: string | null;
  safeLinks: ExternalLinkData[];
  startedOn: string | null;
}) {
  const records: { label: string; value: ReactNode }[] = [];
  if (productInfo !== null) {
    records.push({ label: "メーカー・商品名など", value: productInfo });
  }
  if (startedOn !== null) {
    records.push({ label: startedOnLabel(kindCode), value: formatStartedOn(startedOn) });
  }
  if (safeLinks.length > 0) {
    records.push({ label: "外部リンク", value: <ExternalLinksValue links={safeLinks} /> });
  }
  if (note !== null) records.push({ label: "メモ", value: note });

  return (
    <section aria-labelledby="managed-item-record-title" className="detail-card">
      <div className="detail-section-heading">
        <div>
          <p className="detail-kicker">RECORD</p>
          <h2 id="managed-item-record-title">この管理対象の記録</h2>
        </div>
        <Link
          aria-label="管理対象を編集"
          className="icon-link"
          href={`/managed-items/${encodeURIComponent(managedItemId)}/edit`}
        >
          <EditIcon />
        </Link>
      </div>
      {records.length === 0 ? null : (
        <dl className="managed-item-record-list">
          {records.map((record) => (
            <div key={record.label}>
              <dt>{record.label}</dt>
              <dd>{record.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

// Issue #240: 画面内容から分かる説明文と、文字の「編集」リンクを外す。
// 編集導線はRECORD見出し横の鉛筆アイコンへ集約する。
function ManagedItemHeader({
  itemTypeLabel,
  kindLabel,
  name,
}: {
  itemTypeLabel: string | null;
  kindLabel: string;
  name: string;
}) {
  return (
    <header className="detail-hero">
      <p className="detail-kicker">MANAGED ITEM</p>
      <div className="detail-title-row">
        <h1>{name}</h1>
        <ClassificationBadges itemTypeLabel={itemTypeLabel} kindLabel={kindLabel} />
      </div>
    </header>
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

      <ManagedItemHeader
        itemTypeLabel={item.itemTypeLabel}
        kindLabel={item.kindLabel}
        name={item.name}
      />

      <div className="ledger-grid managed-item-detail-grid">
        <ManagedItemRecordSection
          kindCode={item.kindCode}
          managedItemId={item.id}
          note={item.note}
          productInfo={item.productInfo}
          safeLinks={safeLinks}
          startedOn={item.startedOn}
        />

        <RelatedTodoSection
          actorName={item.actorName}
          currentUserId={item.currentUserId}
          managedItemId={item.id}
          members={item.members}
          todos={item.pendingTodos}
        />

        <RecentCompletionSection
          completions={item.recentCompletions}
        />
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
  const recentCompletionDrafts = buildRecentCompletions(data.task_rules);
  // Issue #240: 表示する完了記録に必要な家庭メンバーだけを安全に解決する
  // (loadProfileNamesは自家庭の範囲で絞り込む)。最新1件専用の取得処理
  // (旧LAST ACTIVITY)は不要になったため削除した。
  const performerIds = [
    ...new Set(recentCompletionDrafts.map((completion) => completion.performedByUserId)),
  ].filter((userId): userId is string => userId !== null);
  const [performerNames, members] = await Promise.all([
    loadProfileNames(db, session, performerIds),
    // Issue #72: 担当者選択の候補は同じ家庭のメンバーに限る。実施者選択(Issue #18)も同じ候補を使う。
    loadHouseholdMembers(db, session),
  ]);
  const recentCompletions: RecentCompletionData[] = recentCompletionDrafts.map(
    (completion) => ({
      id: completion.id,
      occurredAt: completion.occurredAt,
      // performed_by_user_idはaction='completed'の行にのみ設定される
      // (CHECK制約、YDR-020)。万一nullの場合もフォールバック名で表示する
      // (表示方針を画面間でそろえる)。
      performerName: (completion.performedByUserId === null
        ? null
        : performerNames.get(completion.performedByUserId)) ?? FALLBACK_OTHER_MEMBER_NAME,
      title: completion.title,
    }),
  );

  return (
    <ManagedItemDetailContent
      item={{
        actorName,
        currentUserId: user.id,
        externalLinks: data.external_links,
        id: data.id,
        itemTypeLabel: data.itemTypeLabel,
        kindCode: data.kindCode,
        kindLabel: data.kindLabel,
        members,
        name: data.name,
        note: data.note,
        pendingTodos,
        productInfo: data.productInfo,
        recentCompletions,
        startedOn: data.startedOn,
      }}
    />
  );
}
