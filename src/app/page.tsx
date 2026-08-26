import Link from "next/link";

import { requireUser } from "../lib/auth/current-user";
import {
  FALLBACK_OTHER_MEMBER_NAME,
  FALLBACK_SELF_ACTOR_NAME,
  type HouseholdMemberOption,
  loadActorName,
  loadHouseholdMembers,
  loadProfileNames,
} from "../lib/d1/profiles";
import { FloatingAddButton } from "./floating-add-button";
import { getD1Context } from "../lib/d1/context";
import {
  listPendingOccurrences,
  listRecentActiveCompletions,
  type PendingOccurrenceRow,
  type RecentCompletionRow,
} from "../lib/d1/home";
import { loadAccountState } from "../lib/d1/households";
import type { D1Session } from "../lib/d1/authorization";
import {
  buildPendingTodoEntries,
  type PendingTodoCategory,
} from "./pending-todo";
import { TodoCard, type TodoCardItem } from "./todo-card";
import { formatTokyoDate } from "./time-zone";

export type { PendingOccurrenceRow, RecentCompletionRow } from "../lib/d1/home";

export type HomeSectionId = "overdue" | "today" | "reminder" | "upcoming" | "recent";

export type HomeSection = {
  description: string;
  id: HomeSectionId;
  items: TodoCardItem[];
  title: string;
};

export type HomeHouseholdSummary = { id: string; name: string };

// 未完了Todoを表示する区分。完了記録の「最近の実施」だけは別扱いにする。
type OpenSectionId = Exclude<HomeSectionId, "recent">;

const OPEN_SECTION_IDS = new Set<HomeSectionId>([
  "overdue",
  "today",
  "reminder",
  "upcoming",
]);

// ホームは「いま対応すること」に絞る。ここへ載せない区分はTodo一覧
// (/todos)で確認する(Issue #201)。
// - later: 7日より先の予定
// - before-window: 完了日基準Todoの推奨期間前(YDR-017)
// - undated: 予定日未定Todo。着手できる時期が決まっていないため、要対応の
//   表示にも「件の予定」にも含めない(Issue #202、YDR-031)。
const HOME_SECTION_BY_CATEGORY = new Map<PendingTodoCategory, OpenSectionId>([
  ["overdue", "overdue"],
  ["today", "today"],
  ["reminder", "reminder"],
  ["upcoming", "upcoming"],
]);

const HOME_SECTION_SKELETON: Omit<HomeSection, "items">[] = [
  { description: "期限を過ぎています", id: "overdue", title: "期限切れ" },
  { description: "今日確認したいこと", id: "today", title: "今日" },
  { description: "対応の目安の時期です", id: "reminder", title: "そろそろ" },
  { description: "これから7日間の予定", id: "upcoming", title: "近日" },
  { description: "家族が完了したこと", id: "recent", title: "最近の実施" },
];

const RECENT_COMPLETIONS_LIMIT = 10;

// 未完了Todoをホームの区分へ振り分ける。分類そのものはpending-todo.tsが持ち、
// ここでは「ホームに載せる区分か」だけを決める(Issue #201)。
export function buildPendingSectionItems(
  rows: PendingOccurrenceRow[],
  nowIso: string,
): Record<OpenSectionId, TodoCardItem[]> {
  const result: Record<OpenSectionId, TodoCardItem[]> = {
    overdue: [],
    reminder: [],
    today: [],
    upcoming: [],
  };

  buildPendingTodoEntries(rows, nowIso).forEach((entry) => {
    const sectionId = HOME_SECTION_BY_CATEGORY.get(entry.category);
    if (sectionId !== undefined) result[sectionId].push(entry.item);
  });

  return result;
}

export function buildRecentItems(
  rows: RecentCompletionRow[],
  performerNames: Map<string, string>,
): TodoCardItem[] {
  const displayedOccurrences = new Set<string>();
  return rows
    // RPC側でOccurrenceごとの有効な完了を一件へ絞る。ここでも重複を除き、
    // 取得契約の崩れで取消済み完了を二重表示しないようにする。
    .filter((row) => {
      if (displayedOccurrences.has(row.task_occurrence_id)) return false;
      displayedOccurrences.add(row.task_occurrence_id);
      return true;
    })
    .map((row) => {
      return {
        detail: row.managed_item_name ?? "管理対象なし",
        ...(row.managed_item_id === null
          ? {}
          : { detailHref: `/managed-items/${row.managed_item_id}` }),
        id: row.activity_log_id,
        managedItemId: row.managed_item_id,
        // 「誰が」は操作主体ではなく実施者(performed_by_user_id)を表示する
        // (Issue #18, YDR-020)。performed_by_user_idはaction='completed'の行に
        // 常に設定される(CHECK制約)が、型上はnull許容のためフォールバックする。
        meta: `${formatTokyoDate(row.occurred_at)} ・ ${
          (row.performed_by_user_id === null
            ? null
            : performerNames.get(row.performed_by_user_id)) ?? FALLBACK_OTHER_MEMBER_NAME
        }が実施`,
        title: row.task_rule_title,
        // Issue #206: 最近の実施は確認専用とし、訂正・完了取消は
        // 完了済みTodo詳細へ集約する。管理対象なしでも同じ導線を持つ。
        todoHref: `/todos/${row.task_occurrence_id}`,
        tone: "done" as const,
      };
    });
}

