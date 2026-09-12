"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getD1Context } from "../../../lib/d1/context";
import {
  type RecurringTaskRuleUpdate,
  updateOneTimeTodo,
  updateRecurringOccurrence as updateRecurringOccurrenceInD1,
  updateRecurringTaskRule,
} from "../../../lib/d1/todos";
import {
  ASSIGNEE_NOT_FOUND_ERROR,
  mapTodoError,
  STATE_CHANGED_ERROR,
  type TodoErrorResponses,
} from "../../../features/todos/actions/error-mapping";
import type { MaintenanceTodoActionState } from "../../../features/todos/state";
import { getTokyoDayDistance, tokyoDateToUtcIso } from "../../time-zone";
import {
  COMPLETION_UNIT_DAYS,
  INVALID_TASK_TITLE_MESSAGE,
  MAX_COMPLETION_VALUE,
  MAX_INTERVAL_ANCHOR_DISTANCE_DAYS,
  MAX_INTERVAL_COUNT,
  parseTodoTitle,
} from "../todo-input-limits";
import { parseCalendarRuleSchedule } from "./calendar-rule-input";

type ParsedTodoEditForm =
  | {
      assigneeUserId: string | null;
      managedItemId: string | null;
      occurrenceId: string;
      scheduledFor: string | null;
      status: "ok";
      title: string;
    }
  | MaintenanceTodoActionState;

function optionalId(formData: FormData, field: string): string | null {
  const raw = formData.get(field);
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return value.length === 0 ? null : value;
}

// 予定日は空欄を「未定」として受け取る(YDR-030)。日付の解釈はTodo登録・
// 予定日変更と同じくAsia/Tokyoの暦日に揃える。
// Issue #325 / YDR-046: 「必要になったら繰り返す」Todoの編集フォームは予定日欄
// 自体を持たない。欄がないことも空欄と同じ「予定日なし」として受け取り、
// 方式との整合(manualに日付を与えないこと)はD1層が確かめる。
function parseSchedule(
  formData: FormData,
): { status: "ok"; value: string | null } | MaintenanceTodoActionState {
  const raw = formData.get("plannedDate");
  if (raw === null) return { status: "ok", value: null };
  if (typeof raw !== "string") {
    return { message: "予定日を正しく入力してください。", status: "error" };
  }
  if (raw === "") return { status: "ok", value: null };
  const scheduledFor = tokyoDateToUtcIso(raw);
  if (scheduledFor === null) {
    return { message: "予定日を正しく入力してください。", status: "error" };
  }
  return { status: "ok", value: scheduledFor };
}

function parseTodoEditForm(formData: FormData): ParsedTodoEditForm {
  const occurrenceId = optionalId(formData, "id");
  if (occurrenceId === null) {
    return { message: "対象のTodoを特定できませんでした。", status: "error" };
  }

  // 名前の長さは登録と同じ規則(../todo-input-limits.ts)。
  const title = parseTodoTitle(formData);
  if (title === null) {
    return { message: INVALID_TASK_TITLE_MESSAGE, status: "error" };
  }

  const schedule = parseSchedule(formData);
  if (schedule.status !== "ok") return schedule;

  return {
    assigneeUserId: optionalId(formData, "assigneeUserId"),
    managedItemId: optionalId(formData, "managedItemId"),
    occurrenceId,
    scheduledFor: schedule.value,
    status: "ok",
    title,
  };
}

// 編集画面が共有する案内。担当者・管理対象・対象Todoの取り違えは、
// 1回だけのTodoの編集と繰り返しTodoの編集で同じ文言にする。
const MANAGED_ITEM_NOT_FOUND_ERROR: MaintenanceTodoActionState = {
  message: "関連する管理対象を指定できませんでした。同じ家庭の管理対象から選び直してください。",
  status: "error",
};

const OCCURRENCE_NOT_FOUND_ERROR: MaintenanceTodoActionState = {
  message: "対象のTodoが見つかりませんでした。最新の状態を確認してください。",
  status: "error",
};

const GENERIC_EDIT_ERROR: MaintenanceTodoActionState = {
  message: "Todoを更新できませんでした。時間をおいて再度お試しください。",
  status: "error",
};

// D1層の識別コード(src/lib/d1/errors.ts)から案内文を選ぶ。コードを持たない
// エラーは一般的な失敗表示にし、内部の詳細は表示しない(Issue #369)。
const EDIT_ERROR_RESPONSES: TodoErrorResponses = {
  ASSIGNEE_NOT_FOUND: ASSIGNEE_NOT_FOUND_ERROR,
  EDIT_REQUIRES_ONE_TIME: {
    message: "繰り返しTodoの内容はこの画面から変更できません。",
    status: "error",
  },
  MANAGED_ITEM_NOT_FOUND: MANAGED_ITEM_NOT_FOUND_ERROR,
  MANUAL_TODO_HAS_NO_SCHEDULE: {
    message: "必要になったら繰り返すTodoには予定日を設定できません。",
    status: "error",
  },
  OCCURRENCE_NOT_FOUND: OCCURRENCE_NOT_FOUND_ERROR,
  OCCURRENCE_NOT_PENDING: STATE_CHANGED_ERROR,
  OCCURRENCE_SCHEDULE_TAKEN: {
    message: "その予定日には同じTodoの別の予定があります。別の日付を指定してください。",
    status: "error",
  },
};

