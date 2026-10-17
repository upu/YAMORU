import type { PendingOccurrenceRow } from "../../../lib/d1/home";
import {
  MAINTENANCE_DISPLAY_COPY,
  STRICT_DISPLAY_COPY,
  toDeadlineKind,
  toRecurrenceBasis,
  type RecurrenceBasis,
  type StrictDisplayState,
} from "./task-schedule";
import type { TodoCardItem } from "./types";
import {
  formatTokyoMonthDay,
  getMaintenanceDisplayStateFromIso,
  getStrictDisplayStateFromIso,
  getTokyoDayDistance,
  tokyoDateToUtcIso,
} from "./time-zone";

// 未完了Todoの分類はこの一箇所で行う。ホームは「いま対応すること」だけを
// 区分ごとに表示し、Todo一覧(/todos)は同じ分類結果を日付順に並べて
// すべて表示する(Issue #201)。
export type PendingTodoCategory =
  // 期限切れ
  | "overdue"
  // 今日が予定日
  | "today"
  // これから7日以内の予定
  | "upcoming"
  // 7日より先の予定。ホームには出さない。
  | "later"
  // 完了日基準Todoの推奨期間内・上限超過(YDR-034)
  | "reminder"
  // 完了日基準Todoの推奨期間前。対応開始前のためホームには出さない(YDR-034)。
  | "before-window"
  // 予定日未定。一回限りTodo(YDR-030)と「必要になったら繰り返す」Todo
  // (YDR-046)の両方がここに入る。どちらもホームには出さない。
  | "undated";

export type PendingTodoEntry = {
  hardDeadlineOverdue?: boolean;
  category: PendingTodoCategory;
  item: TodoCardItem;
  // 日付順に並べるための期限。予定日未定はnull。
  sortKey: string | null;
};

// ホームの「近日」に含める日数。これより先の予定はTodo一覧で確認する。
export const HOME_UPCOMING_DAYS = 7;

// ホームに載せる区分。ここに含まれない区分(later・before-window・undated)は
// Todo一覧で確認する(Issue #201)。ホームの節のidと区分名をそろえてあるため、
// ホーム側(page.tsx)はこの判定だけで振り分けられる。登録直後のフィードバック
// (Issue #286)も、同じ判定で「まだホームに出ないTodoか」を決める。
export type HomePendingCategory = "overdue" | "reminder" | "today" | "upcoming";

export function isHomePendingCategory(
  category: PendingTodoCategory,
): category is HomePendingCategory {
  return category === "overdue" || category === "reminder" ||
    category === "today" || category === "upcoming";
}

function pendingTodoItemBase(row: PendingOccurrenceRow): Pick<
  TodoCardItem,
  | "assigneeUserId"
  | "detail"
  | "detailHref"
  | "id"
  | "managedItemId"
  | "occurrenceId"
  | "title"
  | "todoHref"
> {
  const managedItem = row.task_rules.managed_items;
  return {
    assigneeUserId: row.assignee_user_id,
    detail: managedItem?.name ?? "管理対象なし",
    ...(managedItem === null ? {} : { detailHref: `/managed-items/${managedItem.id}` }),
    id: row.id,
    managedItemId: managedItem?.id ?? null,
    occurrenceId: row.id,
    title: row.task_rules.title,
    // ホームとTodo一覧のどちらからでも、同じTodo詳細へ移動する(Issue #203)。
    todoHref: `/todos/${row.id}`,
  };
}

// ホーム・Todo一覧のメタ文で使う繰り返し方の呼び名。登録フォームの選択肢と
// 同じ言い回しにそろえる(Issue #99 / YDR-037の8)。完了日基準は推奨期間の
// 文言(buildMaintenanceEntry)を使うためここには現れないが、
// RecurrenceBasisを網羅する型にして方式追加時の記入漏れを防ぐ。
const STRICT_RECURRENCE_LABELS: Record<RecurrenceBasis, string> = {
  calendar: "曜日・日付で繰り返す",
  completion: "完了した日から繰り返す",
  interval: "一定の間隔で繰り返す",
  manual: "必要になったら繰り返す",
  once: "繰り返しなし",
};

// Issue #325 / YDR-046: 予定日未定Todoには「一回限りで日付がまだ決まって
// いない」ものと「必要になったら繰り返す」ものがある。前者は日付が決まれば
// 期限のあるTodoへ戻るが、後者は日付を持たないことが方式そのものなので、
// バッジと補足を分けて区別できるようにする。
const UNDATED_BADGES: Record<"manual" | "once", string> = {
  manual: "必要時",
  once: "未定",
};

