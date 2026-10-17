"use server";

import { revalidatePath } from "next/cache";

import type { MaintenanceTodoActionState } from "../../../features/todos/state";
import {
  INVALID_TASK_TITLE_MESSAGE,
  INVALID_TASK_NOTE_MESSAGE,
  parseTodoNote,
  parseTodoTitle,
} from "../todo-input-limits";
import {
  completionFirstWindow,
  intervalCondition,
  isCompletionUnit,
  recommendedOffsets,
  type RecommendedOffsets,
} from "../recurrence-input";
import { parseCalendarTodo } from "./calendar-todo-input";
import {
  type RegisteredTodoSchedule,
  type TodoRegistrationState,
  summarizeRegisteredTodoSafely,
} from "./registration-feedback";
import {
  type CompletionTodoInput,
  type IntervalTodoInput,
  type OneTimeTodoInput,
  type ParsedTodoInput,
  type TodoBasics,
  saveTodo,
} from "./save-todo";
import { tokyoDateToUtcIso } from "../../time-zone";

const INVALID_OFFSETS: MaintenanceTodoActionState = {
  message: "次回の目安は0以上の整数で、短い方を長い方以下にしてください。",
  status: "error",
};
const INVALID_WINDOW: MaintenanceTodoActionState = {
  message: "初回の計算に使う有効な日付を入力してください。",
  status: "error",
};
const INVALID_INTERVAL: MaintenanceTodoActionState = {
  message: "繰り返す間隔と起点日を正しく入力してください。",
  status: "error",
};

function isInvalidHardDeadline(value: FormDataEntryValue | null): boolean {
  return value !== null && value !== "" && (typeof value !== "string" || tokyoDateToUtcIso(value) === null);
}

function parseTodoBasics(
  formData: FormData,
): TodoBasics | MaintenanceTodoActionState {
  // 名前の長さは編集と同じ規則(../todo-input-limits.ts)。
  const title = parseTodoTitle(formData);
  if (title === null) {
    return { message: INVALID_TASK_TITLE_MESSAGE, status: "error" };
  }

  const recurrenceBasis = formData.get("recurrenceBasis");
  if (
    recurrenceBasis !== "calendar" &&
    recurrenceBasis !== "completion" &&
    recurrenceBasis !== "interval" &&
    recurrenceBasis !== "manual" &&
    recurrenceBasis !== "once"
  ) {
    return { message: "繰り返し方を選択してください。", status: "error" };
  }

  // Issue #329 / YDR-047: メモは任意。長さの規則は編集と共通
  // (../todo-input-limits.ts)。
  const note = parseTodoNote(formData);
  if (note.status !== "ok") {
    return { message: INVALID_TASK_NOTE_MESSAGE, status: "error" };
  }

  const rawManagedItemId = formData.get("managedItemId");
  const managedItemId = typeof rawManagedItemId === "string"
    ? rawManagedItemId.trim() || null
    : null;
  const mustCompleteBy = formData.get("mustCompleteBy");
  if (isInvalidHardDeadline(mustCompleteBy)) {
    return { message: "必達日を正しく入力してください。", status: "error" };
  }
  return { managedItemId, note: note.value, recurrenceBasis, title,
    ...(typeof mustCompleteBy === "string" && mustCompleteBy !== "" ? { mustCompleteBy } : {}) };
}

function parseBoundedInteger(
  value: FormDataEntryValue | null,
  minimum: number,
  maximum: number,
): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : null;
}

function parseIntervalTodo(
  basics: TodoBasics,
  formData: FormData,
  now: Date,
): IntervalTodoInput | MaintenanceTodoActionState {
  const count = parseBoundedInteger(formData.get("fixedIntervalCount"), 1, Number.MAX_SAFE_INTEGER);
  const anchorOn = formData.get("fixedIntervalAnchorDate");
  if (count === null || typeof anchorOn !== "string") return INVALID_INTERVAL;
  // 間隔の上限と起点日の範囲は、外部commandと共通の規則(../recurrence-input.ts)。
  const condition = intervalCondition(formData.get("fixedIntervalUnit"), count, anchorOn, now);
  return condition === null ? INVALID_INTERVAL : { ...basics, ...condition, recurrenceBasis: "interval" };
}

