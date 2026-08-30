// Todo一覧の本体(#280)。一覧そのもの、0件時の案内、実施済みの追加読み込み、
// 家庭未所属時の案内。カード表示とコンパクトなリスト表示(#224)の出し分けも
// ここで行う。

import Link from "next/link";

import type { HouseholdMemberOption } from "../../lib/d1/profiles";
import { TodoCard, type TodoCardItem } from "../todo-card";
import {
  describeAssigneeFilter,
  type TodoListViewMode,
  type TodoStatusFilter,
} from "./list-params";
import { TodoListRow } from "./todo-list-row";

export function HouseholdRequiredNotice() {
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

// Issue #225: 検索語が0件になったときは、家庭にTodoがないのか検索語に
// 一致しないだけなのかを区別できる案内にする(受け入れ基準の「0件時の
// 案内」)。
export function TodoListEmptyState({
  householdName,
  searchParam,
  status,
}: {
  householdName: string;
  searchParam: string | undefined;
  status: TodoStatusFilter;
}) {
  if (searchParam !== undefined) {
    return (
      <section aria-labelledby="todo-list-empty-title" className="detail-card">
        <h2 id="todo-list-empty-title">
          「
          {searchParam}
          」に一致するTodoはありません
        </h2>
        <p>検索語を変えるか、絞り込みを解除してお試しください。</p>
      </section>
    );
  }
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
        には、いま残っているTodoがありません。新しいTodoは右下の「＋」ボタンから追加できます。
      </p>
    </section>
  );
}

export function TodoListLoadMore({
  assigneeParam,
  nextLimit,
  searchParam,
  viewParam,
}: {
  assigneeParam: string | undefined;
  nextLimit: number;
  searchParam: string | undefined;
  viewParam: TodoListViewMode;
}) {
  const params = new URLSearchParams({ limit: String(nextLimit), status: "completed" });
  if (assigneeParam !== undefined) params.set("assignee", assigneeParam);
  if (searchParam !== undefined) params.set("q", searchParam);
  if (viewParam === "list") params.set("view", "list");
  return (
    <Link className="ledger-primary-link todo-list-load-more" href={`/todos?${params.toString()}`}>
      もっと見る
    </Link>
  );
}

// Issue #223/#225: 適用中の担当条件・検索語が分かるよう、見出しの説明に
// 添える(解除はそれぞれ絞り込みナビの「全員」・検索欄を空にして再送信)。
export function TodoListSectionDescription({
  assigneeLabel,
  searchParam,
  status,
}: {
  assigneeLabel: string | null;
  searchParam: string | undefined;
  status: TodoStatusFilter;
}) {
  const base = status === "completed"
    ? "実施日が新しいものから並びます"
    : "予定日が早いものから並び、予定日未定は最後に並びます";
  return (
    <p>
      {base}
      {assigneeLabel === null ? "" : ` ・ 担当予定者: ${assigneeLabel}`}
      {searchParam === undefined ? "" : ` ・ 検索語: 「${searchParam}」`}
    </p>
  );
}

// Issue #224: カード表示(現在の操作性を維持)とコンパクトなリスト表示
// (todo-list-row.tsx、識別情報のみ・行全体がTodo詳細への導線)を切り替える。
export function TodoListItems({
  actorName,
  currentUserId,
  items,
  members,
  viewParam,
}: {
  actorName: string;
  currentUserId: string;
  items: TodoCardItem[];
  members: HouseholdMemberOption[];
  viewParam: TodoListViewMode;
}) {
  if (viewParam === "list") {
    return (
      <ul className="todo-list-rows">
        {items.map((item) => (
          <TodoListRow currentUserId={currentUserId} item={item} key={item.id} members={members} />
        ))}
      </ul>
    );
  }
  return (
    <div className="card-list">
      {items.map((item) => (
        // Issue #267: 予定日未定Todoの再発見はTodo一覧の役目のまま維持するが
        // (#201、#202)、予定日の設定・未定化自体はカードに置かず、Todo名から
        // Todo詳細を開いた編集画面(#203)へ集約する(ホームのカードと同じ
        // 方針、#204)。実施済みではoccurrenceId自体を持たせないため、
        // statusに関わらずここでの操作は出ない(Issue #206)。
        <TodoCard
          actorName={actorName}
          currentUserId={currentUserId}
          item={item}
          key={item.id}
          members={members}
        />
      ))}
    </div>
  );
}

export function TodoListSection({
  actorName,
  assigneeParam,
  currentUserId,
  items,
  members,
  nextLimit,
  searchParam,
  showLoadMore,
  status,
  viewParam,
}: {
  actorName: string;
  assigneeParam: string | undefined;
  currentUserId: string;
  items: TodoCardItem[];
  members: HouseholdMemberOption[];
  nextLimit: number;
  searchParam: string | undefined;
  showLoadMore: boolean;
  status: TodoStatusFilter;
  viewParam: TodoListViewMode;
}) {
  const heading = status === "completed" ? "実施済みのTodo" : "未完了のTodo";
  const assigneeLabel = describeAssigneeFilter(assigneeParam, currentUserId, members);
  return (
    <section aria-labelledby="todo-list-title" className="home-section">
      {/* Issue #241: 状態はツールバーのTodoStatusSwitchで既に分かるため、
      一覧側の状態見出し(未完了のTodo/実施済みのTodo)は画面上に重ねて出さ
      ない。一覧領域の意味は支援技術向けにsr-onlyの見出し(aria-labelledby)
      として残す(Issue #237の台帳一覧と同じ考え方)。 */}
      <h2 className="sr-only" id="todo-list-title">{heading}</h2>
      <div className="section-heading">
        <TodoListSectionDescription assigneeLabel={assigneeLabel} searchParam={searchParam} status={status} />
        <span className="count" aria-label={`${String(items.length)}件`}>
          {items.length}
        </span>
      </div>

      <TodoListItems
        actorName={actorName}
        currentUserId={currentUserId}
        items={items}
        members={members}
        viewParam={viewParam}
      />

      {showLoadMore ? (
        <TodoListLoadMore
          assigneeParam={assigneeParam}
          nextLimit={nextLimit}
          searchParam={searchParam}
          viewParam={viewParam}
        />
      ) : null}
    </section>
  );
}
