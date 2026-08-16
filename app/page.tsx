import Link from "next/link";

import { requireUser } from "../lib/auth/current-user";
import {
  FALLBACK_OTHER_MEMBER_NAME,
  FALLBACK_SELF_ACTOR_NAME,
  type HouseholdMemberOption,
  loadActorName,
  loadHouseholdMembers,
} from "../lib/supabase/profile";
import { createClient } from "../lib/supabase/server";
import { AssigneePanel } from "./managed-items/[id]/assignee-panel";
import { CompleteTodoPanel } from "./managed-items/[id]/complete-todo-panel";
import { UndoCompletionPanel } from "./managed-items/[id]/undo-completion-panel";
import {
  MAINTENANCE_DISPLAY_COPY,
  STRICT_DISPLAY_COPY,
  toDeadlineKind,
  toRecurrenceBasis,
  type TodoTone,
} from "./task-schedule";
import {
  describeMaintenanceWindowFromIso,
  describeStrictScheduleFromIso,
  formatTokyoDate,
  formatTokyoMonthDay,
  getMaintenanceDisplayStateFromIso,
  getStrictDisplayStateFromIso,
  getTokyoDayDistance,
  PHASE_ONE_TIME_ZONE,
} from "./time-zone";

export type HomeItem = {
  // pending Todoにだけ設定する。未設定(誰でも可)はnull。
  assigneeUserId?: string | null;
  completedAt?: string;
  completedOccurrenceId?: string;
  detail: string;
  detailHref?: string;
  id: string;
  // Todoに関連する管理対象。家庭共通Todoではnull、完了・未完了のどちらにも設定する。
  managedItemId?: string | null;
  meta: string;
  // pending Todoにだけ設定し、ホームの担当・完了操作を有効にする。
  occurrenceId?: string;
  title: string;
  tone: TodoTone;
};

export type HomeSectionId = "overdue" | "today" | "reminder" | "upcoming" | "recent";

export type HomeSection = {
  description: string;
  id: HomeSectionId;
  items: HomeItem[];
  title: string;
};

export type HomeHouseholdSummary = { id: string; name: string };

const OPEN_SECTION_IDS = new Set<HomeSectionId>([
  "overdue",
  "today",
  "reminder",
  "upcoming",
]);

const TONE_LABELS: Record<TodoTone, string> = {
  caution: "要確認",
  done: "完了",
  reminder: "そろそろ",
  today: "今日",
  upcoming: "予定",
  urgent: "要対応",
};

// 期限切れ/今日/近日はdeadline_kind='strict'向けの区分。一回限りと
// 定例日基準を同じ日付分類へ載せるが、繰り返し方式は表示で区別する。
const HOME_SECTION_SKELETON: Omit<HomeSection, "items">[] = [
  { description: "期限を過ぎています", id: "overdue", title: "期限切れ" },
  { description: "今日確認したいこと", id: "today", title: "今日" },
  { description: "対応の目安の時期です", id: "reminder", title: "そろそろ" },
  { description: "これから7日間の予定", id: "upcoming", title: "近日" },
  { description: "家族が完了したこと", id: "recent", title: "最近の実施" },
];

const RECENT_COMPLETIONS_LIMIT = 10;

export type PendingOccurrenceRow = {
  assignee_user_id: string | null;
  due_at: string;
  id: string;
  scheduled_for: string;
  task_rules: {
    deadline_kind: string;
    managed_items: { id: string; name: string } | null;
    recurrence_basis: string;
    title: string;
  };
};

export type RecentCompletionRow = {
  id: string;
  occurred_at: string;
  performed_by_user_id: string | null;
  task_occurrences: {
    id: string;
    status: string;
    task_rules: {
      managed_items: { id: string; name: string } | null;
      title: string;
    };
  };
};

export function buildReminderItems(
  rows: PendingOccurrenceRow[],
  nowIso: string,
): HomeItem[] {
  return rows
    .slice()
    .sort((left, right) => left.due_at.localeCompare(right.due_at))
    .flatMap((row) => {
      const recurrenceBasis = toRecurrenceBasis(row.task_rules.recurrence_basis);
      const deadlineKind = toDeadlineKind(row.task_rules.deadline_kind);
      if (recurrenceBasis !== "completion") return [];
      if (deadlineKind !== "maintenance") {
        throw new Error("完了日基準Todoの期限方式が不正です。");
      }

      const window = { dueAt: row.due_at, scheduledFor: row.scheduled_for };
      const state = getMaintenanceDisplayStateFromIso(window, nowIso);
      // 推奨期間前(before-window)は交換・対応を急かさないため表示しない。
      if (state === "before-window") return [];

      const copy = MAINTENANCE_DISPLAY_COPY[state];
      return [
        {
          assigneeUserId: row.assignee_user_id,
          detail: row.task_rules.managed_items?.name ?? "管理対象なし",
          ...(row.task_rules.managed_items === null
            ? {}
            : { detailHref: `/managed-items/${row.task_rules.managed_items.id}` }),
          id: row.id,
          managedItemId: row.task_rules.managed_items?.id ?? null,
          meta: describeMaintenanceWindowFromIso(state, window),
          occurrenceId: row.id,
          title: row.task_rules.title,
          tone: copy.tone,
        },
      ];
    });
}

