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
import type { TodoCardItem } from "../todo-card";
import { FloatingAddButton } from "../floating-add-button";
import {
  COMPLETED_LIMIT_MAX,
  COMPLETED_PAGE_SIZE,
  parseAssigneeParam,
  parseCompletedLimit,
  parseSearchParam,
  parseStatusFilter,
  parseViewParam,
  toAssigneeFilter,
  type TodoListViewMode,
  type TodoStatusFilter,
} from "./list-params";
import {
  AssigneeFilterDisclosure,
  TodoSearchDisclosure,
  TodoStatusSwitch,
  TodoViewSwitch,
} from "./list-toolbar";
import {
  HouseholdRequiredNotice,
  TodoListEmptyState,
  TodoListSection,
} from "./list-sections";

export type TodoListHouseholdSummary = { id: string; name: string };

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

type TodoListContentProps = {
  actorName: string;
  // Issue #223: URLの生の値(表示・href組み立て用)。household所属や実在は
  // 問わない(取得関数側がhousehold_idで安全に絞り込む)。既定値は既存の
  // 呼び出し元(既存の呼び出し・テスト含む)を変えずに済むよう省略可能にする。
  assigneeParam?: string | undefined;
  currentUserId: string;
  household: TodoListHouseholdSummary | null;
  items: TodoCardItem[];
  members: HouseholdMemberOption[];
  // 実施済み(status="completed")のときだけ意味を持つ。既定値は未完了の
  // 呼び出し元(既存の呼び出し・テスト含む)を変えずに済むよう省略可能にする。
  nextLimit?: number;
  // Issue #225: URLの生の値(表示・href組み立て用)。trim済み・空文字は
  // undefined(parseSearchParam参照)。既定値は既存の呼び出し元(既存の
  // 呼び出し・テスト含む)を変えずに済むよう省略可能にする。
  searchParam?: string | undefined;
  showLoadMore?: boolean;
  status?: TodoStatusFilter;
  // Issue #224: URLの生の値(表示・href組み立て用)。既定値は既存の
  // 呼び出し元(既存の呼び出し・テスト含む)を変えずに済むよう省略可能にし、
  // 未指定はカード表示(既定、受け入れ基準)として扱う。
  viewParam?: TodoListViewMode;
};

function TodoListBody({
  actorName,
  assigneeParam,
  currentUserId,
  household,
  items,
  members,
  nextLimit,
  searchParam,
  showLoadMore,
  status,
  viewParam,
}: TodoListContentProps & {
  nextLimit: number;
  showLoadMore: boolean;
  status: TodoStatusFilter;
  viewParam: TodoListViewMode;
}) {
  if (household === null) return <HouseholdRequiredNotice />;
  if (items.length === 0) {
    return <TodoListEmptyState householdName={household.name} searchParam={searchParam} status={status} />;
  }
  return (
    <TodoListSection
      actorName={actorName}
      assigneeParam={assigneeParam}
      currentUserId={currentUserId}
      items={items}
      members={members}
      nextLimit={nextLimit}
      searchParam={searchParam}
      showLoadMore={showLoadMore}
      status={status}
      viewParam={viewParam}
    />
  );
}

export function TodoListContent({
  nextLimit = COMPLETED_PAGE_SIZE,
  showLoadMore = false,
  status = "pending",
  viewParam = "card",
  ...rest
}: TodoListContentProps) {
  return (
    <main className="detail-page todo-list-page">
      {/* Issue #241: ページ名・状態切り替え・検索の入り口を一つのツールバーへ
      まとめる(案1)。状態によって変わる説明文や「ALL TODOS」のような
      キッカーは、画面を見れば用途が分かるため出さない(受け入れ基準)。
      見出し自体は文書構造として残しつつ、見た目は小さくする。 */}
      <div className="todo-toolbar">
        <h1 className="todo-toolbar-title">Todo一覧</h1>
        {rest.household === null ? null : (
          <div className="todo-toolbar-actions">
            <TodoStatusSwitch
              assigneeParam={rest.assigneeParam}
              searchParam={rest.searchParam}
              status={status}
              viewParam={viewParam}
            />
            <AssigneeFilterDisclosure
              assigneeParam={rest.assigneeParam}
              currentUserId={rest.currentUserId}
              members={rest.members}
              searchParam={rest.searchParam}
              status={status}
              viewParam={viewParam}
            />
            <TodoViewSwitch
              assigneeParam={rest.assigneeParam}
              searchParam={rest.searchParam}
              status={status}
              viewParam={viewParam}
            />
            <TodoSearchDisclosure
              assigneeParam={rest.assigneeParam}
              searchParam={rest.searchParam}
              status={status}
              viewParam={viewParam}
            />
          </div>
        )}
      </div>

      <TodoListBody
        {...rest}
        nextLimit={nextLimit}
        showLoadMore={showLoadMore}
        status={status}
        viewParam={viewParam}
      />
      {rest.household === null ? null : <FloatingAddButton destination="todo" />}
    </main>
  );
}