function buildUndatedEntry(
  row: PendingOccurrenceRow,
  recurrenceBasis: RecurrenceBasis,
): PendingTodoEntry {
  const deadlineKind = toDeadlineKind(row.task_rules.deadline_kind);
  if (
    (recurrenceBasis !== "once" && recurrenceBasis !== "manual") ||
    deadlineKind !== "strict"
  ) {
    throw new Error("予定日未定を利用できないTodoです。");
  }
  return {
    category: "undated",
    item: {
      ...pendingTodoItemBase(row),
      badge: UNDATED_BADGES[recurrenceBasis],
      // Issue #243: リスト表示のバッジがすでに「未定」「必要時」を示すため、
      // listScheduleは日付を持たず重複させない。
      listSchedule: { kind: "undated" },
      // Issue #267: 一回限りTodoではカード表示のバッジ(「未定」)で予定日未定
      // であることが伝わるため、「予定日: 未定 ・ 繰り返しなし」の文章は
      // 重ねて出さない(TodoCardは空文字のmetaを描画しない)。「必要になったら
      // 繰り返す」はバッジだけでは繰り返すことが伝わらないため、繰り返し方
      // だけを添える。
      meta: recurrenceBasis === "manual" ? STRICT_RECURRENCE_LABELS.manual : "",
      tone: "upcoming",
    },
    sortKey: null,
  };
}

// Issue #394: 推奨期間の開始日と上限日を、状態の言い回しを付けずに示す。
// 現在どの状態かはバッジ(推奨期間/そろそろ/推奨期間超過)が伝える。
function describeMaintenanceWindowDates(
  window: { dueAt: string; scheduledFor: string },
): string {
  return `${formatTokyoMonthDay(window.scheduledFor)}〜${formatTokyoMonthDay(window.dueAt)}`;
}

function buildMaintenanceEntry(
  row: PendingOccurrenceRow,
  scheduledFor: string,
  dueAt: string,
  nowIso: string,
): PendingTodoEntry {
  if (toDeadlineKind(row.task_rules.deadline_kind) !== "maintenance") {
    throw new Error("完了日基準Todoの期限方式が不正です。");
  }

  const window = { dueAt, scheduledFor };
  const state = getMaintenanceDisplayStateFromIso(window, nowIso);
  const copy = MAINTENANCE_DISPLAY_COPY[state];
  return {
    category: state === "before-window" ? "before-window" : "reminder",
    item: {
      ...pendingTodoItemBase(row),
      badge: copy.badge,
      // Issue #348: 現在状態はバッジとトーンが伝えるため、リストの日付は
      // 推奨期間の開始日と上限日を常に同じ形で示す。
      listSchedule: { fromIso: scheduledFor, kind: "range", untilIso: dueAt },
      // Issue #394: カードでも同じ考え方にそろえる。「推奨期間です」「上限を
      // 過ぎました」はバッジ(推奨期間/そろそろ/推奨期間超過)と同じ意味を
      // 繰り返すため、日付だけを示す。
      meta: describeMaintenanceWindowDates(window),
      tone: copy.tone,
    },
    sortKey: dueAt,
  };
}

function toStrictCategory(
  state: StrictDisplayState,
  dueAt: string,
  nowIso: string,
): PendingTodoCategory {
  if (state === "overdue") return "overdue";
  if (state === "due-today") return "today";
  return getTokyoDayDistance(nowIso, dueAt) > HOME_UPCOMING_DAYS ? "later" : "upcoming";
}

function buildStrictEntry(
  row: PendingOccurrenceRow,
  recurrenceBasis: RecurrenceBasis,
  scheduledFor: string,
  dueAt: string,
  nowIso: string,
): PendingTodoEntry {
  if (toDeadlineKind(row.task_rules.deadline_kind) !== "strict") {
    throw new Error("厳密な期限Todoの期限方式が不正です。");
  }

  const state = getStrictDisplayStateFromIso(dueAt, nowIso);
  return {
    category: toStrictCategory(state, dueAt, nowIso),
    item: {
      ...pendingTodoItemBase(row),
      // Issue #243: 期日だけを短く示す。期限切れ・今日・予定の別はバッジが
      // 伝えるため、リスト表示では繰り返し方式(#227)を省略する。
      listSchedule: { iso: dueAt, kind: "due" },
      // Issue #394: カードでも、期日の状態はバッジ(期限切れ/今日/予定)に
      // 任せ、本文では日付と繰り返し方だけを示す。「今日（9月10日）の予定です」
      // のように、バッジと同じ語を本文で繰り返さない。
      meta: `${formatTokyoMonthDay(dueAt)} ・ ${STRICT_RECURRENCE_LABELS[recurrenceBasis]}`,
      tone: STRICT_DISPLAY_COPY[state].tone,
    },
    sortKey: dueAt,
  };
}