type StrictItems = Record<"overdue" | "today" | "upcoming", HomeItem[]>;

export function buildStrictItems(
  rows: PendingOccurrenceRow[],
  nowIso: string,
): StrictItems {
  const result: StrictItems = { overdue: [], today: [], upcoming: [] };

  rows
    .slice()
    .sort((left, right) => left.due_at.localeCompare(right.due_at))
    .forEach((row) => {
      const recurrenceBasis = toRecurrenceBasis(row.task_rules.recurrence_basis);
      const deadlineKind = toDeadlineKind(row.task_rules.deadline_kind);
      if (recurrenceBasis === "completion") return;
      if (deadlineKind !== "strict") {
        throw new Error("厳密な期限Todoの期限方式が不正です。");
      }

      const state = getStrictDisplayStateFromIso(row.due_at, nowIso);
      if (state === "upcoming" && getTokyoDayDistance(nowIso, row.due_at) > 7) {
        return;
      }
      const sectionId = state === "due-today" ? "today" : state;
      const copy = STRICT_DISPLAY_COPY[state];
      result[sectionId].push({
        assigneeUserId: row.assignee_user_id,
        detail: row.task_rules.managed_items?.name ?? "管理対象なし",
        ...(row.task_rules.managed_items === null
          ? {}
          : { detailHref: `/managed-items/${row.task_rules.managed_items.id}` }),
        id: row.id,
        managedItemId: row.task_rules.managed_items?.id ?? null,
        meta: `${describeStrictScheduleFromIso(state, row.due_at)} ・ ${
          recurrenceBasis === "calendar" ? "曜日・日付で繰り返す" : "繰り返しなし"
        }`,
        occurrenceId: row.id,
        title: row.task_rules.title,
        tone: copy.tone,
      });
    });

  return result;
}

export function buildRecentItems(
  rows: RecentCompletionRow[],
  performerNames: Map<string, string>,
): HomeItem[] {
  return rows
    // 完了取消(Issue #37, YDR-015)でOccurrenceの状態がpendingへ戻った場合、
    // 完了ActivityLog自体は削除しないため、ここで「最近の実施」から除く。
    .filter((row) => row.task_occurrences.status === "completed")
    .map((row) => {
      const managedItem = row.task_occurrences.task_rules.managed_items;
      return {
        completedAt: row.occurred_at,
        completedOccurrenceId: row.task_occurrences.id,
        detail: managedItem?.name ?? "管理対象なし",
        ...(managedItem === null
          ? {}
          : { detailHref: `/managed-items/${managedItem.id}` }),
        id: row.id,
        managedItemId: managedItem?.id ?? null,
        // 「誰が」は操作主体ではなく実施者(performed_by_user_id)を表示する
        // (Issue #18, YDR-020)。performed_by_user_idはaction='completed'の行に
        // 常に設定される(CHECK制約)が、型上はnull許容のためフォールバックする。
        meta: `${formatTokyoDate(row.occurred_at)} ・ ${
          (row.performed_by_user_id === null
            ? null
            : performerNames.get(row.performed_by_user_id)) ?? FALLBACK_OTHER_MEMBER_NAME
        }が実施`,
        title: row.task_occurrences.task_rules.title,
        tone: "done" as const,
      };
    });
}

function buildHomeSections(
  reminderItems: HomeItem[],
  recentItems: HomeItem[],
  strictItems: StrictItems,
): HomeSection[] {
  const itemsBySectionId: Record<HomeSectionId, HomeItem[]> = {
    overdue: strictItems.overdue,
    reminder: reminderItems,
    recent: recentItems,
    today: strictItems.today,
    upcoming: strictItems.upcoming,
  };

  return HOME_SECTION_SKELETON.map((section) => ({
    ...section,
    items: itemsBySectionId[section.id],
  }));
}

function formatHeroDate(nowIso: string): string {
  const weekday = new Intl.DateTimeFormat("ja-JP", {
    timeZone: PHASE_ONE_TIME_ZONE,
    weekday: "narrow",
  }).format(new Date(nowIso));
  return `${formatTokyoMonthDay(nowIso)} ${weekday}`;
}

