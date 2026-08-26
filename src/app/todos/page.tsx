import Link from "next/link";

import { requireUser } from "../../lib/auth/current-user";
import type { D1Session } from "../../lib/d1/authorization";
import { getD1Context } from "../../lib/d1/context";
import {
  listPendingOccurrences,
  listRecentActiveCompletions,
  type PendingOccurrenceRow,
} from "../../lib/d1/home";
import { loadAccountState } from "../../lib/d1/households";
import {
  FALLBACK_SELF_ACTOR_NAME,
  type HouseholdMemberOption,
  loadActorName,
  loadHouseholdMembers,
  loadProfileNames,
} from "../../lib/d1/profiles";
import { buildPendingTodoEntries } from "../pending-todo";
import { buildRecentItems } from "../page";
import { TodoCard, type TodoCardItem } from "../todo-card";

export type TodoListHouseholdSummary = { id: string; name: string };

// Issue #222: 未完了(既定)と実施済みをstatusクエリーパラメーターで切り替える
// (案1)。タブごとに別ルートを持つ案2や、同一画面での追加読み込みだけで
// 済ませる案3より、既存のTodo一覧の構造(household所属チェック→一覧取得)を
// そのまま流用でき、URLだけで状態を復元できる点を優先した。
export type TodoStatusFilter = "completed" | "pending";

// 実施済みは件数が増え続けるため、初期表示件数を絞り、「もっと見る」で
// COMPLETED_PAGE_SIZE件ずつ増やす。上限はlistRecentActiveCompletions自体が
// 持つ100件のクランプに委ね、それ以上は「もっと見る」を出さない
// (履歴全体の閲覧は本Issueの対象外)。
const COMPLETED_PAGE_SIZE = 20;
const COMPLETED_LIMIT_MAX = 100;

function parseStatusFilter(value: string | string[] | undefined): TodoStatusFilter {
  return value === "completed" ? "completed" : "pending";
}

function parseCompletedLimit(value: string | string[] | undefined): number {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;
  if (!Number.isFinite(parsed)) return COMPLETED_PAGE_SIZE;
  return Math.min(Math.max(parsed, COMPLETED_PAGE_SIZE), COMPLETED_LIMIT_MAX);
}

// ホームは「いま対応すること」、この画面は「未完了Todoすべて」(Issue #201)。
// 予定日の遠近も、ManagedItemとの関連有無も、表示するかどうかの条件にしない。
// 日付があるTodoは期限の昇順、予定日未定Todo(YDR-030)は末尾へ置く。
export function buildTodoListItems(
  rows: PendingOccurrenceRow[],
  nowIso: string,
): TodoCardItem[] {
  const entries = buildPendingTodoEntries(rows, nowIso);
  return [
    ...entries.filter((entry) => entry.sortKey !== null),
    ...entries.filter((entry) => entry.sortKey === null),
  ].map((entry) => entry.item);
}

function TodoListHero({
  hasHousehold,
  status,
}: {
  hasHousehold: boolean;
  status: TodoStatusFilter;
}) {
  return (
    <header className="detail-hero">
      <p className="detail-kicker">ALL TODOS</p>
      <h1>Todo一覧</h1>
      <p>
        {status === "completed"
          ? "過去に実施したTodoを確認できます。"
          : "未完了のTodoをまとめて確認できます。"}
      </p>
      {hasHousehold ? (
        <Link className="ledger-primary-link" href="/todos/new">
          Todoを追加
        </Link>
      ) : null}
    </header>
  );
}

// Issue #222: 「未完了」「実施済み」はstatusクエリーパラメーターで切り替える
// (このファイル冒頭のTodoStatusFilterのコメント参照)。
function TodoStatusSwitch({ status }: { status: TodoStatusFilter }) {
  return (
    <nav aria-label="Todoの状態を切り替え" className="status-switch">
      <Link
        aria-current={status === "pending" ? "page" : undefined}
        className="status-switch-option"
        href="/todos"
      >
        未完了
      </Link>
      <Link
        aria-current={status === "completed" ? "page" : undefined}
        className="status-switch-option"
        href="/todos?status=completed"
      >
        実施済み
      </Link>
    </nav>
  );
}

