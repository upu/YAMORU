// Todo一覧の上部ツールバー(#241)。未完了/実施済みの切り替え、担当予定者の
// 絞り込み、カード/リスト表示の切り替え、虫眼鏡から開くTodo内検索。

import Link from "next/link";

import type { HouseholdMemberOption } from "../../lib/d1/profiles";
import {
  buildTodoListHref,
  describeAssigneeFilter,
  type TodoListViewMode,
  type TodoStatusFilter,
  UNASSIGNED_FILTER_VALUE,
} from "./list-params";

// Issue #222: 「未完了」「実施済み」はstatusクエリーパラメーターで切り替える
// (このファイル冒頭のTodoStatusFilterのコメント参照)。切り替えても、
// Issue #223の担当条件は失われない(assigneeParamをhrefへ引き継ぐ)。
// Issue #241: ツールバー内で使う前提のコンパクトな2択に変更した
// (todo-toolbar-statusで幅・余白だけ上書きする)。
export function TodoStatusSwitch({
  assigneeParam,
  searchParam,
  status,
  viewParam,
}: {
  assigneeParam: string | undefined;
  searchParam: string | undefined;
  status: TodoStatusFilter;
  viewParam: TodoListViewMode;
}) {
  return (
    <nav aria-label="Todoの状態を切り替え" className="status-switch todo-toolbar-status">
      <Link
        aria-current={status === "pending" ? "page" : undefined}
        className="status-switch-option"
        href={buildTodoListHref({ assigneeParam, searchParam, status: "pending", viewParam })}
      >
        未完了
      </Link>
      <Link
        aria-current={status === "completed" ? "page" : undefined}
        className="status-switch-option"
        href={buildTodoListHref({ assigneeParam, searchParam, status: "completed", viewParam })}
      >
        実施済み
      </Link>
    </nav>
  );
}

// Issue #223: 担当予定者で絞り込む。「全員」で解除できる。Issue #266:
// メンバー全員を横並びにせず、現在の条件が閉じた状態でも分かるネイティブな
// disclosureにまとめる。候補はページ遷移のリンクなのでmenuロールは付けず、
// navとしてURL共有・戻る操作・キーボード操作を保つ。
export function AssigneeFilterDisclosure({
  assigneeParam,
  currentUserId,
  members,
  searchParam,
  status,
  viewParam,
}: {
  assigneeParam: string | undefined;
  currentUserId: string;
  members: HouseholdMemberOption[];
  searchParam: string | undefined;
  status: TodoStatusFilter;
  viewParam: TodoListViewMode;
}) {
  const otherMembers = members.filter((member) => member.userId !== currentUserId);
  const selectedLabel = assigneeParam === undefined
    ? "全員"
    : describeAssigneeFilter(assigneeParam, currentUserId, members) ?? "条件不明";

  return (
    <details className="todo-assignee-disclosure">
      <summary className="todo-assignee-toggle">担当: {selectedLabel}</summary>
      <nav aria-label="担当予定者で絞り込み" className="todo-assignee-options">
        <Link
          aria-current={assigneeParam === undefined ? "page" : undefined}
          className="todo-assignee-option"
          href={buildTodoListHref({ assigneeParam: undefined, searchParam, status, viewParam })}
        >
          全員
        </Link>
        <Link
          aria-current={assigneeParam === currentUserId ? "page" : undefined}
          className="todo-assignee-option"
          href={buildTodoListHref({ assigneeParam: currentUserId, searchParam, status, viewParam })}
        >
          自分
        </Link>
        {otherMembers.map((member) => (
          <Link
            aria-current={assigneeParam === member.userId ? "page" : undefined}
            className="todo-assignee-option"
            href={buildTodoListHref({ assigneeParam: member.userId, searchParam, status, viewParam })}
            key={member.userId}
          >
            {member.nickname}
          </Link>
        ))}
        <Link
          aria-current={assigneeParam === UNASSIGNED_FILTER_VALUE ? "page" : undefined}
          className="todo-assignee-option"
          href={buildTodoListHref({
            assigneeParam: UNASSIGNED_FILTER_VALUE, searchParam, status, viewParam,
          })}
        >
          担当未定
        </Link>
      </nav>
    </details>
  );
}

export function CardViewIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <rect height="7" rx="1" width="7" x="3" y="3" />
      <rect height="7" rx="1" width="7" x="14" y="3" />
      <rect height="7" rx="1" width="7" x="3" y="14" />
      <rect height="7" rx="1" width="7" x="14" y="14" />
    </svg>
  );
}