function buildPendingTodoEntry(
  row: PendingOccurrenceRow,
  nowIso: string,
): PendingTodoEntry {
  const scheduledFor = row.scheduled_for;
  const dueAt = row.due_at;
  if ((scheduledFor === null) !== (dueAt === null)) {
    throw new Error("Todoの予定日と期限の組み合わせが不正です。");
  }

  const recurrenceBasis = toRecurrenceBasis(row.task_rules.recurrence_basis);
  if (scheduledFor === null || dueAt === null) {
    return buildUndatedEntry(row, recurrenceBasis);
  }
  if (recurrenceBasis === "completion") {
    return buildMaintenanceEntry(row, scheduledFor, dueAt, nowIso);
  }
  return buildStrictEntry(row, recurrenceBasis, scheduledFor, dueAt, nowIso);
}

// 期限の昇順で並べる。予定日未定(sortKey=null)は日付比較に載せられないため、
// 呼び出し側が末尾へ置く前提で、ここでは元の順序を保ったまま先頭にまとめる。
export function buildPendingTodoEntries(
  rows: PendingOccurrenceRow[],
  nowIso: string,
): PendingTodoEntry[] {
  return rows.map((row) => withHardDeadline(buildPendingTodoEntry(row, nowIso), row.must_complete_by, nowIso))
    .sort((left, right) => {
      const priority = Number(right.hardDeadlineOverdue === true) - Number(left.hardDeadlineOverdue === true);
      return priority || (left.sortKey ?? "").localeCompare(right.sortKey ?? "");
    });
}

function withHardDeadline(entry: PendingTodoEntry, date: string | null | undefined, nowIso: string): PendingTodoEntry {
  if (!date) return entry;
  const iso = tokyoDateToUtcIso(date);
  if (!iso) throw new Error("必達日が不正です。");
  const distance = getTokyoDayDistance(nowIso, iso);
  const previousBadge = entry.item.badge;
  const previousScheduleState = describeScheduleState(entry);
  entry.item.mustCompleteBy = date;
  entry.item.hardDeadlineToday = distance === 0;
  entry.item.meta = [entry.item.meta, `必達日: ${formatTokyoMonthDay(iso)}`].filter(Boolean).join(" ・ ");
  if (distance <= 0) applyReachedHardDeadline(entry, distance, iso);
  else promoteUpcomingDeadline(entry, distance, iso);
  if (entry.item.badge !== previousBadge) {
    entry.item.scheduleState = previousScheduleState;
    entry.item.meta = `${previousScheduleState} ・ ${entry.item.meta}`;
  }
  return entry;
}

function describeScheduleState(entry: PendingTodoEntry): string {
  if (entry.item.badge) return entry.item.badge;
  if (entry.category === "overdue") return STRICT_DISPLAY_COPY.overdue.badge;
  if (entry.category === "today") return STRICT_DISPLAY_COPY["due-today"].badge;
  return STRICT_DISPLAY_COPY.upcoming.badge;
}

function applyReachedHardDeadline(entry: PendingTodoEntry, distance: number, iso: string) {
  // 必達日が今日でも、予定日や推奨期間がすでに過ぎた警告を弱めない。
  if (distance === 0 && (entry.category === "overdue" || entry.item.tone === "caution")) {
    entry.item.meta += "（今日）";
    return;
  }
  entry.hardDeadlineOverdue = distance < 0;
  entry.category = distance < 0 ? "overdue" : "today";
  entry.item.badge = distance < 0 ? "必達日超過" : "今日が必達日";
  entry.item.tone = distance < 0 ? "urgent" : "today";
  entry.sortKey = iso;
}

function promoteUpcomingDeadline(entry: PendingTodoEntry, distance: number, iso: string) {
  if (isHomePendingCategory(entry.category)) return;
  if (distance <= HOME_UPCOMING_DAYS) {
    entry.category = "upcoming";
    entry.item.badge = "必達日が近い";
  } else if (entry.category === "undated") entry.category = "later";
  if (entry.sortKey === null || iso < entry.sortKey) entry.sortKey = iso;
}