function HouseholdRequiredNotice() {
  return (
    <section aria-labelledby="household-required-title" className="detail-card">
      <h2 id="household-required-title">家庭を作成してください</h2>
      <p>Todoは家庭ごとに保存します。先に家庭画面で家庭を作成してください。</p>
      <Link className="ledger-primary-link" href="/household">
        家庭を作成する
      </Link>
    </section>
  );
}

function TodoListEmptyState({
  householdName,
  status,
}: {
  householdName: string;
  status: TodoStatusFilter;
}) {
  if (status === "completed") {
    return (
      <section aria-labelledby="todo-list-empty-title" className="detail-card">
        <h2 id="todo-list-empty-title">実施済みのTodoはまだありません</h2>
        <p>
          {householdName}
          には、まだ実施記録がありません。
        </p>
      </section>
    );
  }
  return (
    <section aria-labelledby="todo-list-empty-title" className="detail-card">
      <h2 id="todo-list-empty-title">未完了のTodoはありません</h2>
      <p>
        {householdName}
        には、いま残っているTodoがありません。
      </p>
      <Link className="ledger-primary-link" href="/todos/new">
        最初のTodoを追加
      </Link>
    </section>
  );
}

function TodoListLoadMore({ nextLimit }: { nextLimit: number }) {
  return (
    <Link
      className="ledger-primary-link todo-list-load-more"
      href={`/todos?status=completed&limit=${String(nextLimit)}`}
    >
      もっと見る
    </Link>
  );
}

function TodoListSection({
  actorName,
  currentUserId,
  items,
  members,
  nextLimit,
  showLoadMore,
  status,
}: {
  actorName: string;
  currentUserId: string;
  items: TodoCardItem[];
  members: HouseholdMemberOption[];
  nextLimit: number;
  showLoadMore: boolean;
  status: TodoStatusFilter;
}) {
  const heading = status === "completed" ? "実施済みのTodo" : "未完了のTodo";
  const description = status === "completed"
    ? "実施日が新しいものから並びます"
    : "予定日が早いものから並び、予定日未定は最後に並びます";
  return (
    <section aria-labelledby="todo-list-title" className="home-section">
      <div className="section-heading">
        <div>
          <h2 id="todo-list-title">{heading}</h2>
          <p>{description}</p>
        </div>
        <span className="count" aria-label={`${String(items.length)}件`}>
          {items.length}
        </span>
      </div>

      <div className="card-list">
        {items.map((item) => (
          <TodoCard
            actorName={actorName}
            // 予定日未定Todoを再発見し、その場で予定日を決められるようにする
            // (#201、#202)。ホームのカードでは提供しない(#204)。実施済みでは
            // occurrenceId自体を持たせないため、この値に関わらず操作は出ない
            // (Issue #206)。
            canChangeSchedule={status === "pending"}
            currentUserId={currentUserId}
            item={item}
            key={item.id}
            members={members}
          />
        ))}
      </div>

      {showLoadMore ? <TodoListLoadMore nextLimit={nextLimit} /> : null}
    </section>
  );
}

type TodoListContentProps = {
  actorName: string;
  currentUserId: string;
  household: TodoListHouseholdSummary | null;
  items: TodoCardItem[];
  members: HouseholdMemberOption[];
  // 実施済み(status="completed")のときだけ意味を持つ。既定値は未完了の
  // 呼び出し元(既存の呼び出し・テスト含む)を変えずに済むよう省略可能にする。
  nextLimit?: number;
  showLoadMore?: boolean;
  status?: TodoStatusFilter;
};

function TodoListBody({
  actorName,
  currentUserId,
  household,
  items,
  members,
  nextLimit,
  showLoadMore,
  status,
}: TodoListContentProps & { nextLimit: number; showLoadMore: boolean; status: TodoStatusFilter }) {
  if (household === null) return <HouseholdRequiredNotice />;
  if (items.length === 0) {
    return <TodoListEmptyState householdName={household.name} status={status} />;
  }
  return (
    <TodoListSection
      actorName={actorName}
      currentUserId={currentUserId}
      items={items}
      members={members}
      nextLimit={nextLimit}
      showLoadMore={showLoadMore}
      status={status}
    />
  );
}