// 保存後に反映する画面。ホーム(#36)、Todo一覧(#201)、Todo詳細と
// 編集画面、そして関連ManagedItemの詳細を、変更前後の両方について再検証する。
function revalidateTodoEditViews(
  occurrenceId: string,
  managedItemIds: (string | null)[],
): void {
  revalidatePath("/");
  revalidatePath("/todos");
  revalidatePath(`/todos/${encodeURIComponent(occurrenceId)}`);
  revalidatePath(`/todos/${encodeURIComponent(occurrenceId)}/edit`);
  for (const managedItemId of new Set(managedItemIds)) {
    if (managedItemId !== null) {
      revalidatePath(`/managed-items/${encodeURIComponent(managedItemId)}`);
    }
  }
}

// Issue #203: 繰り返しなしTodoの名前・関連ManagedItem・担当者・予定日を保存する。
// 対象のOccurrence IDはフォームの隠しフィールド(id)から受け取る
// (updateManagedItemと同じ、useActionStateのaction型を崩さない方式)。
// 他家庭のTodo・ManagedItem・メンバーはD1側が拒否する。
export async function updateTodo(
  _previousState: MaintenanceTodoActionState,
  formData: FormData,
): Promise<MaintenanceTodoActionState> {
  const parsed = parseTodoEditForm(formData);
  if (parsed.status !== "ok") return parsed;

  let previousManagedItemId: string | null;
  try {
    const { db, session } = await getD1Context();
    ({ previousManagedItemId } = await updateOneTimeTodo(db, session, parsed.occurrenceId, {
      assigneeUserId: parsed.assigneeUserId,
      managedItemId: parsed.managedItemId,
      scheduledFor: parsed.scheduledFor,
      title: parsed.title,
    }));
  } catch (error) {
    return mapTodoError(error, EDIT_ERROR_RESPONSES, GENERIC_EDIT_ERROR);
  }

  revalidateTodoEditViews(parsed.occurrenceId, [
    previousManagedItemId,
    parsed.managedItemId,
  ]);
  redirect(`/todos/${encodeURIComponent(parsed.occurrenceId)}`);
}

function parseIntegerField(
  formData: FormData,
  field: string,
  minimum: number,
  maximum: number,
): number | null {
  const raw = formData.get(field);
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : null;
}

const RECURRING_EDIT_ERROR_RESPONSES: TodoErrorResponses = {
  ASSIGNEE_NOT_FOUND: ASSIGNEE_NOT_FOUND_ERROR,
  DUE_AT_BEFORE_SCHEDULED_FOR: {
    message: "現在の期限は本来の予定日以降を指定してください。",
    status: "error",
  },
  DUE_AT_NOT_IN_FUTURE: {
    message: "現在の期限は今日より後の日付を指定してください。",
    status: "error",
  },
  MANAGED_ITEM_NOT_FOUND: MANAGED_ITEM_NOT_FOUND_ERROR,
  OCCURRENCE_NOT_FOUND: OCCURRENCE_NOT_FOUND_ERROR,
  OCCURRENCE_NOT_PENDING: STATE_CHANGED_ERROR,
  RECURRENCE_BASIS_IMMUTABLE: {
    message: "繰り返し方は変更できません。現在の方式の条件を編集してください。",
    status: "error",
  },
};

function recurringBasics(
  formData: FormData,
): {
  managedItemId: string | null;
  occurrenceId: string;
  recurrenceBasis: "calendar" | "completion" | "interval";
  title: string;
} | MaintenanceTodoActionState {
  const occurrenceId = optionalId(formData, "id");
  if (occurrenceId === null) {
    return { message: "対象のTodoを特定できませんでした。", status: "error" };
  }
  const title = parseTodoTitle(formData);
  if (title === null) {
    return { message: INVALID_TASK_TITLE_MESSAGE, status: "error" };
  }
  const recurrenceBasis = formData.get("recurrenceBasis");
  if (
    recurrenceBasis !== "calendar" && recurrenceBasis !== "completion" &&
    recurrenceBasis !== "interval"
  ) {
    return { message: "繰り返し条件を正しく入力してください。", status: "error" };
  }
  return {
    managedItemId: optionalId(formData, "managedItemId"),
    occurrenceId,
    recurrenceBasis,
    title,
  };
}

function calendarRuleInput(
  formData: FormData,
  basics: Exclude<ReturnType<typeof recurringBasics>, MaintenanceTodoActionState>,
): RecurringTaskRuleUpdate | MaintenanceTodoActionState {
  const schedule = parseCalendarRuleSchedule(formData);
  if ("status" in schedule) return schedule;
  return {
    managedItemId: basics.managedItemId,
    recurrenceBasis: "calendar",
    ...schedule,
    title: basics.title,
  };
}