export function ListViewIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <line x1="4" x2="20" y1="6" y2="6" />
      <line x1="4" x2="20" y1="12" y2="12" />
      <line x1="4" x2="20" y1="18" y2="18" />
    </svg>
  );
}

// Issue #224: カード表示とコンパクトなリスト表示を切り替える。Issue #266:
// よく使われるグリッド/リストのSVGアイコンにし、aria-labelで表示形式を
// 読み上げられるようにする。aria-currentで現在の選択も維持する。
export function TodoViewSwitch({
  assigneeParam,
  searchParam,
  status,
  viewParam,
}: {
  assigneeParam: string | undefined;
  searchParam: string | undefined;
  status: TodoStatusFilter;
  viewParam: TodoListViewMode;
}) {
  return (
    <nav aria-label="Todoの表示形式を切り替え" className="todo-view-switch">
      <Link
        aria-label="カード表示"
        aria-current={viewParam === "card" ? "page" : undefined}
        className="todo-view-option"
        href={buildTodoListHref({ assigneeParam, searchParam, status, viewParam: "card" })}
        title="カード表示"
      >
        <CardViewIcon />
      </Link>
      <Link
        aria-label="リスト表示"
        aria-current={viewParam === "list" ? "page" : undefined}
        className="todo-view-option"
        href={buildTodoListHref({ assigneeParam, searchParam, status, viewParam: "list" })}
        title="リスト表示"
      >
        <ListViewIcon />
      </Link>
    </nav>
  );
}

// Issue #241: ツールバーの虫眼鏡アイコン。アクセシブルな名前はsummary側の
// aria-labelで付けるため、アイコン自体はaria-hiddenで読み上げない
// (edit-icon.tsxと同じ考え方)。
export function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" x2="16.65" y1="21" y2="16.65" />
    </svg>
  );
}

// Issue #241: 虫眼鏡から開くTodo内検索。<details>/<summary>のネイティブな
// 開閉状態を使う(案1)。JSを足さずに、押すと展開・キーボードでも開閉でき、
// ブラウザが開閉状態を支援技術へ伝える(HTML-AAMでsummaryの既定ロールは
// button、aria-expandedはdetailsのopen属性を反映する)。自前でrole・
// aria-expandedを付けると、クリックによるネイティブな開閉とサーバーが
// 描画する値がずれうるため付けない。検索語が適用中(searchParam !==
// undefined)は既定で開き、そうでなければ閉じておく(設計メモの案1:
// 押すと開き、検索語がある間は開いた状態を維持する)。
export function TodoSearchDisclosure({
  assigneeParam,
  searchParam,
  status,
  viewParam,
}: {
  assigneeParam: string | undefined;
  searchParam: string | undefined;
  status: TodoStatusFilter;
  viewParam: TodoListViewMode;
}) {
  return (
    <details className="todo-search-disclosure" open={searchParam !== undefined}>
      <summary aria-label="Todoを検索" className="todo-search-toggle">
        <SearchIcon />
      </summary>
      <TodoSearchForm
        assigneeParam={assigneeParam}
        searchParam={searchParam}
        status={status}
        viewParam={viewParam}
      />
    </details>
  );
}

// Issue #225: Todo名のフリーワード検索。ネイティブのGETフォームでサーバー
// 側取得へ反映する(JSを要さず、他の絞り込みと同じくURLだけで状態を復元
// できる)。状態タブ・担当条件はhidden inputで引き継ぎ、送信のたびに失わ
// れないようにする。
export function TodoSearchForm({
  assigneeParam,
  searchParam,
  status,
  viewParam,
}: {
  assigneeParam: string | undefined;
  searchParam: string | undefined;
  status: TodoStatusFilter;
  viewParam: TodoListViewMode;
}) {
  const inputId = "todo-search-q";
  return (
    <form action="/todos" aria-label="Todoをフリーワードで検索" className="auth-form todo-search-form" method="get">
      {status === "completed" ? <input name="status" type="hidden" value="completed" /> : null}
      {assigneeParam === undefined ? null : (
        <input name="assignee" type="hidden" value={assigneeParam} />
      )}
      {/* Issue #224: 検索送信で表示形式(カード/リスト)を失わない。 */}
      {viewParam === "list" ? <input name="view" type="hidden" value="list" /> : null}
      <label className="sr-only" htmlFor={inputId}>
        Todo名で検索
      </label>
      <input
        defaultValue={searchParam ?? ""}
        id={inputId}
        name="q"
        placeholder="Todo名の一部を入力"
        type="search"
      />
      <button type="submit">検索</button>
    </form>
  );
}
