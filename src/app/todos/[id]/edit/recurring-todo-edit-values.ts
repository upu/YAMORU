import { parseCalendarScheduleSpecs } from "../../../../lib/d1/calendar";
import { type TodoDetailRow } from "../../../../lib/d1/todos";
import { toRecurrenceBasis } from "../../../task-schedule";
import { type RecurringRuleEditValues } from "./recurring-todo-edit-form";

function completionValues(todo: TodoDetailRow): RecurringRuleEditValues {
  const hasSavedValues = todo.recommended_start_value !== null &&
    todo.recommended_until_value !== null && todo.recommended_unit !== null;
  const useWeeks = !hasSavedValues && todo.recommended_start_offset % 7 === 0 &&
    todo.recommended_until_offset % 7 === 0;
  const unit = hasSavedValues ? todo.recommended_unit : useWeeks ? "week" : "day";
  if (unit !== "day" && unit !== "week" && unit !== "month" && unit !== "year") {
    throw new Error("完了日基準Todoの単位が不正です。");
  }
  return {
    managedItemId: todo.managed_item_id,
    recurrenceBasis: "completion",
    recommendedStartValue: todo.recommended_start_value ??
      (useWeeks ? todo.recommended_start_offset / 7 : todo.recommended_start_offset),
    recommendedUnit: unit,
    recommendedUntilValue: todo.recommended_until_value ??
      (useWeeks ? todo.recommended_until_offset / 7 : todo.recommended_until_offset),
    title: todo.title,
  };
}

function intervalValues(todo: TodoDetailRow): RecurringRuleEditValues {
  if (
    todo.interval_anchor_on === null || todo.interval_count === null ||
    (todo.interval_unit !== "day" && todo.interval_unit !== "week")
  ) {
    throw new Error("固定間隔Todoの条件が不正です。");
  }
  return {
    intervalAnchorOn: todo.interval_anchor_on,
    intervalCount: todo.interval_count,
    intervalUnit: todo.interval_unit,
    managedItemId: todo.managed_item_id,
    recurrenceBasis: "interval",
    title: todo.title,
  };
}

// Issue #102 / YDR-040: 編集フォームの初期値も候補指定の配列から作る。毎週は
// 選択済みの曜日をすべて渡し、他の種類は候補指定1件から単一値を取り出す。
function calendarValues(todo: TodoDetailRow): RecurringRuleEditValues {
  const validKinds = ["weekly", "monthly_day", "monthly_nth_weekday", "yearly"];
  const specs = parseCalendarScheduleSpecs(todo.schedule_specs);
  const first = specs.at(0);
  if (
    todo.schedule_kind === null || !validKinds.includes(todo.schedule_kind) ||
    first === undefined || first.kind !== todo.schedule_kind
  ) {
    throw new Error("定例日基準Todoの条件が不正です。");
  }
  return {
    managedItemId: todo.managed_item_id,
    recurrenceBasis: "calendar",
    scheduleDayOfMonth: first.dayOfMonth === 0 ? null : first.dayOfMonth,
    scheduleDaysOfWeek: specs.map((spec) => spec.dayOfWeek).filter((day) => day !== 0),
    scheduleKind: todo.schedule_kind as "monthly_day" | "monthly_nth_weekday" | "weekly" | "yearly",
    scheduleMonth: first.month === 0 ? null : first.month,
    scheduleMonthEnd: first.monthEnd,
    scheduleWeekOfMonth: first.weekOfMonth === 0 ? null : first.weekOfMonth,
    title: todo.title,
  };
}

export function recurringRuleValues(todo: TodoDetailRow): RecurringRuleEditValues {
  const basis = toRecurrenceBasis(todo.recurrence_basis);
  if (basis === "completion") return completionValues(todo);
  if (basis === "interval") return intervalValues(todo);
  if (basis === "calendar") return calendarValues(todo);
  throw new Error("繰り返しTodoではありません。");
}
