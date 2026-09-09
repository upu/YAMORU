// Issue #367: 定例日基準Todoの繰り返し条件は、登録(new/calendar-todo-input.ts)と
// 編集([id]/calendar-rule-input.ts)が同じ仕様を別々に解釈していた。FormDataから
// 共通の定例日条件、または画面ごとに文言を決めるためのエラー識別子を返す純粋関数を
// ここへ一つだけ置く。初回予定(登録)と更新入力への変換(編集)は呼び出し側に残す。
//
// 入力欄の名前とチェックボックスの未選択メッセージも、サーバー側がUIファイル
// ("use client")からimportしないようここへ集める。

export const WEEKDAYS_FIELD_NAME = "scheduleDaysOfWeek";
export const WEEK_POSITIONS_FIELD_NAME = "scheduleWeekOfMonth";
export const WEEK_LAST_FIELD_NAME = "scheduleWeekLast";

// Issue #102 / YDR-040の7: 候補指定が0件のルールは作れない。
export const EMPTY_WEEKDAYS_MESSAGE = "曜日を1つ以上選んでください。";
export const EMPTY_WEEK_POSITIONS_MESSAGE =
  "第1〜第5または最終を1つ以上選んでください。";

export type CalendarScheduleKind =
  | "monthly_day"
  | "monthly_nth_weekday"
  | "weekly"
  | "yearly"
  | "yearly_nth_weekday";

// 登録・編集が共有する定例日条件。使わない項目は持たせず、保存形へそろえる
// (NULL埋め)のはcalendarScheduleWithNullsに任せる。
export type CalendarScheduleCondition = {
  scheduleDayOfMonth?: number;
  // Issue #100 / #101 / #102 / YDR-040: 毎週は複数曜日、毎月・毎年の曜日方式は
  // 複数の第Nと最終を持つ。
  scheduleDaysOfWeek?: number[];
  scheduleKind: CalendarScheduleKind;
  scheduleMonth?: number;
  // Issue #227 / YDR-032: monthly_dayのときだけ、固定日ではなく毎月末を意味する。
  // 日付は常に31を渡す(既存の月末補正規則、YDR-021)。
  scheduleMonthEnd: boolean;
  scheduleWeekLast?: boolean;
  scheduleWeekOfMonth?: number | null;
  scheduleWeeksOfMonth?: number[];
};

// 文言は画面ごとに違う(登録と編集で曜日未選択の扱いが異なる)。共通処理は
// どの条件で拒否したかだけを返し、メッセージは呼び出し側が決める。
export type CalendarScheduleInputError =
  | "empty_week_positions"
  | "empty_weekdays"
  | "invalid_schedule";

export function isCalendarScheduleInputError(
  result: CalendarScheduleCondition | CalendarScheduleInputError,
): result is CalendarScheduleInputError {
  return typeof result === "string";
}

