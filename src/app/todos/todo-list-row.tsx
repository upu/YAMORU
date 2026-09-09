import Link from "next/link";

import { FALLBACK_OTHER_MEMBER_NAME, type HouseholdMemberOption } from "../../lib/d1/profiles";
import type { TodoListSchedule } from "../task-schedule";
import { TONE_LABELS, type TodoCardItem } from "../todo-card";
import { formatTokyoShortMonthDay } from "../time-zone";
import styles from "./todo-list.module.css";

// Issue #224: コンパクトなリスト表示の操作範囲。カードと同じ操作(担当変更・
// 完了記録・予定日変更)をそのまま並べると、行が狭いぶん誤タップが起きやすい
// (issue本文の「誤操作と一覧性のトレードオフ」)。そのため行全体を単一の
// Todo詳細への導線にし、変更操作は詳細画面へ集約する。カード表示(todo-card.tsx)
// は現在の操作性のまま維持する(受け入れ基準)。

// Issue #243 / #348: pending Todoの担当予定者を家族に見せる言葉にする。
// 行では「担当:」を視覚上出さないが、予定日未定の「未定」と混ざらないよう、
// YDR-006で定義した「誰でも可」にそろえる。
// TodoListSectionのdescribeAssigneeFilter(絞り込み条件の説明)とは異なり、
// こちらは行ごとの実際の値を説明する。既存メンバーで解決できない場合は、
// 他の一覧行と同じフォールバック名(FALLBACK_OTHER_MEMBER_NAME)を使う。
function describeItemAssignee(
  assigneeUserId: string | null,
  currentUserId: string,
  members: HouseholdMemberOption[],
): string {
  if (assigneeUserId === null) return "誰でも可";
  if (assigneeUserId === currentUserId) return "自分";
  return members.find((member) => member.userId === assigneeUserId)?.nickname
    ?? FALLBACK_OTHER_MEMBER_NAME;
}

// Issue #243: カード向けの表示済み日本語文(item.meta、例:「8月28日から
// 推奨期間です」)を解析せず、pending-todo.tsが組み立てた構造化データ
// (TodoListSchedule)から直接短い表記を作る。バッジ(今日/予定/期限切れ/
// 推奨期間/そろそろ/推奨期間超過/未定)が状態語を示すため、ここでは
// 日付だけを示す。Issue #348: 推奨期間は状態にかかわらず全体を表示する。
function describeListSchedule(schedule: TodoListSchedule | undefined): string {
  if (schedule === undefined || schedule.kind === "undated") return "";
  if (schedule.kind === "range") {
    return `${formatTokyoShortMonthDay(schedule.fromIso)}〜${
      formatTokyoShortMonthDay(schedule.untilIso)
    }`;
  }
  const date = formatTokyoShortMonthDay(schedule.iso);
  return date;
}

// Issue #243: 予定・実施時期・担当予定者を1行分の短い表示へ組み立てる。
// pending TodoはlistSchedule + assigneeLabel、実施済みTodoはperformedAt +
// performedByNameを使う(TodoCardItemの定義参照。両者は排他的)。
function TodoListRowMeta({
  assigneeLabel,
  item,
}: {
  assigneeLabel: string | null;
  item: TodoCardItem;
}) {
  const parts = [
    describeListSchedule(item.listSchedule),
    item.performedAt === undefined ? "" : formatTokyoShortMonthDay(item.performedAt),
    item.performedByName ?? "",
  ].filter((part) => part !== "");
  return (
    <span className={styles.rowMeta}>
      {parts.join(" ・ ")}
      {assigneeLabel === null ? null : (
        <>
          {parts.length > 0 ? " ・ " : ""}
          {/* Issue #243: 見た目の「担当」は省略するが、行全体が単一の
          リンクであるため、支援技術には値の前にラベルを伝える(受け入れ
          基準)。 */}
          <span className="sr-only">担当予定者: </span>
          {assigneeLabel}
        </>
      )}
    </span>
  );
}

function TodoListRowBody({
  assigneeLabel,
  item,
}: {
  assigneeLabel: string | null;
  item: TodoCardItem;
}) {
  return (
    <span className={styles.rowBody}>
      <span className={styles.rowTitle}>{item.title}</span>
      <TodoListRowMeta assigneeLabel={assigneeLabel} item={item} />
      <span className={`tone-label tone-${item.tone}`}>{item.badge ?? TONE_LABELS[item.tone]}</span>
    </span>
  );
}

// item.assigneeUserIdはpending Todoにだけ設定する(TodoCardItemの定義参照)。
// 実施済みは「誰が実施したか」をitem.performedByName(このファイル冒頭の
// TodoListRowMeta参照)ですでに表示するため、ここでは担当予定者ラベルを
// 重ねて出さない。
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
    <li className={styles.row}>
      {href === undefined ? (
        <span className={styles.rowLink}>
          <span aria-hidden="true" className={`status-mark status-${item.tone}`} />
          <TodoListRowBody assigneeLabel={assigneeLabel} item={item} />
        </span>
      ) : (
        <Link className={styles.rowLink} href={href}>
          <span aria-hidden="true" className={`status-mark status-${item.tone}`} />
          <TodoListRowBody assigneeLabel={assigneeLabel} item={item} />
        </Link>
      )}
    </li>
  );
}
