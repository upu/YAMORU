import type { MaintenanceTodoActionState } from "../../../features/todos/state";
import type { CalendarTodoInput, TodoBasics } from "./save-todo";
import {
  type CalendarScheduleInputError,
  EMPTY_WEEKDAYS_MESSAGE,
  EMPTY_WEEK_POSITIONS_MESSAGE,
  isCalendarScheduleInputError,
  parseCalendarScheduleInput,
} from "../calendar-schedule-input";

// Issue #101 / #367: 定例日の解釈そのものは登録・編集の共通処理
// (../calendar-schedule-input.ts)にあり、ここは登録画面の文言と、保存する形
// (TodoBasicsを足したCalendarTodoInput)への変換だけを持つ。保存はsave-todo.tsが行う。

const REGISTRATION_MESSAGES: Record<CalendarScheduleInputError, string> = {
  empty_week_positions: EMPTY_WEEK_POSITIONS_MESSAGE,
  empty_weekdays: EMPTY_WEEKDAYS_MESSAGE,
  invalid_schedule: "定例日の指定を正しく入力してください。",
};

export function parseCalendarTodo(
  basics: TodoBasics,
  formData: FormData,
): CalendarTodoInput | MaintenanceTodoActionState {
  const condition = parseCalendarScheduleInput(formData);
  if (isCalendarScheduleInputError(condition)) {
    return { message: REGISTRATION_MESSAGES[condition], status: "error" };
  }
  return { ...basics, ...condition, recurrenceBasis: "calendar" };
}
