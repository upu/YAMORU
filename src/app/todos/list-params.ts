// Todo一覧のURL状態(状態・担当予定者・検索語・表示形式)の読み取りと組み立て。
// 画面の描画はlist-toolbar.tsx・list-sections.tsx・page.tsxが担い、ここは
// クエリーパラメーターと表示用ラベルの変換だけを持つ(#280)。

import type { AssigneeFilter } from "../../lib/d1/home";
import type { HouseholdMemberOption } from "../../lib/d1/profiles";

// Issue #222: 未完了(既定)と実施済みをstatusクエリーパラメーターで切り替える
// (案1)。タブごとに別ルートを持つ案2や、同一画面での追加読み込みだけで
// 済ませる案3より、既存のTodo一覧の構造(household所属チェック→一覧取得)を
// そのまま流用でき、URLだけで状態を復元できる点を優先した。
export type TodoStatusFilter = "completed" | "pending";

// 実施済みは件数が増え続けるため、初期表示件数を絞り、「もっと見る」で
// COMPLETED_PAGE_SIZE件ずつ増やす。上限はlistRecentActiveCompletions自体が
// 持つ100件のクランプに委ね、それ以上は「もっと見る」を出さない
// (履歴全体の閲覧は本Issueの対象外)。
export const COMPLETED_PAGE_SIZE = 20;

export const COMPLETED_LIMIT_MAX = 100;

export function parseStatusFilter(value: string | string[] | undefined): TodoStatusFilter {
  return value === "completed" ? "completed" : "pending";
}

export function parseCompletedLimit(value: string | string[] | undefined): number {
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
export const UNASSIGNED_FILTER_VALUE = "unassigned";

export function parseAssigneeParam(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

// household_idで絞り込む取得関数(src/lib/d1/home.ts)がすでに家庭間分離を
// 保証しているため、他家庭のuserIdや不正な値を渡しても単に0件になるだけで
// 安全である。ここでは値をそのままクエリー条件へ渡す。
export function toAssigneeFilter(assigneeParam: string | undefined): AssigneeFilter | undefined {
  if (assigneeParam === undefined) return undefined;
  if (assigneeParam === UNASSIGNED_FILTER_VALUE) return { type: "unassigned" };
  return { type: "member", userId: assigneeParam };
}

// Issue #225: Todo一覧のフリーワード検索。qクエリーパラメーターをサーバー側の
// 取得条件へ反映する案1を採用する(issue本文の設計メモ)。件数がまだ少なく
// 専用インデックスを要しない現段階では、クライアント側絞り込み(案2)より
// 状態・担当条件と同じ仕組みで組み合わせられる利点を優先し、将来件数が
// 増えた場合にSQLite FTS(案3)へ移行する余地は残す。前後の空白は取り除き、
// 空文字ならクエリーからも省く(絞り込みなしとして扱う、受け入れ基準)。
export function parseSearchParam(value: string | string[] | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

// Issue #224: カード表示とコンパクトなリスト表示の切り替え。案1(viewクエリー
// パラメーターをサーバー側の描画へ反映)を採用する(issue本文の設計メモ)。
// 状態(#222)・担当予定者(#223)・検索語(#225)と同じ「URLだけで状態を復元
// できる」仕組みで統一でき、共有・再読み込みにも強い。案2(localStorage)は
// このページがサーバーコンポーネントのみで完結する構成にクライアント状態を
// 持ち込む必要があり、初回描画とその後の食い違い(ハイドレーション)を
// 避けにくい。案3(プロフィール設定)はDB変更を要し、他の絞り込みと保持範囲が
// そろわない。既定はカード表示(現在の操作性を維持する、受け入れ基準)。
export type TodoListViewMode = "card" | "list";

export function parseViewParam(value: string | string[] | undefined): TodoListViewMode {
  return value === "list" ? "list" : "card";
}

export type TodoListLinkParams = {
  assigneeParam: string | undefined;
  searchParam: string | undefined;
  status: TodoStatusFilter;
  viewParam: TodoListViewMode;
};

export function buildTodoListHref(params: TodoListLinkParams): string {
  const searchParams = new URLSearchParams();
  if (params.status === "completed") searchParams.set("status", "completed");
  if (params.assigneeParam !== undefined) searchParams.set("assignee", params.assigneeParam);
  if (params.searchParam !== undefined) searchParams.set("q", params.searchParam);
  if (params.viewParam === "list") searchParams.set("view", "list");
  const query = searchParams.toString();
  return query === "" ? "/todos" : `/todos?${query}`;
}

// 現在適用中の担当条件を、家族に見せる言葉で説明する。自分自身は個人名では
// なく「自分」と表す(Issue #223の期待する挙動に合わせる)。他家庭の値や
// 存在しないuserIdなど解決できない値は、条件不明として説明を出さない
// (結果は0件になるため、誤って「全員」を選んでいるように見せない)。
export function describeAssigneeFilter(
  assigneeParam: string | undefined,
  currentUserId: string,
  members: HouseholdMemberOption[],
): string | null {
  if (assigneeParam === undefined) return null;
  if (assigneeParam === UNASSIGNED_FILTER_VALUE) return "担当未定";
  if (assigneeParam === currentUserId) return "自分";
  return members.find((member) => member.userId === assigneeParam)?.nickname ?? null;
}
