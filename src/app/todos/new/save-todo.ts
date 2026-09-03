import type { D1Session } from "../../../lib/d1/authorization";
import {
  calendarFirstScheduledFor,
  calendarScheduleFromInput,
  type CompletionIntervalUnit,
  intervalFirstScheduledFor,
} from "../../../lib/d1/calendar";
import { getD1Context } from "../../../lib/d1/context";
import {
  createCalendarTask,
  createIntervalTask,
  createMaintenanceTask,
  createOneTimeTask,
} from "../../../lib/d1/todos";
import type { RegisteredTodoSchedule } from "./registration-feedback";

// 登録フォームの入力を検証し終えた形(actions.tsのparseTodoの結果)と、その
// 保存。#280と同じ方針で、入力の解釈(actions.ts)と保存(このファイル)を
// 分けている。

export type TodoBasics = {
  managedItemId: string | null;
  recurrenceBasis: "calendar" | "completion" | "interval" | "once";
  title: string;
};

export type OneTimeTodoInput = TodoBasics & {
  recurrenceBasis: "once";
  scheduledFor: string | null;
};

export type CompletionTodoInput = TodoBasics & {
  firstDueAt: string;
  firstScheduledFor: string;
  recurrenceBasis: "completion";
  recommendedStartOffset: number;
  recommendedStartValue: number;
  recommendedUnit: CompletionIntervalUnit;
  recommendedUntilOffset: number;
  recommendedUntilValue: number;
};

// Issue #99 / YDR-037: 固定間隔。起点日はAsia/Tokyoの暦日で保存し、候補列は
// 起点日と間隔だけで決まる(完了日に依存しない)。
export type IntervalTodoInput = TodoBasics & {
  intervalAnchorOn: string;
  intervalCount: number;
  intervalUnit: "day" | "week";
  recurrenceBasis: "interval";
};

export type CalendarTodoInput = TodoBasics & {
  recurrenceBasis: "calendar";
  scheduleDayOfMonth?: number;
  // Issue #100 / YDR-040: 毎週は複数曜日、毎月の曜日方式は複数の第Nと最終を持つ。
  scheduleDaysOfWeek?: number[];
  scheduleKind: "monthly_day" | "monthly_nth_weekday" | "weekly" | "yearly";
  // Issue #227 / YDR-032: monthly_dayのときだけ、固定日ではなく毎月末を
  // 意味する。日付は常に31を渡す(既存の月末補正規則、YDR-021)。
  scheduleMonthEnd: boolean;
  scheduleMonth?: number;
  scheduleWeekLast?: boolean;
  scheduleWeekOfMonth?: number | null;
  scheduleWeeksOfMonth?: number[];
};

export type ParsedTodoInput =
  | CalendarTodoInput
  | CompletionTodoInput
  | IntervalTodoInput
  | OneTimeTodoInput;

async function saveCalendarTodo(
  db: D1Database,
  session: NonNullable<D1Session>,
  input: CalendarTodoInput,
  now: Date,
): Promise<{ dueAt: string; scheduledFor: string }> {
  const schedule = {
    ...input,
    scheduleDayOfMonth: input.scheduleDayOfMonth ?? null,
    scheduleDaysOfWeek: input.scheduleDaysOfWeek ?? [],
    scheduleMonth: input.scheduleMonth ?? null,
    scheduleWeekOfMonth: input.scheduleWeekOfMonth ?? null,
  };
  await createCalendarTask(db, session, schedule, now);
  const first = calendarFirstScheduledFor(calendarScheduleFromInput(schedule), now);
  return { dueAt: first, scheduledFor: first };
}

// 保存したTodoの予定日と期限を、登録処理と同じ値のまま返す。定例日基準・
// 固定間隔の初回予定は、登録処理と同じ関数(calendar.ts)へ同じ`now`を渡して
// 求め、登録後の表示のためだけの候補計算を持たない(Issue #286)。
export async function saveTodo(
  input: ParsedTodoInput,
  now: Date,
): Promise<RegisteredTodoSchedule> {
  const { db, session } = await getD1Context();
  const basics = { recurrenceBasis: input.recurrenceBasis, title: input.title };
  if (input.recurrenceBasis === "once") {
    await createOneTimeTask(db, session, input);
    return {
      ...basics,
      deadlineKind: "strict",
      dueAt: input.scheduledFor,
      scheduledFor: input.scheduledFor,
    };
  }
  if (input.recurrenceBasis === "completion") {
    await createMaintenanceTask(db, session, input);
    return {
      ...basics,
      deadlineKind: "maintenance",
      dueAt: input.firstDueAt,
      scheduledFor: input.firstScheduledFor,
    };
  }
  if (input.recurrenceBasis === "interval") {
    await createIntervalTask(db, session, input, now);
    const first = intervalFirstScheduledFor(input, now);
    return { ...basics, deadlineKind: "strict", dueAt: first, scheduledFor: first };
  }
  return {
    ...basics,
    deadlineKind: "strict",
    ...(await saveCalendarTodo(db, session, input, now)),
  };
}
