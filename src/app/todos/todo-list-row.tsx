import Link from "next/link";

import { FALLBACK_OTHER_MEMBER_NAME, type HouseholdMemberOption } from "../../lib/d1/profiles";
import { TONE_LABELS, type TodoCardItem } from "../todo-card";

// Issue #224: コンパクトなリスト表示の操作範囲。カードと同じ操作(担当変更・
// 完了記録・予定日変更)をそのまま並べると、行が狭いぶん誤タップが起きやすい
// (issue本文の「誤操作と一覧性のトレードオフ」)。そのため行全体を単一の
// Todo詳細への導線にし、変更操作は詳細画面へ集約する。カード表示(todo-card.tsx)
// は現在の操作性のまま維持する(受け入れ基準)。

// pending Todoの担当予定者を家族に見せる言葉にする。TodoListSectionの
// describeAssigneeFilter(絞り込み条件の説明)とは異なり、こちらは行ごとの
// 実際の値を説明する。既存メンバーで解決できない場合は、他の一覧行と同じ
// フォールバック名(FALLBACK_OTHER_MEMBER_NAME)を使う。
function describeItemAssignee(
  assigneeUserId: string | null,
  currentUserId: string,
  members: HouseholdMemberOption[],
): string {
  if (assigneeUserId === null) return "担当未定";
  if (assigneeUserId === currentUserId) return "自分";
  return members.find((member) => member.userId === assigneeUserId)?.nickname
    ?? FALLBACK_OTHER_MEMBER_NAME;
}

function TodoListRowBody({
  assigneeLabel,
  item,
}: {
  assigneeLabel: string | null;
  item: TodoCardItem;
}) {
  return (
    <span className="todo-list-row-body">
      <span className="todo-list-row-title-line">
        <span className="todo-list-row-title">{item.title}</span>
        <span className={`tone-label tone-${item.tone}`}>{item.badge ?? TONE_LABELS[item.tone]}</span>
      </span>
      <span className="todo-list-row-meta">
        {item.meta}
        {assigneeLabel === null ? "" : ` ・ 担当: ${assigneeLabel}`}
      </span>
    </span>
  );
}

// item.assigneeUserIdはpending Todoにだけ設定する(TodoCardItemの定義参照)。
// 実施済みは「誰が実施したか」をすでにitem.metaへ含んでいる(buildRecentItems、
// YDR-020の実施者)ため、ここでは担当予定者ラベルを重ねて出さない。
export function TodoListRow({
  currentUserId,
  item,
  members,
}: {
  currentUserId: string;
  item: TodoCardItem;
  members: HouseholdMemberOption[];
}) {
  const assigneeLabel = item.assigneeUserId === undefined
    ? null
    : describeItemAssignee(item.assigneeUserId, currentUserId, members);
  const href = item.todoHref ?? item.detailHref;
  return (
    <li className="todo-list-row">
      {href === undefined ? (
        <span className="todo-list-row-link">
          <span aria-hidden="true" className={`status-mark status-${item.tone}`} />
          <TodoListRowBody assigneeLabel={assigneeLabel} item={item} />
        </span>
      ) : (
        <Link className="todo-list-row-link" href={href}>
          <span aria-hidden="true" className={`status-mark status-${item.tone}`} />
          <TodoListRowBody assigneeLabel={assigneeLabel} item={item} />
        </Link>
      )}
    </li>
  );
}
