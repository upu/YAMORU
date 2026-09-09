import { type RecurringTaskRuleUpdate } from "../../../lib/d1/todos";
import type { MaintenanceTodoActionState } from "../../../features/todos/state";
import {
  type CalendarScheduleInputError,
  EMPTY_WEEK_POSITIONS_MESSAGE,
  calendarScheduleWithNulls,
  isCalendarScheduleInputError,
  parseCalendarScheduleInput,
} from "../calendar-schedule-input";

// Issue #367: 定例日の解釈そのものは登録・編集の共通処理
// (../calendar-schedule-input.ts)にあり、ここは編集画面の文言と、更新入力
// (RecurringTaskRuleUpdate)の形への変換だけを持つ。

export type CalendarRuleSchedule = Pick<
  Extract<RecurringTaskRuleUpdate, { recurrenceBasis: "calendar" }>,
  | "scheduleDayOfMonth" | "scheduleDaysOfWeek" | "scheduleKind"
  | "scheduleMonth" | "scheduleMonthEnd" | "scheduleWeekLast"
  | "scheduleWeekOfMonth" | "scheduleWeeksOfMonth"
>;

// 曜日を1つも選んでいない場合、登録は「曜日を1つ以上選んでください。」を返すが、
// 編集は以前から定例パターン全体の入力エラーとして扱う。文言の統一は別の仕様
// 変更として扱い、この共通化では現在の受け取り方を維持する(#367)。
const INVALID_CALENDAR_RULE_MESSAGE = "定例パターンを正しく入力してください。";
const EDIT_MESSAGES: Record<CalendarScheduleInputError, string> = {
  empty_week_positions: EMPTY_WEEK_POSITIONS_MESSAGE,
  empty_weekdays: INVALID_CALENDAR_RULE_MESSAGE,
  invalid_schedule: INVALID_CALENDAR_RULE_MESSAGE,
};

export function parseCalendarRuleSchedule(
  formData: FormData,
): CalendarRuleSchedule | MaintenanceTodoActionState {
  const condition = parseCalendarScheduleInput(formData);
  if (isCalendarScheduleInputError(condition)) {
    return { message: EDIT_MESSAGES[condition], status: "error" };
  }
  return calendarScheduleWithNulls(condition);
}