export function TodoListContent({
  nextLimit = COMPLETED_PAGE_SIZE,
  showLoadMore = false,
  status = "pending",
  ...rest
}: TodoListContentProps) {
  return (
    <main className="detail-page todo-list-page">
      <TodoListHero hasHousehold={rest.household !== null} status={status} />
      {rest.household === null ? null : <TodoStatusSwitch status={status} />}

      <TodoListBody
        {...rest}
        nextLimit={nextLimit}
        showLoadMore={showLoadMore}
        status={status}
      />
    </main>
  );
}

async function loadCompletedTodoListContent(
  db: D1Database,
  session: D1Session,
  user: { id: string },
  household: TodoListHouseholdSummary,
  limit: number,
): Promise<TodoListContentProps> {
  const [actorName, completionRows, members] = await Promise.all([
    loadActorName(db, session, user.id, FALLBACK_SELF_ACTOR_NAME),
    // 現在の家庭の、有効な完了(訂正済みなら訂正後、YDR-026)だけを返す
    // (src/lib/d1/home.ts)。他家庭のTodoはこの取得経路に載らない。
    listRecentActiveCompletions(db, session, limit),
    // Issue #72: 担当者選択の候補は同じ家庭のメンバーに限る。
    loadHouseholdMembers(db, session),
  ]);

  const performerIds = [
    ...new Set(completionRows.map((row) => row.performed_by_user_id)),
  ].filter((userId): userId is string => userId !== null);
  const performerNames = await loadProfileNames(db, session, performerIds);

  return {
    actorName,
    currentUserId: user.id,
    household,
    items: buildRecentItems(completionRows, performerNames),
    members,
    // Issue #222: 増え続ける実施済みは初期件数を絞り、「もっと見る」で
    // COMPLETED_PAGE_SIZE件ずつ増やす。返った件数が要求件数ちょうどのときだけ、
    // まだ続きがある可能性として次のリンクを出す(上限はlistRecentActiveCompletions
    // 自体が持つCOMPLETED_LIMIT_MAXのクランプに委ねる)。
    nextLimit: Math.min(limit + COMPLETED_PAGE_SIZE, COMPLETED_LIMIT_MAX),
    showLoadMore: completionRows.length === limit && limit < COMPLETED_LIMIT_MAX,
    status: "completed",
  };
}

async function loadPendingTodoListContent(
  db: D1Database,
  session: D1Session,
  user: { id: string },
  household: TodoListHouseholdSummary,
  nowIso: string,
): Promise<TodoListContentProps> {
  const [actorName, occurrenceRows, members] = await Promise.all([
    loadActorName(db, session, user.id, FALLBACK_SELF_ACTOR_NAME),
    // 現在の家庭のpending Occurrenceだけを返す(src/lib/d1/home.ts)。他家庭の
    // Todoはこの取得経路に載らない。
    listPendingOccurrences(db, session),
    // Issue #72: 担当者選択の候補は同じ家庭のメンバーに限る。
    loadHouseholdMembers(db, session),
  ]);

  return {
    actorName,
    currentUserId: user.id,
    household,
    items: buildTodoListItems(occurrenceRows, nowIso),
    members,
    status: "pending",
  };
}

export default async function TodoListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const { db, session } = await getD1Context(user);
  const nowIso = new Date().toISOString();
  const resolvedSearchParams = await searchParams;
  const status = parseStatusFilter(resolvedSearchParams.status);

  // ホーム(app/page.tsx)と同じく、家庭所属チェックを先に確定させる。家庭専用の
  // 取得関数は家庭未所属だと例外を投げるため、並列化できない(Issue #144)。
  const accountState = await loadAccountState(db, session);
  const household: TodoListHouseholdSummary | null = accountState.household;
  if (household === null) {
    return (
      <TodoListContent
        actorName={FALLBACK_SELF_ACTOR_NAME}
        currentUserId={user.id}
        household={null}
        items={[]}
        members={[]}
        status={status}
      />
    );
  }

  const content = status === "completed"
    ? await loadCompletedTodoListContent(
      db,
      session,
      user,
      household,
      parseCompletedLimit(resolvedSearchParams.limit),
    )
    : await loadPendingTodoListContent(db, session, user, household, nowIso);

  return <TodoListContent {...content} />;
}