async function loadHomeSections(
  supabase: Awaited<ReturnType<typeof createClient>>,
  nowIso: string,
): Promise<HomeSection[]> {
  const [
    { data: occurrenceRows, error: occurrenceError },
    { data: activityRows, error: activityError },
  ] = await Promise.all([
    supabase
      .from("task_occurrences")
      .select(
        "id, scheduled_for, due_at, assignee_user_id, task_rules(id, title, deadline_kind, recurrence_basis, managed_items(id, name))",
      )
      .eq("status", "pending"),
    supabase
      .from("activity_logs")
      .select(
        "id, occurred_at, performed_by_user_id, task_occurrences!activity_logs_occurrence_household_fkey(id, status, task_rules(id, title, managed_items(id, name)))",
      )
      .eq("action", "completed")
      .order("occurred_at", { ascending: false })
      .limit(RECENT_COMPLETIONS_LIMIT),
  ]);

  if (occurrenceError !== null || activityError !== null) {
    throw new Error("ホームの予定を取得できませんでした。");
  }

  // 「最近の実施」に表示するのは実施者(performed_by_user_id)。操作主体
  // (actor_user_id)は表示しない(Issue #18, YDR-020)。
  const performerIds = [
    ...new Set(
      activityRows
        .map((row) => row.performed_by_user_id)
        .filter((userId): userId is string => userId !== null),
    ),
  ];
  const { data: profileRows, error: profileError } =
    performerIds.length === 0
      ? { data: [] as { nickname: string; user_id: string }[], error: null }
      : await supabase.from("profiles").select("user_id, nickname").in("user_id", performerIds);

  if (profileError !== null) {
    throw new Error("実施者を取得できませんでした。");
  }

  const performerNames = new Map(profileRows.map((row) => [row.user_id, row.nickname]));

  return buildHomeSections(
    buildReminderItems(occurrenceRows, nowIso),
    buildRecentItems(activityRows, performerNames),
    buildStrictItems(occurrenceRows, nowIso),
  );
}

function TaskTitle({ item }: { item: HomeItem }) {
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
        {TONE_LABELS[item.tone]}
      </span>
    </div>
  );
}

function TaskActions({
  actorName,
  currentUserId,
  item,
  members,
}: {
  actorName: string;
  currentUserId: string;
  item: HomeItem;
  members: HouseholdMemberOption[];
}) {
  const pendingOccurrenceId =
    item.occurrenceId ??
    (typeof item.managedItemId === "string" ? item.id : undefined);
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
      </>
    );
  }
  if (item.completedAt === undefined || item.completedOccurrenceId === undefined) {
    return null;
  }
  return (
    <UndoCompletionPanel
      managedItemId={item.managedItemId ?? null}
      occurredAt={item.completedAt}
      occurrenceId={item.completedOccurrenceId}
      taskTitle={item.title}
    />
  );
}

function TaskCard({
  actorName,
  currentUserId,
  item,
  members,
}: {
  actorName: string;
  currentUserId: string;
  item: HomeItem;
  members: HouseholdMemberOption[];
}) {
  return (
    <article className="task-card">
      <div className={`status-mark status-${item.tone}`} aria-hidden="true" />
      <div className="task-copy">
        <TaskTitle item={item} />
        <p className="item-detail">{item.detail}</p>
        <p className="item-meta">{item.meta}</p>
        <TaskActions
          actorName={actorName}
          currentUserId={currentUserId}
          item={item}
          members={members}
        />
      </div>
    </article>
  );
}

function HomeSectionView({
  actorName,
  currentUserId,
  members,
  section,
}: {
  actorName: string;
  currentUserId: string;
  members: HouseholdMemberOption[];
  section: HomeSection;
}) {
  return (
    <section aria-labelledby={`${section.id}-title`} className="home-section">
      <div className="section-heading">
        <div>
          <h2 id={`${section.id}-title`}>{section.title}</h2>
          <p>{section.description}</p>
        </div>
        <span className="count" aria-label={`${String(section.items.length)}件`}>
          {section.items.length}
        </span>
      </div>

      <div className="card-list">
        {section.items.map((item) => (
          <TaskCard
            actorName={actorName}
            currentUserId={currentUserId}
            item={item}
            key={item.id}
            members={members}
          />
        ))}
      </div>
    </section>
  );
}