function parseOneTimeTodo(
  basics: TodoBasics,
  formData: FormData,
): OneTimeTodoInput | MaintenanceTodoActionState {
  const plannedDate = formData.get("plannedDate");
  const scheduledFor = typeof plannedDate === "string" && plannedDate !== ""
    ? tokyoDateToUtcIso(plannedDate)
    : null;
  if (typeof plannedDate !== "string" || (plannedDate !== "" && scheduledFor === null)) {
    return { message: "予定日を正しく入力してください。", status: "error" };
  }
  return { ...basics, recurrenceBasis: "once", scheduledFor };
}

function parseOffset(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const offset = Number(value);
  return Number.isSafeInteger(offset) ? offset : null;
}

function parseRecommendedOffsets(
  formData: FormData,
): RecommendedOffsets | MaintenanceTodoActionState {
  const intervalMin = parseOffset(formData.get("intervalMin"));
  const intervalMax = parseOffset(formData.get("intervalMax"));
  const rawUnit = formData.get("intervalUnit");
  if (intervalMin === null || intervalMax === null || !isCompletionUnit(rawUnit)) {
    return INVALID_OFFSETS;
  }
  return recommendedOffsets(rawUnit, intervalMin, intervalMax) ?? INVALID_OFFSETS;
}

function parseCompletionTodo(
  basics: TodoBasics,
  formData: FormData,
): CompletionTodoInput | MaintenanceTodoActionState {
  const offsets = parseRecommendedOffsets(formData);
  if ("status" in offsets) return offsets;

  const mode = formData.get("initialDateMode");
  if (mode !== "previous_completion" && mode !== "next_window_start") {
    return { message: "初回の決め方を選択してください。", status: "error" };
  }

  const anchorDate = formData.get("anchorDate");
  if (typeof anchorDate !== "string") return INVALID_WINDOW;
  const window = completionFirstWindow(offsets, mode, anchorDate);
  if (window === null) return INVALID_WINDOW;

  return {
    ...basics,
    ...offsets,
    ...window,
    recurrenceBasis: "completion",
  };
}

function parseTodo(
  formData: FormData,
  now: Date,
): ParsedTodoInput | MaintenanceTodoActionState {
  const basics = parseTodoBasics(formData);
  if ("status" in basics) return basics;
  if (basics.recurrenceBasis === "once") return parseOneTimeTodo(basics, formData);
  // Issue #325 / YDR-046: 「必要になったら繰り返す」は日付も間隔も持たない
  // ため、Todo名と管理対象以外に読み取る入力がない。
  if (basics.recurrenceBasis === "manual") {
    return { ...basics, recurrenceBasis: "manual" };
  }
  if (basics.recurrenceBasis === "completion") {
    return parseCompletionTodo(basics, formData);
  }
  if (basics.recurrenceBasis === "interval") {
    return parseIntervalTodo(basics, formData, now);
  }
  return parseCalendarTodo(basics, formData);
}

function revalidateTodoPages(managedItemId: string | null): void {
  revalidatePath("/");
  // 追加したTodoは、ホームに載らない予定(7日より先など)でも
  // Todo一覧には必ず載る(Issue #201)。
  revalidatePath("/todos");
  revalidatePath("/todos/new");
  if (managedItemId !== null) {
    revalidatePath(`/managed-items/${encodeURIComponent(managedItemId)}`);
  }
}

export async function createTodo(
  _previousState: TodoRegistrationState,
  formData: FormData,
): Promise<TodoRegistrationState> {
  const now = new Date();
  const input = parseTodo(formData, now);
  if ("status" in input) return input;

  let saved: RegisteredTodoSchedule;
  try {
    saved = await saveTodo(input, now);
  } catch {
    return {
      message: "Todoを登録できませんでした。時間をおいて再度お試しください。",
      status: "error",
    };
  }

  revalidateTodoPages(input.managedItemId);
  // 登録できたことに加えて、次回の予定と、ホームにまだ出ない場合の確認先を
  // その場で返す(Issue #286)。
  return {
    message: "Todoを登録しました。",
    registered: summarizeRegisteredTodoSafely(saved, now.toISOString()),
    status: "success",
  };
}
