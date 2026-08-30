import { requireCurrentHouseholdId, type D1Session } from "../authorization";
import { calendarScheduledForOnOrAfter, tokyoDateFromIso } from "../calendar";
import { type TaskBasics, requireManagedItem } from "./shared";

// Todoの新規作成(一回限り・完了日基準・定例日基準)。

export type OneTimeTaskInput = TaskBasics & { scheduledFor: string | null };

export type MaintenanceTaskInput = TaskBasics & {
  firstDueAt: string;
  firstScheduledFor: string;
  recommendedStartOffset: number;
  recommendedUntilOffset: number;
};

export type CalendarTaskInput = TaskBasics & {
  scheduleDayOfMonth: number | null;
  scheduleDayOfWeek: number | null;
  scheduleKind: string;
  // Issue #227 / YDR-032: 「毎月末」は schedule_kind='monthly_day' /
  // scheduleDayOfMonth=31 と組み合わせて保存する。候補計算には使わない
  // (src/lib/d1/calendar.tsは変更しない)。
  scheduleMonthEnd: boolean;
  scheduleMonth: number | null;
  scheduleWeekOfMonth: number | null;
};

async function insertTask(
  db: D1Database,
  householdId: string,
  input: TaskBasics & {
    deadlineKind: string;
    dueAt: string | null;
    recurrenceBasis: string;
    recommendedStartOffset: number;
    recommendedUntilOffset: number;
    schedule?: CalendarTaskInput;
    scheduledFor: string | null;
  },
): Promise<string> {
  await requireManagedItem(db, householdId, input.managedItemId);
  const taskRuleId = crypto.randomUUID();
  const occurrenceId = crypto.randomUUID();
  const schedule = input.schedule;
  await db.batch([
    db.prepare(
      `INSERT INTO task_rules (
        id, household_id, managed_item_id, title, recurrence_basis,
        deadline_kind, recommended_start_offset, recommended_until_offset,
        schedule_kind, schedule_day_of_week, schedule_day_of_month,
        schedule_week_of_month, schedule_month, schedule_month_end
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
    ).bind(
      taskRuleId,
      householdId,
      input.managedItemId,
      input.title,
      input.recurrenceBasis,
      input.deadlineKind,
      input.recommendedStartOffset,
      input.recommendedUntilOffset,
      schedule?.scheduleKind ?? null,
      schedule?.scheduleDayOfWeek ?? null,
      schedule?.scheduleDayOfMonth ?? null,
      schedule?.scheduleWeekOfMonth ?? null,
      schedule?.scheduleMonth ?? null,
      schedule?.scheduleMonthEnd === true ? 1 : 0,
    ),
    db.prepare(
      "INSERT INTO task_occurrences (id, household_id, task_rule_id, scheduled_for, due_at) VALUES (?1, ?2, ?3, ?4, ?5)",
    ).bind(occurrenceId, householdId, taskRuleId, input.scheduledFor, input.dueAt),
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
  const first = calendarScheduledForOnOrAfter(input, tokyoDateFromIso(now.toISOString()));
  return insertTask(db, householdId, {
    ...input,
    deadlineKind: "strict",
    dueAt: first,
    recurrenceBasis: "calendar",
    recommendedStartOffset: 0,
    recommendedUntilOffset: 0,
    schedule: input,
    scheduledFor: first,
  });
}