function HomeHero({
  canAddTodo,
  heroDateLabel,
  openItemCount,
  overdueItemCount,
}: {
  canAddTodo: boolean;
  heroDateLabel: string;
  openItemCount: number;
  overdueItemCount: number;
}) {
  return (
    <header className="hero">
      <div className="brand-row">
        <div>
          <p className="eyebrow">HOME CARE</p>
          <h1>YAMORU</h1>
        </div>
        <div className="hero-actions">
          <span className="date-badge">{heroDateLabel}</span>
          {canAddTodo ? (
            <Link className="account-link" href="/todos/new">
              Todoを追加
            </Link>
          ) : null}
          <Link className="account-link" href="/managed-items">
            家の台帳
          </Link>
          <Link className="account-link" href="/account" aria-label="アカウントを開く">
            アカウント
          </Link>
        </div>
      </div>
      <p className="tagline">暮らしの「いつだっけ？」をなくす。</p>

      <div className="summary" aria-label="対応状況">
        <div>
          <strong>{openItemCount}</strong>
          <span>件の予定</span>
        </div>
        <div>
          <strong>{overdueItemCount}</strong>
          <span>件が期限切れ</span>
        </div>
      </div>
    </header>
  );
}

function HouseholdRequiredNotice() {
  return (
    <section aria-labelledby="household-required-title" className="detail-card">
      <h2 id="household-required-title">家庭を作成してください</h2>
      <p>ホームは家庭ごとに表示します。先にアカウント画面で家庭を作成してください。</p>
      <Link className="ledger-primary-link" href="/account">
        家庭を作成する
      </Link>
    </section>
  );
}

function HomeEmptyState({ householdName }: { householdName: string }) {
  return (
    <section aria-labelledby="home-empty-title" className="detail-card">
      <h2 id="home-empty-title">まだ表示できる予定がありません</h2>
      <p>
        {householdName}
        には、まだTodoや完了記録がありません。
      </p>
      <Link className="ledger-primary-link" href="/todos/new">
        最初のTodoを追加
      </Link>
      <Link className="ledger-primary-link" href="/managed-items">
        家の台帳を開く
      </Link>
    </section>
  );
}

function HomeSectionList({
  actorName,
  currentUserId,
  members,
  sections,
}: {
  actorName: string;
  currentUserId: string;
  members: HouseholdMemberOption[];
  sections: HomeSection[];
}) {
  return (
    <div className="section-list">
      {sections.map((section) => (
        <HomeSectionView
          actorName={actorName}
          currentUserId={currentUserId}
          key={section.id}
          members={members}
          section={section}
        />
      ))}
    </div>
  );
}

export function HomeContent({
  actorName,
  currentUserId,
  heroDateLabel,
  household,
  members,
  sections,
}: {
  actorName: string;
  currentUserId: string;
  heroDateLabel: string;
  household: HomeHouseholdSummary | null;
  members: HouseholdMemberOption[];
  sections: HomeSection[];
}) {
  const openItemCount = sections.reduce(
    (total, section) =>
      total + (OPEN_SECTION_IDS.has(section.id) ? section.items.length : 0),
    0,
  );
  const overdueItemCount =
    sections.find((section) => section.id === "overdue")?.items.length ?? 0;
  const visibleSections = sections.filter((section) => section.items.length > 0);

  return (
    <main>
      <HomeHero
        canAddTodo={household !== null}
        heroDateLabel={heroDateLabel}
        openItemCount={openItemCount}
        overdueItemCount={overdueItemCount}
      />

      {household === null ? (
        <HouseholdRequiredNotice />
      ) : (
        <div className="home-flow">
          {visibleSections.length === 0 ? (
            <HomeEmptyState householdName={household.name} />
          ) : (
            <HomeSectionList
              actorName={actorName}
              currentUserId={currentUserId}
              members={members}
              sections={visibleSections}
            />
          )}
        </div>
      )}

      <footer>
        <span className="footer-mark" aria-hidden="true">Y</span>
        <p>今日は、家のことが見えています。</p>
      </footer>
    </main>
  );
}

export default async function Home() {
  const user = await requireUser();
  const supabase = await createClient();
  const nowIso = new Date().toISOString();
  const heroDateLabel = formatHeroDate(nowIso);

  const [{ data: householdData, error: householdError }, actorName] = await Promise.all([
    supabase
      .from("households")
      .select("id, name")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    loadActorName(supabase, user.id, FALLBACK_SELF_ACTOR_NAME),
  ]);

  if (householdError !== null) {
    throw new Error("家庭情報を取得できませんでした。");
  }

  const household: HomeHouseholdSummary | null = householdData;
  if (household === null) {
    return (
      <HomeContent
        actorName={actorName}
        currentUserId={user.id}
        heroDateLabel={heroDateLabel}
        household={null}
        members={[]}
        sections={[]}
      />
    );
  }

  const [sections, members] = await Promise.all([
    loadHomeSections(supabase, nowIso),
    // Issue #72: 担当者選択の候補は同じ家庭のメンバーに限る。実施者選択(Issue #18)も同じ候補を使う。
    loadHouseholdMembers(supabase, household.id),
  ]);

  return (
    <HomeContent
      actorName={actorName}
      currentUserId={user.id}
      heroDateLabel={heroDateLabel}
      household={household}
      members={members}
      sections={sections}
    />
  );
}