function buildHomeSections(
  pendingItems: Record<OpenSectionId, TodoCardItem[]>,
  recentItems: TodoCardItem[],
): HomeSection[] {
  const itemsBySectionId: Record<HomeSectionId, TodoCardItem[]> = {
    ...pendingItems,
    recent: recentItems,
  };

  return HOME_SECTION_SKELETON.map((section) => ({
    ...section,
    items: itemsBySectionId[section.id],
  }));
}

async function loadHomeSections(
  db: D1Database,
  session: D1Session,
  nowIso: string,
): Promise<HomeSection[]> {
  const [occurrenceRows, activityRows] = await Promise.all([
    listPendingOccurrences(db, session),
    listRecentActiveCompletions(db, session, RECENT_COMPLETIONS_LIMIT),
  ]);

  // 「最近の実施」に表示するのは実施者(performed_by_user_id)。操作主体
  // (actor_user_id)は表示しない(Issue #18, YDR-020)。
  const performerIds = [
    ...new Set(activityRows.map((row) => row.performed_by_user_id)),
  ].filter((userId): userId is string => userId !== null);
  const performerNames = await loadProfileNames(db, session, performerIds);

  return buildHomeSections(
    buildPendingSectionItems(occurrenceRows, nowIso),
    buildRecentItems(activityRows, performerNames),
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
          <TodoCard
            actorName={actorName}
            // Issue #204: ホームのカードは確認・担当変更・完了に絞る。予定日の
            // 設定変更はTodo詳細の編集、またはTodo一覧から行う。
            canChangeSchedule={false}
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
  hasHousehold,
  openItemCount,
  overdueItemCount,
}: {
  hasHousehold: boolean;
  openItemCount: number;
  overdueItemCount: number;
}) {
  return (
    <header className="hero">
      <h1 className="sr-only">ホーム</h1>
      <nav aria-label="ホームの操作" className="hero-actions">
        {hasHousehold ? (
          /* PCはこの導線、モバイルは下部のTodoタブから一覧へ移動する(#213)。 */
          <Link className="account-link home-todo-list-link" href="/todos">
            Todo一覧
          </Link>
        ) : null}
        <Link className="account-link home-ledger-link" href="/managed-items">
          家の台帳
        </Link>
      </nav>

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
      <p>ホームは家庭ごとに表示します。先に家庭画面で家庭を作成してください。</p>
      <Link className="ledger-primary-link" href="/household">
        家庭を作成する
      </Link>
    </section>
  );
}

// Issue #202: 予定日未定Todoはホームに載せないため、ここが空でも未完了Todoが
// 残っていることがある。「Todoがない」と言い切らず、Todo一覧への導線を示す。
function HomeEmptyState({ householdName }: { householdName: string }) {
  return (
    <section aria-labelledby="home-empty-title" className="detail-card">
      <h2 id="home-empty-title">いま対応することはありません</h2>
      <p>
        {householdName}
        には、期限切れ・今日・近日のTodoも、最近の完了記録もありません。予定日が決まっていないTodoはTodo一覧で確認できます。新しいTodoは右下の「＋」ボタンから追加できます。
      </p>
      <Link className="ledger-primary-link home-todo-list-link" href="/todos">
        Todo一覧を見る
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
  household,
  members,
  sections,
}: {
  actorName: string;
  currentUserId: string;
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
        hasHousehold={household !== null}
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

      {household === null ? null : <FloatingAddButton destination="todo" />}

    </main>
  );
}

export default async function Home() {
  const user = await requireUser();
  const { db, session } = await getD1Context(user);
  const nowIso = new Date().toISOString();

  // 家庭所属チェック(loadAccountState)を先に確定させる。loadActorName等は
  // 内部でrequireCurrentHouseholdIdを呼び家庭未所属だと例外を投げるため、
  // Promise.allで並列化すると家庭未所属ユーザーがHouseholdRequiredNoticeへ
  // 到達する前にページごと例外で落ちてしまう(Issue #144)。
  const accountState = await loadAccountState(db, session);
  const household: HomeHouseholdSummary | null = accountState.household;
  if (household === null) {
    return (
      <HomeContent
        actorName={FALLBACK_SELF_ACTOR_NAME}
        currentUserId={user.id}
        household={null}
        members={[]}
        sections={[]}
      />
    );
  }

  const [actorName, sections, members] = await Promise.all([
    loadActorName(db, session, user.id, FALLBACK_SELF_ACTOR_NAME),
    loadHomeSections(db, session, nowIso),
    // Issue #72: 担当者選択の候補は同じ家庭のメンバーに限る。実施者選択(Issue #18)も同じ候補を使う。
    loadHouseholdMembers(db, session),
  ]);

  return (
    <HomeContent
      actorName={actorName}
      currentUserId={user.id}
      household={household}
      members={members}
      sections={sections}
    />
  );
}
