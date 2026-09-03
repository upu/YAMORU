import { requireCurrentHouseholdId, type D1Session } from "../authorization";
import {
  type CalendarScheduleInput,
  type StoredCalendarSpec,
  calendarFirstScheduledFor,
  calendarScheduleFromInput,
  calendarSpecsFromInput,
  type CompletionIntervalUnit,
  intervalFirstScheduledFor,
} from "../calendar";
import { type TaskBasics, requireManagedItem } from "./shared";
import { legacyCalendarColumnValues } from "./calendar-columns";
import { taskRuleSnapshotExpression } from "./rule-snapshot";

// Todoの新規作成(一回限り・完了日基準・定例日基準・固定間隔)。

export type OneTimeTaskInput = TaskBasics & { scheduledFor: string | null };

type CompletionIntervalInput =
  | {
      recommendedStartValue: number;
      recommendedUnit: CompletionIntervalUnit;
      recommendedUntilValue: number;
    }
  | {
      recommendedStartValue?: never;
      recommendedUnit?: never;
      recommendedUntilValue?: never;
    };

export type MaintenanceTaskInput = TaskBasics & CompletionIntervalInput & {
  firstDueAt: string;
  firstScheduledFor: string;
  recommendedStartOffset: number;
  recommendedUntilOffset: number;
};

// Issue #102 / YDR-040: 候補指定の正本はtask_rule_schedules。毎週だけ複数の
// 曜日(scheduleDaysOfWeek)を持てる。
// Issue #227 / YDR-032: 「毎月末」は schedule_kind='monthly_day' /
// scheduleDayOfMonth=31 と組み合わせて保存する。候補計算には使わない。
export type CalendarTaskInput = TaskBasics & CalendarScheduleInput;

// Issue #99 / YDR-037: 「起点日からN日ごと・N週ごと」。単位と回数は利用者の
// 意図(「隔週」か「14日ごと」か)を残すため分けて保存し、候補計算は
// src/lib/d1/calendar.tsで間隔日数へ正規化する。
export type IntervalTaskInput = TaskBasics & {
  intervalAnchorOn: string;
  intervalCount: number;
  intervalUnit: "day" | "week";
};

