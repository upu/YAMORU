import { type StoredCalendarSpec } from "../calendar";

// Issue #102 / YDR-040: 定例日の候補指定の正本はtask_rule_schedulesであり、
// task_rulesのschedule_*列は0021の間だけ残す旧Worker互換の値である。
// 複数の候補指定を持つルールでは、暦上いちばん早い1件を入れる(CHECK制約が
// 単一の値を求めるため)。旧Workerが複数候補ルールの次回を誤って作ることは
// 0021のロールアウトガードが防ぐ。
//
// 登録(creation.ts)と編集(recurring-edit.ts)で同じ値になるよう、どちらも
// 並べ替え済みの候補指定から作る。値が食い違うと、内容が同じ編集でも
// rule_snapshotの比較が一致せず、変更履歴が作られてしまう。
// 列の並びはINSERT / UPDATE文のプレースホルダと同じ順序で返す。
export function legacyCalendarColumnValues(
  specs: readonly StoredCalendarSpec[] | undefined,
): (number | string | null)[] {
  const first = specs?.at(0);
  if (first === undefined) return [null, null, null, null, null, 0];
  return [
    first.kind,
    first.dayOfWeek === 0 ? null : first.dayOfWeek,
    first.dayOfMonth === 0 ? null : first.dayOfMonth,
    first.weekOfMonth === 0 ? null : first.weekOfMonth,
    first.month === 0 ? null : first.month,
    first.monthEnd ? 1 : 0,
  ];
}