function completionRuleInput(
  formData: FormData,
  basics: Exclude<ReturnType<typeof recurringBasics>, MaintenanceTodoActionState>,
): RecurringTaskRuleUpdate | MaintenanceTodoActionState {
  const unit = formData.get("intervalUnit");
  if (unit !== "day" && unit !== "week" && unit !== "month" && unit !== "year") {
    return { message: "次回の目安を正しく入力してください。", status: "error" };
  }
  const minimum = parseIntegerField(formData, "intervalMin", 0, MAX_COMPLETION_VALUE[unit]);
  const maximum = parseIntegerField(formData, "intervalMax", 0, MAX_COMPLETION_VALUE[unit]);
  if (minimum === null || maximum === null || minimum > maximum) {
    return { message: "次回の目安は0以上の整数で、短い方を長い方以下にしてください。", status: "error" };
  }
  const dayMultiplier = unit === "day" || unit === "week" ? COMPLETION_UNIT_DAYS[unit] : 0;
  return {
    managedItemId: basics.managedItemId,
    recurrenceBasis: "completion",
    recommendedStartOffset: minimum * dayMultiplier,
    recommendedStartValue: minimum,
    recommendedUnit: unit,
    recommendedUntilOffset: maximum * dayMultiplier,
    recommendedUntilValue: maximum,
    title: basics.title,
  };
}

function intervalRuleInput(
  formData: FormData,
  basics: Exclude<ReturnType<typeof recurringBasics>, MaintenanceTodoActionState>,
): RecurringTaskRuleUpdate | MaintenanceTodoActionState {
  const unit = formData.get("fixedIntervalUnit");
  const anchor = formData.get("fixedIntervalAnchorDate");
  if (unit !== "day" && unit !== "week") {
    return { message: "繰り返す間隔と起点日を正しく入力してください。", status: "error" };
  }
  const count = parseIntegerField(formData, "fixedIntervalCount", 1, MAX_INTERVAL_COUNT[unit]);
  const anchorIso = typeof anchor === "string" ? tokyoDateToUtcIso(anchor) : null;
  if (
    count === null || anchorIso === null ||
    Math.abs(getTokyoDayDistance(new Date().toISOString(), anchorIso)) >
      MAX_INTERVAL_ANCHOR_DISTANCE_DAYS
  ) {
    return { message: "繰り返す間隔と起点日を正しく入力してください。", status: "error" };
  }
  return {
    intervalAnchorOn: anchor as string,
    intervalCount: count,
    intervalUnit: unit,
    managedItemId: basics.managedItemId,
    recurrenceBasis: "interval",
    title: basics.title,
  };
}

function parseRecurringRule(
  formData: FormData,
): { input: RecurringTaskRuleUpdate; occurrenceId: string; status: "ok" } | MaintenanceTodoActionState {
  const basics = recurringBasics(formData);
  if ("status" in basics) return basics;
  const input = basics.recurrenceBasis === "calendar"
    ? calendarRuleInput(formData, basics)
    : basics.recurrenceBasis === "completion"
      ? completionRuleInput(formData, basics)
      : intervalRuleInput(formData, basics);
  return "status" in input ? input : { input, occurrenceId: basics.occurrenceId, status: "ok" };
}

export async function updateRecurringOccurrence(
  _previousState: MaintenanceTodoActionState,
  formData: FormData,
): Promise<MaintenanceTodoActionState> {
  const occurrenceId = optionalId(formData, "id");
  const rawDueDate = formData.get("dueDate");
  const dueAt = typeof rawDueDate === "string" ? tokyoDateToUtcIso(rawDueDate) : null;
  if (occurrenceId === null || dueAt === null) {
    return { message: "現在の期限を正しく入力してください。", status: "error" };
  }
  let managedItemId: string | null;
  try {
    const { db, session } = await getD1Context();
    ({ managedItemId } = await updateRecurringOccurrenceInD1(db, session, occurrenceId, {
      assigneeUserId: optionalId(formData, "assigneeUserId"),
      dueAt,
    }));
  } catch (error) {
    return mapTodoError(error, RECURRING_EDIT_ERROR_RESPONSES, GENERIC_EDIT_ERROR);
  }
  revalidateTodoEditViews(occurrenceId, [managedItemId]);
  redirect(`/todos/${encodeURIComponent(occurrenceId)}`);
}

export async function updateRecurringRule(
  _previousState: MaintenanceTodoActionState,
  formData: FormData,
): Promise<MaintenanceTodoActionState> {
  const parsed = parseRecurringRule(formData);
  if (parsed.status !== "ok") return parsed;
  let previousManagedItemId: string | null;
  try {
    const { db, session } = await getD1Context();
    ({ previousManagedItemId } = await updateRecurringTaskRule(
      db,
      session,
      parsed.occurrenceId,
      parsed.input,
    ));
  } catch (error) {
    return mapTodoError(error, RECURRING_EDIT_ERROR_RESPONSES, GENERIC_EDIT_ERROR);
  }
  revalidateTodoEditViews(parsed.occurrenceId, [
    previousManagedItemId,
    parsed.input.managedItemId,
  ]);
  redirect(`/todos/${encodeURIComponent(parsed.occurrenceId)}`);
}