function scheduleSpecInserts(
  db: D1Database,
  householdId: string,
  taskRuleId: string,
  specs: readonly StoredCalendarSpec[],
): D1PreparedStatement[] {
  return specs.map((spec) =>
    db.prepare(
      `INSERT INTO task_rule_schedules (
        id, household_id, task_rule_id, schedule_kind,
        day_of_week, week_of_month, week_last, day_of_month, month_end, month
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    ).bind(
      crypto.randomUUID(),
      householdId,
      taskRuleId,
      spec.kind,
      spec.dayOfWeek,
      spec.weekOfMonth,
      spec.weekLast ? 1 : 0,
      spec.dayOfMonth,
      spec.monthEnd ? 1 : 0,
      spec.month,
    )
  );
}

function intervalValues(
  interval: IntervalTaskInput | undefined,
): (number | string | null)[] {
  return [
    interval?.intervalUnit ?? null,
    interval?.intervalCount ?? null,
    interval?.intervalAnchorOn ?? null,
  ];
}

function occurrenceInsert(
  db: D1Database,
  input: {
    dueAt: string | null;
    householdId: string;
    occurrenceId: string;
    completionCalendarVersion: 1 | null;
    scheduledFor: string | null;
    taskRuleId: string;
  },
): D1PreparedStatement {
  const snapshot = taskRuleSnapshotExpression();
  return db.prepare(
    `INSERT INTO task_occurrences (
      id, household_id, task_rule_id, scheduled_for, due_at,
      completion_calendar_version, schedule_spec_version, rule_snapshot
    )
    SELECT ?1, ?2, ?3, ?4, ?5, ?6,
           CASE WHEN r.recurrence_basis = 'calendar' THEN 1 END,
           ${snapshot}
      FROM task_rules r
      LEFT JOIN managed_items i
        ON i.id = r.managed_item_id AND i.household_id = r.household_id
     WHERE r.id = ?3 AND r.household_id = ?2`,
  ).bind(
    input.occurrenceId,
    input.householdId,
    input.taskRuleId,
    input.scheduledFor,
    input.dueAt,
    input.completionCalendarVersion,
  );
}

async function insertTask(
  db: D1Database,
  householdId: string,
  input: TaskBasics & CompletionIntervalInput & {
    deadlineKind: string;
    dueAt: string | null;
    interval?: IntervalTaskInput;
    recurrenceBasis: string;
    recommendedStartOffset: number;
    recommendedUntilOffset: number;
    scheduleSpecs?: readonly StoredCalendarSpec[];
    scheduledFor: string | null;
  },
): Promise<string> {
  await requireManagedItem(db, householdId, input.managedItemId);
  const taskRuleId = crypto.randomUUID();
  const occurrenceId = crypto.randomUUID();
  const specs = input.scheduleSpecs;
  const interval = input.interval;
  await db.batch([
    db.prepare(
      `INSERT INTO task_rules (
        id, household_id, managed_item_id, title, recurrence_basis,
        deadline_kind, recommended_start_offset, recommended_until_offset,
        schedule_kind, schedule_day_of_week, schedule_day_of_month,
        schedule_week_of_month, schedule_month, schedule_month_end,
        interval_unit, interval_count, interval_anchor_on,
        recommended_start_value, recommended_until_value, recommended_unit
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)`,
    ).bind(
      taskRuleId,
      householdId,
      input.managedItemId,
      input.title,
      input.recurrenceBasis,
      input.deadlineKind,
      input.recommendedStartOffset,
      input.recommendedUntilOffset,
      ...legacyCalendarColumnValues(specs),
      ...intervalValues(interval),
      input.recommendedStartValue ?? null,
      input.recommendedUntilValue ?? null,
      input.recommendedUnit ?? null,
    ),
    ...scheduleSpecInserts(db, householdId, taskRuleId, specs ?? []),
    // 候補指定を入れた後にOccurrenceを作る。rule_snapshotが候補指定を含み
    // (YDR-039 / YDR-040)、0021のロールアウトガードも候補指定の件数を見るため。
    occurrenceInsert(db, {
      completionCalendarVersion:
        input.recommendedUnit === "month" || input.recommendedUnit === "year" ? 1 : null,
      dueAt: input.dueAt,
      householdId,
      occurrenceId,
      scheduledFor: input.scheduledFor,
      taskRuleId,
    }),
  ]);
  return taskRuleId;
}

export async function createOneTimeTask(
  db: D1Database,
  session: D1Session,
  input: OneTimeTaskInput,
): Promise<string> {
  const householdId = await requireCurrentHouseholdId(db, session);
  return insertTask(db, householdId, {
    ...input,
    deadlineKind: "strict",
    dueAt: input.scheduledFor,
    recurrenceBasis: "once",
    recommendedStartOffset: 0,
    recommendedUntilOffset: 0,
  });
}

export async function createMaintenanceTask(
  db: D1Database,
  session: D1Session,
  input: MaintenanceTaskInput,
): Promise<string> {
  const householdId = await requireCurrentHouseholdId(db, session);
  return insertTask(db, householdId, {
    ...input,
    deadlineKind: "maintenance",
    dueAt: input.firstDueAt,
    recurrenceBasis: "completion",
    scheduledFor: input.firstScheduledFor,
  });
}

export async function createCalendarTask(
  db: D1Database,
  session: D1Session,
  input: CalendarTaskInput,
  now = new Date(),
): Promise<string> {
  const householdId = await requireCurrentHouseholdId(db, session);
  const specs = calendarSpecsFromInput(input);
  const first = calendarFirstScheduledFor(calendarScheduleFromInput(input), now);
  return insertTask(db, householdId, {
    ...input,
    deadlineKind: "strict",
    dueAt: first,
    recurrenceBasis: "calendar",
    recommendedStartOffset: 0,
    recommendedUntilOffset: 0,
    scheduleSpecs: specs,
    scheduledFor: first,
  });
}

// 初回のOccurrenceは、登録日の暦日を含め、それ以降で最初の候補にする
// (YDR-037の2)。起点日が過去でも、飛ばした候補はさかのぼって作らない
// (YDR-016)。
export async function createIntervalTask(
  db: D1Database,
  session: D1Session,
  input: IntervalTaskInput,
  now = new Date(),
): Promise<string> {
  const householdId = await requireCurrentHouseholdId(db, session);
  const first = intervalFirstScheduledFor(input, now);
  return insertTask(db, householdId, {
    ...input,
    deadlineKind: "strict",
    dueAt: first,
    interval: input,
    recurrenceBasis: "interval",
    recommendedStartOffset: 0,
    recommendedUntilOffset: 0,
    scheduledFor: first,
  });
}
