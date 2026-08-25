import type { PendingOccurrenceRow } from "../lib/d1/home";
import {
  MAINTENANCE_DISPLAY_COPY,
  STRICT_DISPLAY_COPY,
  toDeadlineKind,
  toRecurrenceBasis,
  type RecurrenceBasis,
  type StrictDisplayState,
} from "./task-schedule";
import type { TodoCardItem } from "./todo-card";
import {
  describeMaintenanceWindowFromIso,
  describeStrictScheduleFromIso,
  getMaintenanceDisplayStateFromIso,
  getStrictDisplayStateFromIso,
  getTokyoDayDistance,
} from "./time-zone";

// 未完了Todoの分類はこの一箇所で行う。ホームは「いま対応すること」だけを
// 区分ごとに表示し、すべてのTodo一覧(/todos)は同じ分類結果を日付順に並べて
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
  // 完了日基準Todoの推奨期間内・上限超過(YDR-017)
  | "reminder"
  // 完了日基準Todoの推奨期間前。急かさないためホームには出さない(YDR-017)。
  | "before-window"
  // 一回限りTodoの予定日未定(YDR-030)
  | "undated";

export type PendingTodoEntry = {
  category: PendingTodoCategory;
  item: TodoCardItem;
  // 日付順に並べるための期限。予定日未定はnull。
  sortKey: string | null;
};

// ホームの「近日」に含める日数。これより先の予定はすべてのTodo一覧で確認する。
const HOME_UPCOMING_DAYS = 7;

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

function buildUndatedEntry(
  row: PendingOccurrenceRow,
  recurrenceBasis: RecurrenceBasis,
): PendingTodoEntry {
  const deadlineKind = toDeadlineKind(row.task_rules.deadline_kind);
  if (recurrenceBasis !== "once" || deadlineKind !== "strict") {
    throw new Error("予定日未定を利用できないTodoです。");
  }
  return {
    category: "undated",
    item: {
      ...pendingTodoItemBase(row),
      badge: "未定",
      meta: "予定日: 未定 ・ 繰り返しなし",
      oneTimeScheduledFor: null,
      tone: "upcoming",
    },
    sortKey: null,
  };
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
  return {
    category: state === "before-window" ? "before-window" : "reminder",
    item: {
      ...pendingTodoItemBase(row),
      meta: describeMaintenanceWindowFromIso(state, window),
      tone: MAINTENANCE_DISPLAY_COPY[state].tone,
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
      meta: `${describeStrictScheduleFromIso(state, dueAt)} ・ ${
        recurrenceBasis === "calendar" ? "曜日・日付で繰り返す" : "繰り返しなし"
      }`,
      ...(recurrenceBasis === "once" ? { oneTimeScheduledFor: scheduledFor } : {}),
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
  return rows
    .slice()
    .sort((left, right) => (left.due_at ?? "").localeCompare(right.due_at ?? ""))
    .map((row) => buildPendingTodoEntry(row, nowIso));
}
