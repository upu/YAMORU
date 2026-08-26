import Link from "next/link";

import { requireUser } from "../../lib/auth/current-user";
import type { D1Session } from "../../lib/d1/authorization";
import { getD1Context } from "../../lib/d1/context";
import {
  type AssigneeFilter,
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
import { FloatingAddButton } from "../floating-add-button";

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

// Issue #223: 担当予定者(assignee_user_id)による絞り込み。案1(assignee
// クエリーパラメーターをサーバー側の取得条件へ反映)を採用し、「自分」は
// 案3のとおりショートカットとして最上位に置く(実質的には自分のuserIdを
// そのまま値として使うため、特別なトークンは導入しない)。「担当未定」は
// 実在するuserIdと衝突しない固定値で表す。値の意味は完了記録の実施者
// (performed_by_user_id、YDR-020)とは異なり、混同しないラベルを使う。
const UNASSIGNED_FILTER_VALUE = "unassigned";

function parseAssigneeParam(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

// household_idで絞り込む取得関数(src/lib/d1/home.ts)がすでに家庭間分離を
// 保証しているため、他家庭のuserIdや不正な値を渡しても単に0件になるだけで
// 安全である。ここでは値をそのままクエリー条件へ渡す。
function toAssigneeFilter(assigneeParam: string | undefined): AssigneeFilter | undefined {
  if (assigneeParam === undefined) return undefined;
  if (assigneeParam === UNASSIGNED_FILTER_VALUE) return { type: "unassigned" };
  return { type: "member", userId: assigneeParam };
}

function buildTodoListHref(status: TodoStatusFilter, assigneeParam: string | undefined): string {
  const params = new URLSearchParams();
  if (status === "completed") params.set("status", "completed");
  if (assigneeParam !== undefined) params.set("assignee", assigneeParam);
  const query = params.toString();
  return query === "" ? "/todos" : `/todos?${query}`;
}

// 現在適用中の担当条件を、家族に見せる言葉で説明する。自分自身は個人名では
// なく「自分」と表す(Issue #223の期待する挙動に合わせる)。他家庭の値や
// 存在しないuserIdなど解決できない値は、条件不明として説明を出さない
// (結果は0件になるため、誤って「全員」を選んでいるように見せない)。
function describeAssigneeFilter(
  assigneeParam: string | undefined,
  currentUserId: string,
  members: HouseholdMemberOption[],
): string | null {
  if (assigneeParam === undefined) return null;
  if (assigneeParam === UNASSIGNED_FILTER_VALUE) return "担当未定";
  if (assigneeParam === currentUserId) return "自分";
  return members.find((member) => member.userId === assigneeParam)?.nickname ?? null;
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
  status,
}: {
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
    </header>
  );
}

// Issue #222: 「未完了」「実施済み」はstatusクエリーパラメーターで切り替える
// (このファイル冒頭のTodoStatusFilterのコメント参照)。切り替えても、
// Issue #223の担当条件は失われない(assigneeParamをhrefへ引き継ぐ)。
function TodoStatusSwitch({
  assigneeParam,
  status,
}: {
  assigneeParam: string | undefined;
  status: TodoStatusFilter;
}) {
  return (
    <nav aria-label="Todoの状態を切り替え" className="status-switch">
      <Link
        aria-current={status === "pending" ? "page" : undefined}
        className="status-switch-option"
        href={buildTodoListHref("pending", assigneeParam)}
      >
        未完了
      </Link>
      <Link
        aria-current={status === "completed" ? "page" : undefined}
        className="status-switch-option"
        href={buildTodoListHref("completed", assigneeParam)}
      >
        実施済み
      </Link>
    </nav>
  );
}

// Issue #223: 担当予定者で絞り込む。「全員」で解除できる。状態タブ
// (TodoStatusSwitch)を切り替えても、この条件は失われない。
function AssigneeFilterNav({
  assigneeParam,
  currentUserId,
  members,
  status,
}: {
  assigneeParam: string | undefined;
  currentUserId: string;
  members: HouseholdMemberOption[];
  status: TodoStatusFilter;
}) {
  const otherMembers = members.filter((member) => member.userId !== currentUserId);
  return (
    <nav aria-label="担当予定者で絞り込み" className="assignee-filter">
      <Link
        aria-current={assigneeParam === undefined ? "page" : undefined}
        className="assignee-filter-option"
        href={buildTodoListHref(status, undefined)}
      >
        全員
      </Link>
      <Link
        aria-current={assigneeParam === currentUserId ? "page" : undefined}
        className="assignee-filter-option"
        href={buildTodoListHref(status, currentUserId)}
      >
        自分
      </Link>
      {otherMembers.map((member) => (
        <Link
          aria-current={assigneeParam === member.userId ? "page" : undefined}
          className="assignee-filter-option"
          href={buildTodoListHref(status, member.userId)}
          key={member.userId}
        >
          {member.nickname}
        </Link>
      ))}
      <Link
        aria-current={assigneeParam === UNASSIGNED_FILTER_VALUE ? "page" : undefined}
        className="assignee-filter-option"
        href={buildTodoListHref(status, UNASSIGNED_FILTER_VALUE)}
      >
        担当未定
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
        には、いま残っているTodoがありません。新しいTodoは右下の⊕から追加できます。
      </p>
    </section>
  );
}

function TodoListLoadMore({
  assigneeParam,
  nextLimit,
}: {
  assigneeParam: string | undefined;
  nextLimit: number;
}) {
  const params = new URLSearchParams({ limit: String(nextLimit), status: "completed" });
  if (assigneeParam !== undefined) params.set("assignee", assigneeParam);
  return (
    <Link className="ledger-primary-link todo-list-load-more" href={`/todos?${params.toString()}`}>
      もっと見る
    </Link>
  );
}

function TodoListSection({
  actorName,
  assigneeParam,
  currentUserId,
  items,
  members,
  nextLimit,
  showLoadMore,
  status,
}: {
  actorName: string;
  assigneeParam: string | undefined;
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
  // Issue #223: 適用中の担当条件が分かるよう、見出しの説明に添える
  // (解除は絞り込みナビの「全員」から行う)。
  const assigneeLabel = describeAssigneeFilter(assigneeParam, currentUserId, members);
  return (
    <section aria-labelledby="todo-list-title" className="home-section">
      <div className="section-heading">
        <div>
          <h2 id="todo-list-title">{heading}</h2>
          <p>
            {description}
            {assigneeLabel === null ? "" : ` ・ 担当予定者: ${assigneeLabel}`}
          </p>
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

      {showLoadMore ? <TodoListLoadMore assigneeParam={assigneeParam} nextLimit={nextLimit} /> : null}
    </section>
  );
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
  showLoadMore?: boolean;
  status?: TodoStatusFilter;
};

function TodoListBody({
  actorName,
  assigneeParam,
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
      assigneeParam={assigneeParam}
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
      <TodoListHero status={status} />
      {rest.household === null ? null : (
        <>
          <TodoStatusSwitch assigneeParam={rest.assigneeParam} status={status} />
          <AssigneeFilterNav
            assigneeParam={rest.assigneeParam}
            currentUserId={rest.currentUserId}
            members={rest.members}
            status={status}
          />
        </>
      )}

      <TodoListBody
        {...rest}
        nextLimit={nextLimit}
        showLoadMore={showLoadMore}
        status={status}
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
): Promise<TodoListContentProps> {
  const [actorName, completionRows, members] = await Promise.all([
    loadActorName(db, session, user.id, FALLBACK_SELF_ACTOR_NAME),
    // 現在の家庭の、有効な完了(訂正済みなら訂正後、YDR-026)だけを返す
    // (src/lib/d1/home.ts)。他家庭のTodoはこの取得経路に載らない。
    // Issue #223: assigneeParamは担当予定者(assignee_user_id)による絞り込み
    // であり、この完了を実際に行った実施者とは別の条件として扱う。
    listRecentActiveCompletions(db, session, limit, toAssigneeFilter(assigneeParam)),
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
): Promise<TodoListContentProps> {
  const [actorName, occurrenceRows, members] = await Promise.all([
    loadActorName(db, session, user.id, FALLBACK_SELF_ACTOR_NAME),
    // 現在の家庭のpending Occurrenceだけを返す(src/lib/d1/home.ts)。他家庭の
    // Todoはこの取得経路に載らない。Issue #223: assigneeParamは担当予定者
    // (assignee_user_id)による絞り込み。
    listPendingOccurrences(db, session, toAssigneeFilter(assigneeParam)),
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
      assigneeParam,
    )
    : await loadPendingTodoListContent(db, session, user, household, nowIso, assigneeParam);

  return <TodoListContent {...content} />;
}