async function loadCompletedTodoListContent(
  db: D1Database,
  session: D1Session,
  user: { id: string },
  household: TodoListHouseholdSummary,
  limit: number,
  assigneeParam: string | undefined,
  searchParam: string | undefined,
): Promise<TodoListContentProps> {
  const [actorName, completionRows, members] = await Promise.all([
    loadActorName(db, session, user.id, FALLBACK_SELF_ACTOR_NAME),
    // 現在の家庭の、有効な完了(訂正済みなら訂正後、YDR-026)だけを返す
    // (src/lib/d1/home.ts)。他家庭のTodoはこの取得経路に載らない。
    // Issue #223: assigneeParamは担当予定者(assignee_user_id)による絞り込み
    // であり、この完了を実際に行った実施者とは別の条件として扱う。
    // Issue #225: searchParamはTodo名(task_rule_title)の部分一致検索。
    listRecentActiveCompletions(db, session, limit, toAssigneeFilter(assigneeParam), searchParam),
    // Issue #72: 担当者選択の候補は同じ家庭のメンバーに限る。
    loadHouseholdMembers(db, session),
  ]);

  const performerIds = [
    ...new Set(completionRows.map((row) => row.performed_by_user_id)),
  ].filter((userId): userId is string => userId !== null);
  const performerNames = await loadProfileNames(db, session, performerIds);

  return {
    actorName,
    assigneeParam,
    currentUserId: user.id,
    household,
    items: buildRecentItems(completionRows, performerNames),
    members,
    // Issue #222: 増え続ける実施済みは初期件数を絞り、「もっと見る」で
    // COMPLETED_PAGE_SIZE件ずつ増やす。返った件数が要求件数ちょうどのときだけ、
    // まだ続きがある可能性として次のリンクを出す(上限はlistRecentActiveCompletions
    // 自体が持つCOMPLETED_LIMIT_MAXのクランプに委ねる)。
    nextLimit: Math.min(limit + COMPLETED_PAGE_SIZE, COMPLETED_LIMIT_MAX),
    searchParam,
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
  assigneeParam: string | undefined,
  searchParam: string | undefined,
): Promise<TodoListContentProps> {
  const [actorName, occurrenceRows, members] = await Promise.all([
    loadActorName(db, session, user.id, FALLBACK_SELF_ACTOR_NAME),
    // 現在の家庭のpending Occurrenceだけを返す(src/lib/d1/home.ts)。他家庭の
    // Todoはこの取得経路に載らない。Issue #223: assigneeParamは担当予定者
    // (assignee_user_id)による絞り込み。Issue #225: searchParamはTodo名
    // (task_rules.title)の部分一致検索。
    listPendingOccurrences(db, session, toAssigneeFilter(assigneeParam), searchParam),
    // Issue #72: 担当者選択の候補は同じ家庭のメンバーに限る。
    loadHouseholdMembers(db, session),
  ]);

  return {
    actorName,
    assigneeParam,
    currentUserId: user.id,
    household,
    items: buildTodoListItems(occurrenceRows, nowIso),
    members,
    searchParam,
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
  const assigneeParam = parseAssigneeParam(resolvedSearchParams.assignee);
  const searchParam = parseSearchParam(resolvedSearchParams.q);
  // Issue #224: 表示形式(カード/リスト)はデータ取得条件ではなく描画の選択
  // なので、他の絞り込みのように取得関数へは渡さず、描画直前でだけ使う。
  const viewParam = parseViewParam(resolvedSearchParams.view);

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
        viewParam={viewParam}
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
      assigneeParam,
      searchParam,
    )
    : await loadPendingTodoListContent(db, session, user, household, nowIso, assigneeParam, searchParam);

  return <TodoListContent {...content} viewParam={viewParam} />;
}