// 数字文字列の解釈は登録側の方式(桁数を問わず範囲で判定する)に合わせて一本化した。
// 編集側は曜日・出現位置だけ1桁の正規表現で判定しており、"07"のような表記を
// 受け付ける範囲が登録側と違っていた。畳んだあとの値は同じで、範囲はここと
// DBのCHECK制約が守る。
function boundedInteger(
  value: FormDataEntryValue | null,
  minimum: number,
  maximum: number,
): number | null {
  if (typeof value !== "string" || !/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : null;
}

// YDR-040の7: 同じ候補指定は1件へ畳み、昇順に並べてから保存する。1つでも不正な
// 値があれば、黙って捨てずに拒否する。
function uniqueAscending(values: (number | null)[]): number[] | null {
  if (values.some((value) => value === null)) return null;
  return [...new Set(values as number[])].sort((left, right) => left - right);
}

function isValidYearlyDate(month: number, day: number): boolean {
  const candidate = new Date(Date.UTC(2000, month - 1, day));
  return candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day;
}

function weeklyCondition(
  formData: FormData,
): CalendarScheduleCondition | CalendarScheduleInputError {
  const weekdays = uniqueAscending(
    formData.getAll(WEEKDAYS_FIELD_NAME).map((value) => boundedInteger(value, 1, 7)),
  );
  if (weekdays === null) return "invalid_schedule";
  if (weekdays.length === 0) return "empty_weekdays";
  return {
    scheduleDaysOfWeek: weekdays,
    scheduleKind: "weekly",
    scheduleMonthEnd: false,
  };
}

function monthlyDayCondition(
  formData: FormData,
): CalendarScheduleCondition | CalendarScheduleInputError {
  if (formData.get("scheduleMonthEnd") === "1") {
    return {
      scheduleDayOfMonth: 31,
      scheduleKind: "monthly_day",
      scheduleMonthEnd: true,
    };
  }
  const day = boundedInteger(formData.get("scheduleDayOfMonth"), 1, 31);
  return day === null ? "invalid_schedule" : {
    scheduleDayOfMonth: day,
    scheduleKind: "monthly_day",
    scheduleMonthEnd: false,
  };
}

// Issue #100 / #101: 第Nと最終の選択は、毎月・毎年で同じ入力欄を使う。
function weekPositions(
  formData: FormData,
): { last: boolean; weeks: number[] } | null {
  const rawLast = formData.get(WEEK_LAST_FIELD_NAME);
  if (rawLast !== null && rawLast !== "0" && rawLast !== "1") return null;
  const weeks = uniqueAscending(
    formData.getAll(WEEK_POSITIONS_FIELD_NAME).map((value) =>
      boundedInteger(value, 1, 5)
    ),
  );
  return weeks === null ? null : { last: rawLast === "1", weeks };
}

// 毎月は月を持たず、毎年は選んだ月を候補指定へ入れる。それ以外は同じ形。
function nthWeekdayCondition(
  formData: FormData,
  scheduleKind: "monthly_nth_weekday" | "yearly_nth_weekday",
  month?: number,
): CalendarScheduleCondition | CalendarScheduleInputError {
  const dayOfWeek = boundedInteger(formData.get("scheduleDayOfWeek"), 1, 7);
  const positions = weekPositions(formData);
  if (dayOfWeek === null || positions === null) return "invalid_schedule";
  if (positions.weeks.length === 0 && !positions.last) return "empty_week_positions";
  return {
    scheduleDaysOfWeek: [dayOfWeek],
    scheduleKind,
    scheduleMonth: month,
    scheduleMonthEnd: false,
    scheduleWeekLast: positions.last,
    scheduleWeekOfMonth: positions.weeks.at(0) ?? null,
    scheduleWeeksOfMonth: positions.weeks,
  };
}

function yearlyNthWeekdayCondition(
  formData: FormData,
): CalendarScheduleCondition | CalendarScheduleInputError {
  const month = boundedInteger(formData.get("scheduleMonth"), 1, 12);
  return month === null
    ? "invalid_schedule"
    : nthWeekdayCondition(formData, "yearly_nth_weekday", month);
}

function yearlyCondition(
  formData: FormData,
): CalendarScheduleCondition | CalendarScheduleInputError {
  const month = boundedInteger(formData.get("scheduleMonth"), 1, 12);
  const day = boundedInteger(formData.get("scheduleDayOfMonth"), 1, 31);
  if (month === null || day === null || !isValidYearlyDate(month, day)) {
    return "invalid_schedule";
  }
  return {
    scheduleDayOfMonth: day,
    scheduleKind: "yearly",
    scheduleMonth: month,
    scheduleMonthEnd: false,
  };
}

export function parseCalendarScheduleInput(
  formData: FormData,
): CalendarScheduleCondition | CalendarScheduleInputError {
  switch (formData.get("scheduleKind")) {
    case "weekly": return weeklyCondition(formData);
    case "monthly_day": return monthlyDayCondition(formData);
    case "monthly_nth_weekday":
      return nthWeekdayCondition(formData, "monthly_nth_weekday");
    case "yearly": return yearlyCondition(formData);
    case "yearly_nth_weekday": return yearlyNthWeekdayCondition(formData);
    default: return "invalid_schedule";
  }
}

// 保存・更新のどちらも、使わない項目をNULL(曜日は空配列)で埋めた形を受け取る。
export function calendarScheduleWithNulls<T extends CalendarScheduleCondition>(
  condition: T,
): T & {
  scheduleDayOfMonth: number | null;
  scheduleDaysOfWeek: number[];
  scheduleMonth: number | null;
  scheduleWeekOfMonth: number | null;
} {
  return {
    ...condition,
    scheduleDayOfMonth: condition.scheduleDayOfMonth ?? null,
    scheduleDaysOfWeek: condition.scheduleDaysOfWeek ?? [],
    scheduleMonth: condition.scheduleMonth ?? null,
    scheduleWeekOfMonth: condition.scheduleWeekOfMonth ?? null,
  };
}
