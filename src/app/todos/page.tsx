import Link from "next/link";

import { requireUser } from "../../lib/auth/current-user";
import { getD1Context } from "../../lib/d1/context";
import {
  listPendingOccurrences,
  type PendingOccurrenceRow,
} from "../../lib/d1/home";
import { loadAccountState } from "../../lib/d1/households";
import {
  FALLBACK_SELF_ACTOR_NAME,
  type HouseholdMemberOption,
  loadActorName,
  loadHouseholdMembers,
} from "../../lib/d1/profiles";
import { buildPendingTodoEntries } from "../pending-todo";
import { TodoCard, type TodoCardItem } from "../todo-card";

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

function TodoListHero({ hasHousehold }: { hasHousehold: boolean }) {
  return (
    <header className="detail-hero">
      <p className="detail-kicker">ALL TODOS</p>
      <h1>Todo一覧</h1>
      <p>未完了のTodoをまとめて確認できます。</p>
      {hasHousehold ? (
        <Link className="ledger-primary-link" href="/todos/new">
          Todoを追加
        </Link>
      ) : null}
    </header>
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

function TodoListEmptyState({ householdName }: { householdName: string }) {
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

function TodoListSection({
  actorName,
  currentUserId,
  items,
  members,
}: {
  actorName: string;
  currentUserId: string;
  items: TodoCardItem[];
  members: HouseholdMemberOption[];
}) {
  return (
    <section aria-labelledby="todo-list-title" className="home-section">
      <div className="section-heading">
        <div>
          <h2 id="todo-list-title">未完了のTodo</h2>
          <p>予定日が早いものから並び、予定日未定は最後に並びます</p>
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
            // (#201、#202)。ホームのカードでは提供しない(#204)。
            canChangeSchedule
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

type TodoListContentProps = {
  actorName: string;
  currentUserId: string;
  household: TodoListHouseholdSummary | null;
  items: TodoCardItem[];
  members: HouseholdMemberOption[];
};

function TodoListBody({
  actorName,
  currentUserId,
  household,
  items,
  members,
}: TodoListContentProps) {
  if (household === null) return <HouseholdRequiredNotice />;
  if (items.length === 0) {
    return <TodoListEmptyState householdName={household.name} />;
  }
  return (
    <TodoListSection
      actorName={actorName}
      currentUserId={currentUserId}
      items={items}
      members={members}
    />
  );
}

export function TodoListContent(props: TodoListContentProps) {
  return (
    <main className="detail-page todo-list-page">
      <TodoListHero hasHousehold={props.household !== null} />

      <TodoListBody {...props} />
    </main>
  );
}

export default async function TodoListPage() {
  const user = await requireUser();
  const { db, session } = await getD1Context(user);
  const nowIso = new Date().toISOString();

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
      />
    );
  }

  const [actorName, occurrenceRows, members] = await Promise.all([
    loadActorName(db, session, user.id, FALLBACK_SELF_ACTOR_NAME),
    // 現在の家庭のpending Occurrenceだけを返す(src/lib/d1/home.ts)。他家庭の
    // Todoはこの取得経路に載らない。
    listPendingOccurrences(db, session),
    // Issue #72: 担当者選択の候補は同じ家庭のメンバーに限る。
    loadHouseholdMembers(db, session),
  ]);

  return (
    <TodoListContent
      actorName={actorName}
      currentUserId={user.id}
      household={household}
      items={buildTodoListItems(occurrenceRows, nowIso)}
      members={members}
    />
  );
}
